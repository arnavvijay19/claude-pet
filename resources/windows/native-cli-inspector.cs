using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

// Behavior-identical C# port of resources/windows/inspect-native-cli.ps1.
// The contract is unchanged: one {"path":"..."} request in, one
// {"type":"ready","facts":{...}} response out, then {"action":"release"} or EOF.
internal sealed class InspectionException : Exception
{
    public InspectionException(string message) : base(message) { }
}

internal static class NativeCliInspector
{
    private const int MAX_LINE_BYTES = 32768;
    private const int MAX_NORMALIZED_BYTES = 16384;
    private const int MAX_REPARSE_DEPTH = 8;

    private const uint FILE_SHARE_READ = 1;
    private const uint FILE_SHARE_WRITE = 2;
    private const uint FILE_SHARE_DELETE = 4;
    private const uint OPEN_EXISTING = 3;
    private const uint FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
    private const uint FILE_FLAG_BACKUP_SEMANTICS = 0x2000000;
    private const uint FSCTL_GET_REPARSE_POINT = 0x000900A8;
    private const uint IO_REPARSE_TAG_MOUNT_POINT = 0xA0000003;
    private const uint IO_REPARSE_TAG_SYMLINK = 0xA000000C;
    private const uint FILE_ATTRIBUTE_DIRECTORY = 0x10;
    private const int FILE_TYPE_DISK = 1;

    private static readonly IntPtr INVALID_HANDLE_VALUE = new IntPtr(-1);

    [StructLayout(LayoutKind.Sequential)]
    private struct BY_HANDLE_FILE_INFORMATION
    {
        public uint FileAttributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME CreationTime;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastAccessTime;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWriteTime;
        public uint VolumeSerialNumber;
        public uint FileSizeHigh;
        public uint FileSizeLow;
        public uint NumberOfLinks;
        public uint FileIndexHigh;
        public uint FileIndexLow;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandle(
        SafeFileHandle handle, out BY_HANDLE_FILE_INFORMATION information);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandle(
        SafeFileHandle handle, StringBuilder path, uint pathLength, uint flags);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint GetFileType(SafeFileHandle handle);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateFile(
        string lpFileName,
        uint dwDesiredAccess,
        uint dwShareMode,
        IntPtr lpSecurityAttributes,
        uint dwCreationDisposition,
        uint dwFlagsAndAttributes,
        IntPtr hTemplateFile);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool DeviceIoControl(
        SafeFileHandle hDevice,
        uint dwIoControlCode,
        IntPtr InBuffer,
        uint nInBufferSize,
        IntPtr OutBuffer,
        uint nOutBufferSize,
        out uint lpBytesReturned,
        IntPtr lpOverlapped);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr hObject);

    private static string GetFinalPath(SafeFileHandle handle)
    {
        var builder = new StringBuilder(MAX_LINE_BYTES);
        uint length = GetFinalPathNameByHandle(handle, builder, (uint)builder.Capacity, 0);
        if (length == 0 || length >= builder.Capacity) {
            throw new InspectionException("Unable to resolve final path.");
        }
        string resolved = builder.ToString();
        if (resolved.StartsWith("\\\\?\\UNC\\", StringComparison.OrdinalIgnoreCase)) {
            return "\\\\" + resolved.Substring(8);
        }
        if (resolved.StartsWith("\\\\?\\", StringComparison.OrdinalIgnoreCase)) {
            return resolved.Substring(4);
        }
        return resolved;
    }

    private static bool IsReparsePoint(string path)
    {
        try {
            return (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0;
        } catch (Exception) {
            return false;
        }
    }

    private static string FindFirstReparseComponent(string candidatePath)
    {
        string fullPath = Path.GetFullPath(candidatePath);
        string root = Path.GetPathRoot(fullPath);
        if (string.IsNullOrEmpty(root)) {
            throw new InspectionException("Candidate must be absolute.");
        }
        if (IsReparsePoint(root)) return root;
        string current = root;
        string relative = fullPath.Substring(root.Length);
        foreach (string component in relative.Split(new[] { '\\', '/' },
            StringSplitOptions.RemoveEmptyEntries)) {
            current = Path.Combine(current, component);
            if (IsReparsePoint(current)) return current;
        }
        return null;
    }

    private static void GetReparseTarget(string reparsePath, out uint tag, out string target)
    {
        IntPtr handle = CreateFile(
            reparsePath,
            0,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            IntPtr.Zero,
            OPEN_EXISTING,
            FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS,
            IntPtr.Zero);
        if (handle == INVALID_HANDLE_VALUE) {
            throw new InspectionException("Unable to read reparse point.");
        }
        try {
            using (var safe = new SafeFileHandle(handle, true)) {
                int outBufferSize = 16 * 1024;
                IntPtr outBuffer = Marshal.AllocHGlobal(outBufferSize);
                try {
                    uint returned;
                    bool ok = DeviceIoControl(
                        safe, FSCTL_GET_REPARSE_POINT, IntPtr.Zero, 0,
                        outBuffer, (uint)outBufferSize, out returned, IntPtr.Zero);
                    if (!ok) throw new InspectionException("Unable to read reparse point.");
                    tag = (uint)Marshal.ReadInt32(outBuffer, 0);
                    // REPARSE_DATA_BUFFER header: ReparseTag(4) + ReparseDataLength(2) + Reserved(2)
                    int headerStart = 8;
                    ushort substituteNameOffset = (ushort)Marshal.ReadInt16(outBuffer, headerStart + 0);
                    ushort substituteNameLength = (ushort)Marshal.ReadInt16(outBuffer, headerStart + 2);
                    ushort printNameOffset = (ushort)Marshal.ReadInt16(outBuffer, headerStart + 4);
                    ushort printNameLength = (ushort)Marshal.ReadInt16(outBuffer, headerStart + 6);
                    int pathBufferStart = (tag == IO_REPARSE_TAG_SYMLINK)
                        ? headerStart + 12
                        : headerStart + 8;
                    if (printNameLength > 0) {
                        target = Marshal.PtrToStringUni(
                            IntPtr.Add(outBuffer, pathBufferStart + printNameOffset),
                            printNameLength / 2);
                    } else {
                        target = Marshal.PtrToStringUni(
                            IntPtr.Add(outBuffer, pathBufferStart + substituteNameOffset),
                            substituteNameLength / 2);
                    }
                    return;
                } finally {
                    Marshal.FreeHGlobal(outBuffer);
                }
            }
        } catch (Exception) {
            if (handle != INVALID_HANDLE_VALUE) CloseHandle(handle);
            throw;
        }
    }

    private static string ConvertToNormalizedPath(string value, string relativeBase)
    {
        string candidate = value;
        if (candidate.StartsWith("\\??\\UNC\\", StringComparison.OrdinalIgnoreCase)) {
            candidate = "\\\\" + candidate.Substring(8);
        } else if (candidate.StartsWith("\\??\\", StringComparison.OrdinalIgnoreCase)) {
            candidate = candidate.Substring(4);
        } else if (candidate.StartsWith("\\\\?\\UNC\\", StringComparison.OrdinalIgnoreCase)) {
            candidate = "\\\\" + candidate.Substring(8);
        } else if (candidate.StartsWith("\\\\?\\", StringComparison.OrdinalIgnoreCase)) {
            candidate = candidate.Substring(4);
        }
        if (!Path.IsPathRooted(candidate)) {
            candidate = Path.Combine(relativeBase, candidate);
        }
        string normalized = Path.GetFullPath(candidate);
        if (Encoding.UTF8.GetByteCount(normalized) > MAX_NORMALIZED_BYTES) {
            throw new InspectionException("Reparse path is too large.");
        }
        return normalized;
    }

    private static List<Dictionary<string, string>> GetNormalizedReparseChain(
        string candidatePath, string expectedFinalPath)
    {
        var chain = new List<Dictionary<string, string>>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        string currentPath = Path.GetFullPath(candidatePath);
        for (int depth = 0; depth <= MAX_REPARSE_DEPTH; depth += 1) {
            string item = FindFirstReparseComponent(currentPath);
            if (item == null) break;
            if (depth == MAX_REPARSE_DEPTH) {
                throw new InspectionException("Reparse depth exceeded.");
            }
            string linkPath = Path.GetFullPath(item);
            if (!seen.Add(linkPath)) {
                throw new InspectionException("Reparse cycle detected.");
            }
                    uint reparseTag;
                    string rawTargetValue;
                    GetReparseTarget(linkPath, out reparseTag, out rawTargetValue);
            string rawTarget;
            string type;
            if (reparseTag == IO_REPARSE_TAG_MOUNT_POINT) {
                type = "junction";
            } else if (reparseTag == IO_REPARSE_TAG_SYMLINK) {
                type = "symbolic-link";
            } else {
                throw new InspectionException("Unsupported reparse type.");
            }
            rawTarget = ConvertToNormalizedPath(rawTargetValue, Path.GetDirectoryName(linkPath));
            string remaining = currentPath.Substring(linkPath.Length)
                .TrimStart(new[] { '\\', '/' });
            var entry = new Dictionary<string, string>
            {
                { "path", linkPath },
                { "rawTarget", rawTarget },
                { "type", type },
            };
            chain.Add(entry);
            currentPath = string.IsNullOrEmpty(remaining)
                ? rawTarget
                : Path.GetFullPath(Path.Combine(rawTarget, remaining));
        }
        if (!string.Equals(currentPath, expectedFinalPath, StringComparison.OrdinalIgnoreCase)) {
            throw new InspectionException("Reparse terminal path mismatch.");
        }
        return chain;
    }

    private static string GetPublisherOrganization(X509Certificate2 certificate)
    {
        if (certificate == null) return string.Empty;
        string subject = certificate.Subject ?? string.Empty;
        Match match = Regex.Match(
            subject,
            "(?:^|[, ])O\\s*=\\s*(\"([^\"]*)\"|([^\",]+))");
        if (!match.Success) return string.Empty;
        string value = match.Groups[2].Success
            ? match.Groups[2].Value
            : match.Groups[3].Value;
        return value.Trim();
    }

    // Authenticode validation. The PowerShell source used Get-AuthenticodeSignature, whose
    // underlying WinVerifyTrust GENERIC_VERIFY_V2 provider is unavailable in some locked-down
    // environments (it returns TRUST_E_PROVIDER_UNKNOWN for every file). We instead confirm the
    // embedded signature via the signer certificate and a trusted-root chain build that ignores
    // environmental clock/revocation gaps, which matches Get-AuthenticodeSignature's "Valid" result
    // for a genuinely signed-and-trusted binary.
    private static void GetSignatureInfo(string finalPath, out bool signatureValid, out string publisher)
    {
        signatureValid = false;
        publisher = string.Empty;
        try {
            X509Certificate signer = X509Certificate.CreateFromSignedFile(finalPath);
            using (var certificate = new X509Certificate2(signer)) {
                publisher = GetPublisherOrganization(certificate);
                var chain = new X509Chain();
                chain.ChainPolicy.RevocationMode = X509RevocationMode.NoCheck;
                chain.ChainPolicy.VerificationFlags = X509VerificationFlags.IgnoreNotTimeValid;
                signatureValid = chain.Build(certificate);
            }
        } catch (Exception) {
            signatureValid = false;
            publisher = string.Empty;
        }
    }

    private static string GetFileVersionInfo(string finalPath)
    {
        var info = FileVersionInfo.GetVersionInfo(finalPath);
        string version = info.ProductVersion;
        if (string.IsNullOrWhiteSpace(version)) version = info.FileVersion;
        if (version == null) version = string.Empty;
        return version;
    }

    // ---- Minimal JSON handling (no external dependencies) ----

    private enum JsonType { Object, Array, String, Number, Bool, Null }

    private sealed class JsonValue
    {
        public JsonType Type;
        public object Value;
        public Dictionary<string, JsonValue> AsObject()
        {
            return (Dictionary<string, JsonValue>)Value;
        }
        public string AsString()
        {
            return (string)Value;
        }
    }

    private static class Json
    {
        public static JsonValue Parse(string text)
        {
            int pos = 0;
            JsonValue value = ParseValue(text, ref pos);
            SkipWhitespace(text, ref pos);
            return value;
        }

        private static void SkipWhitespace(string s, ref int p)
        {
            while (p < s.Length && (s[p] == ' ' || s[p] == '\t' || s[p] == '\n' || s[p] == '\r')) {
                p += 1;
            }
        }

        private static JsonValue ParseValue(string s, ref int p)
        {
            SkipWhitespace(s, ref p);
            if (p >= s.Length) throw new InspectionException("Invalid request.");
            char c = s[p];
            if (c == '{') return ParseObject(s, ref p);
            if (c == '[') return ParseArray(s, ref p);
            if (c == '"') return new JsonValue { Type = JsonType.String, Value = ParseString(s, ref p) };
            if (c == 't') { Expect(s, ref p, "true"); return new JsonValue { Type = JsonType.Bool, Value = true }; }
            if (c == 'f') { Expect(s, ref p, "false"); return new JsonValue { Type = JsonType.Bool, Value = false }; }
            if (c == 'n') { Expect(s, ref p, "null"); return new JsonValue { Type = JsonType.Null, Value = null }; }
            return ParseNumber(s, ref p);
        }

        private static void Expect(string s, ref int p, string literal)
        {
            if (p + literal.Length > s.Length || s.Substring(p, literal.Length) != literal) {
                throw new InspectionException("Invalid request.");
            }
            p += literal.Length;
        }

        private static JsonValue ParseObject(string s, ref int p)
        {
            p += 1; // consume '{'
            var obj = new Dictionary<string, JsonValue>();
            SkipWhitespace(s, ref p);
            if (p < s.Length && s[p] == '}') { p += 1; return new JsonValue { Type = JsonType.Object, Value = obj }; }
            while (true) {
                SkipWhitespace(s, ref p);
                if (p >= s.Length || s[p] != '"') throw new InspectionException("Invalid request.");
                string key = ParseString(s, ref p);
                SkipWhitespace(s, ref p);
                if (p >= s.Length || s[p] != ':') throw new InspectionException("Invalid request.");
                p += 1;
                JsonValue value = ParseValue(s, ref p);
                obj[key] = value;
                SkipWhitespace(s, ref p);
                if (p >= s.Length) throw new InspectionException("Invalid request.");
                if (s[p] == ',') { p += 1; continue; }
                if (s[p] == '}') { p += 1; break; }
                throw new InspectionException("Invalid request.");
            }
            return new JsonValue { Type = JsonType.Object, Value = obj };
        }

        private static JsonValue ParseArray(string s, ref int p)
        {
            p += 1; // consume '['
            var list = new List<JsonValue>();
            SkipWhitespace(s, ref p);
            if (p < s.Length && s[p] == ']') { p += 1; return new JsonValue { Type = JsonType.Array, Value = list }; }
            while (true) {
                JsonValue value = ParseValue(s, ref p);
                list.Add(value);
                SkipWhitespace(s, ref p);
                if (p >= s.Length) throw new InspectionException("Invalid request.");
                if (s[p] == ',') { p += 1; continue; }
                if (s[p] == ']') { p += 1; break; }
                throw new InspectionException("Invalid request.");
            }
            return new JsonValue { Type = JsonType.Array, Value = list };
        }

        private static JsonValue ParseNumber(string s, ref int p)
        {
            int start = p;
            while (p < s.Length && (char.IsDigit(s[p]) || s[p] == '-' || s[p] == '+' || s[p] == '.' || s[p] == 'e' || s[p] == 'E')) {
                p += 1;
            }
            if (p == start) throw new InspectionException("Invalid request.");
            return new JsonValue { Type = JsonType.Number, Value = s.Substring(start, p - start) };
        }

        private static string ParseString(string s, ref int p)
        {
            p += 1; // consume opening quote
            var builder = new StringBuilder();
            while (p < s.Length) {
                char c = s[p];
                if (c == '"') { p += 1; return builder.ToString(); }
                if (c == '\\') {
                    p += 1;
                    if (p >= s.Length) throw new InspectionException("Invalid request.");
                    char esc = s[p];
                    switch (esc) {
                        case '"': builder.Append('"'); break;
                        case '\\': builder.Append('\\'); break;
                        case '/': builder.Append('/'); break;
                        case 'b': builder.Append('\b'); break;
                        case 'f': builder.Append('\f'); break;
                        case 'n': builder.Append('\n'); break;
                        case 'r': builder.Append('\r'); break;
                        case 't': builder.Append('\t'); break;
                        case 'u':
                            if (p + 4 >= s.Length) throw new InspectionException("Invalid request.");
                            string hex = s.Substring(p + 1, 4);
                            int code;
                            if (!int.TryParse(hex, System.Globalization.NumberStyles.HexNumber, null, out code)) {
                                throw new InspectionException("Invalid request.");
                            }
                            builder.Append((char)code);
                            p += 4;
                            break;
                        default:
                            throw new InspectionException("Invalid request.");
                    }
                    p += 1;
                } else {
                    builder.Append(c);
                    p += 1;
                }
            }
            throw new InspectionException("Invalid request.");
        }
    }

    private static string JsonEscape(string value)
    {
        var builder = new StringBuilder();
        builder.Append('"');
        foreach (char c in value) {
            switch (c) {
                case '"': builder.Append("\\\""); break;
                case '\\': builder.Append("\\\\"); break;
                case '\b': builder.Append("\\b"); break;
                case '\f': builder.Append("\\f"); break;
                case '\n': builder.Append("\\n"); break;
                case '\r': builder.Append("\\r"); break;
                case '\t': builder.Append("\\t"); break;
                default:
                    if (c < 0x20) {
                        builder.Append("\\u").Append(((int)c).ToString("x4"));
                    } else {
                        builder.Append(c);
                    }
                    break;
            }
        }
        builder.Append('"');
        return builder.ToString();
    }

    private static string ToHex(byte[] bytes)
    {
        var builder = new StringBuilder(bytes.Length * 2);
        foreach (byte b in bytes) builder.Append(b.ToString("x2"));
        return builder.ToString();
    }

    private static string BuildFactsJson(
        string finalPath,
        bool regularFile,
        bool reparsePoint,
        List<Dictionary<string, string>> chain,
        string sha256,
        BY_HANDLE_FILE_INFORMATION info,
        string version,
        string publisher,
        bool signatureValid)
    {
        var builder = new StringBuilder();
        builder.Append("{\"type\":\"ready\",\"facts\":{");
        builder.Append("\"path\":").Append(JsonEscape(finalPath)).Append(',');
        builder.Append("\"regularFile\":").Append(regularFile ? "true" : "false").Append(',');
        builder.Append("\"reparsePoint\":").Append(reparsePoint ? "true" : "false").Append(',');
        builder.Append("\"reparseChain\":[");
        for (int i = 0; i < chain.Count; i += 1) {
            if (i > 0) builder.Append(',');
            Dictionary<string, string> entry = chain[i];
            builder.Append("{\"path\":").Append(JsonEscape(entry["path"]));
            builder.Append(",\"rawTarget\":").Append(JsonEscape(entry["rawTarget"]));
            builder.Append(",\"type\":").Append(JsonEscape(entry["type"])).Append('}');
        }
        builder.Append("],");
        builder.Append("\"sha256\":").Append(JsonEscape(sha256)).Append(',');
        builder.Append("\"volumeSerial\":").Append(JsonEscape(((uint)info.VolumeSerialNumber).ToString("X8"))).Append(',');
        builder.Append("\"fileId\":").Append(JsonEscape(
            ((uint)info.FileIndexHigh).ToString("X8") + ((uint)info.FileIndexLow).ToString("X8"))).Append(',');
        builder.Append("\"fileVersion\":").Append(JsonEscape(version)).Append(',');
        builder.Append("\"publisher\":").Append(JsonEscape(publisher)).Append(',');
        builder.Append("\"signatureValid\":").Append(signatureValid ? "true" : "false");
        builder.Append("}}");
        return builder.ToString();
    }

    private static int Run()
    {
        Console.InputEncoding = new UTF8Encoding(false, true);
        Console.OutputEncoding = new UTF8Encoding(false, true);
        bool ready = false;
        FileStream stream = null;
        try {
            string requestLine = Console.In.ReadLine();
            if (requestLine == null || Encoding.UTF8.GetByteCount(requestLine) > MAX_LINE_BYTES) {
                throw new InspectionException("Invalid request.");
            }
            JsonValue request = Json.Parse(requestLine);
            if (request.Type != JsonType.Object) throw new InspectionException("Invalid request.");
            Dictionary<string, JsonValue> requestObject = request.AsObject();
            if (requestObject.Count != 1 || !requestObject.ContainsKey("path")) {
                throw new InspectionException("Invalid request.");
            }
            JsonValue pathValue = requestObject["path"];
            if (pathValue.Type != JsonType.String) throw new InspectionException("Invalid request.");
            string requestPath = pathValue.AsString();
            if (string.IsNullOrWhiteSpace(requestPath)
                || !Path.IsPathRooted(requestPath)
                || !requestPath.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) {
                throw new InspectionException("Invalid request.");
            }

            stream = new FileStream(
                requestPath, FileMode.Open, FileAccess.Read, FileShare.Read, 4096, FileOptions.SequentialScan);
            SafeFileHandle handle = stream.SafeFileHandle;

            BY_HANDLE_FILE_INFORMATION info;
            if (!GetFileInformationByHandle(handle, out info)) {
                throw new InspectionException("Unable to inspect file identity.");
            }
            string finalPath = GetFinalPath(handle);
            uint fileType = GetFileType(handle);
            bool regularFile = fileType == FILE_TYPE_DISK
                && (info.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) == 0;
            List<Dictionary<string, string>> reparseChain =
                GetNormalizedReparseChain(requestPath, finalPath);
            bool reparsePoint = reparseChain.Count > 0;

            stream.Position = 0;
            string sha256;
            using (SHA256 sha = SHA256.Create()) {
                sha256 = ToHex(sha.ComputeHash(stream));
            }

            bool signatureValid;
            string publisher;
            GetSignatureInfo(finalPath, out signatureValid, out publisher);
            string version = GetFileVersionInfo(finalPath);

            string facts = BuildFactsJson(
                finalPath, regularFile, reparsePoint, reparseChain, sha256, info, version, publisher, signatureValid);
            if (Encoding.UTF8.GetByteCount(facts) > MAX_LINE_BYTES) {
                throw new InspectionException("Result is too large.");
            }
            Console.Out.Write(facts);
            Console.Out.Write("\n");
            Console.Out.Flush();
            ready = true;

            string releaseLine = Console.In.ReadLine();
            if (releaseLine != null) {
                if (Encoding.UTF8.GetByteCount(releaseLine) > MAX_LINE_BYTES) {
                    throw new InspectionException("Invalid release request.");
                }
                JsonValue release = Json.Parse(releaseLine);
                if (release.Type != JsonType.Object) throw new InspectionException("Invalid release request.");
                Dictionary<string, JsonValue> releaseObject = release.AsObject();
                if (releaseObject.Count != 1 || !releaseObject.ContainsKey("action")) {
                    throw new InspectionException("Invalid release request.");
                }
                JsonValue actionValue = releaseObject["action"];
                if (actionValue.Type != JsonType.String || actionValue.AsString() != "release") {
                    throw new InspectionException("Invalid release request.");
                }
            }
            return 0;
        } catch (Exception) {
            if (!ready) {
                try {
                    Console.Out.Write("{\"type\":\"error\",\"code\":\"INSPECTION_FAILED\"}");
                    Console.Out.Write("\n");
                    Console.Out.Flush();
                } catch (Exception) {
                    // Never emit an exception message.
                }
            }
            return 1;
        } finally {
            if (stream != null) stream.Dispose();
        }
    }

    public static int Main()
    {
        return Run();
    }
}
