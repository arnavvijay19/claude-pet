// resources/windows/provider-job-host.cs
//
// Windows provider-job host. Built once (offline) by scripts/build-provider-job-host.js and
// shipped inside the Windows package. It owns a private, non-breakaway Job Object, starts each
// verified native provider suspended, assigns it before resume, and truthfully proves cleanup
// only for processes assigned to that job.
//
// Lifecycle contract (see docs/superpowers/plans/2026-07-29-windows-job-owned-provider-lifecycle.md):
//   * one first-line UTF-8 JSON envelope on stdin:
//       { protocolVersion, command, args, cwd, visible, ownerPid, ownerExecutable }
//   * emits exactly one readiness record on stderr: CLAUDE_PET_JOB_READY 1\r\n
//   * then proxies raw provider stdin/stdout/stderr and waits for owner or provider root
//   * on exit it terminates the job and polls ActiveProcesses to zero (cleanup proof)
//
// Goals and credentials never appear in arguments, the envelope, diagnostics, or the
// environment; the envelope omits `env` and the provider inherits the helper's already-bounded
// environment exactly.
//
// NOTE: This file is authored but is NOT compiled in CI/sandbox (csc is unavailable there). It is
// intended to be compiled on Windows via the build script. Treat as unverified-compile until a
// Windows build succeeds. The branch stays intentionally unmerged until then.

using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Security;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace ClaudePet.Windows
{
    // Thrown internally; carries the fixed helper exit code.
    [Serializable]
    internal sealed class HelperException : Exception
    {
        internal int ExitCode { get; }

        internal HelperException(int exitCode)
            : base("provider job host failure")
        {
            ExitCode = exitCode;
        }
    }

    internal static class Program
    {
        internal const int ProtocolVersion = 1;

        // Fixed helper exit codes.
        internal const int ExitSuccess = 0;
        internal const int ExitInvalidProtocol = 64;
        internal const int ExitOwnerBindingFailed = 65;
        internal const int ExitJobSetupFailed = 66;
        internal const int ExitProviderFailed = 67;
        internal const int ExitStreamPumpFailed = 68;
        internal const int ExitCleanupUnproven = 69;

        // Bounds (mirror the adapter and plan).
        private const int MaxEnvelopeBytes = 65536;
        private const int MaxArgs = 256;
        private const int MaxComponentBytes = 32768;
        private const int CleanupDeadlineMs = 5000;
        private const int PumpDrainTimeoutMs = 5000;

        private static readonly byte[] ReadyLine = Encoding.ASCII.GetBytes("CLAUDE_PET_JOB_READY 1\r\n");

        private static int Main(string[] args)
        {
            if (args.Length == 1 && args[0] == "--protocol-version")
            {
                Console.Out.WriteLine(ProtocolVersion);
                return ExitSuccess;
            }
            // Any argument other than --protocol-version is invalid.
            if (args.Length != 0) return ExitInvalidProtocol;
            // Fail closed in a 32-bit process: the AnyCPU image must run on the x64 CLR.
            if (!Environment.Is64BitProcess) return ExitInvalidProtocol;

            try
            {
                Stream stdin = Console.OpenStandardInput();
                byte[] envelopeBytes = ReadEnvelope(stdin);
                Dictionary<string, object> envelope = ParseEnvelope(envelopeBytes);
                LaunchSpec spec = BuildLaunchSpec(envelope);
                return RunProvider(spec, stdin);
            }
            catch (HelperException ex)
            {
                return ex.ExitCode;
            }
            catch (Exception)
            {
                return ExitInvalidProtocol;
            }
        }

        // -------------------------------------------------------------------
        // Envelope ingestion
        // -------------------------------------------------------------------

        private static byte[] ReadEnvelope(Stream stdin)
        {
            using (var ms = new MemoryStream())
            {
                byte[] buffer = new byte[4096];
                int total = 0;
                while (true)
                {
                    int read = stdin.Read(buffer, 0, buffer.Length);
                    if (read == 0) break; // EOF before a complete line
                    for (int i = 0; i < read; i++)
                    {
                        total++;
                        if (total > MaxEnvelopeBytes) throw new HelperException(ExitInvalidProtocol);
                        byte b = buffer[i];
                        if (b == 0x00) throw new HelperException(ExitInvalidProtocol);
                        if (b == 0x0A) return ms.ToArray(); // first LF ends the envelope
                        ms.WriteByte(b);
                    }
                }
                if (ms.Length == 0) throw new HelperException(ExitInvalidProtocol);
                return ms.ToArray();
            }
        }

        private static Dictionary<string, object> ParseEnvelope(byte[] bytes)
        {
            string text = Encoding.UTF8.GetString(bytes);
            if (text.IndexOf('\0') >= 0) throw new HelperException(ExitInvalidProtocol);
            object parsed;
            try
            {
                parsed = Json.Parse(text);
            }
            catch (FormatException)
            {
                throw new HelperException(ExitInvalidProtocol);
            }
            var dict = parsed as Dictionary<string, object>;
            if (dict == null) throw new HelperException(ExitInvalidProtocol);
            // Require exactly the seven envelope keys.
            if (dict.Count != 7) throw new HelperException(ExitInvalidProtocol);
            string[] required =
            {
                "protocolVersion", "command", "args", "cwd", "visible", "ownerPid", "ownerExecutable",
            };
            foreach (string key in required)
            {
                if (!dict.ContainsKey(key)) throw new HelperException(ExitInvalidProtocol);
            }
            return dict;
        }

        private static LaunchSpec BuildLaunchSpec(Dictionary<string, object> envelope)
        {
            object pv;
            if (!envelope.TryGetValue("protocolVersion", out pv) || !(pv is long) || (long)pv != ProtocolVersion)
                throw new HelperException(ExitInvalidProtocol);

            object cmd;
            if (!envelope.TryGetValue("command", out cmd) || !(cmd is string)
                || !IsValidComponent((string)cmd)
                || !Path.IsPathRooted((string)cmd)
                || !((string)cmd).EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
                throw new HelperException(ExitInvalidProtocol);

            object argsObj;
            if (!envelope.TryGetValue("args", out argsObj) || !(argsObj is List<object>)
                || ((List<object>)argsObj).Count > MaxArgs)
                throw new HelperException(ExitInvalidProtocol);
            var args = new List<string>(((List<object>)argsObj).Count);
            foreach (object item in (List<object>)argsObj)
            {
                if (!(item is string) || !IsValidComponent((string)item))
                    throw new HelperException(ExitInvalidProtocol);
                args.Add((string)item);
            }

            object cwd;
            if (!envelope.TryGetValue("cwd", out cwd) || !(cwd is string)
                || !IsValidComponent((string)cwd)
                || (((string)cwd).Length > 0 && !Path.IsPathRooted((string)cwd)))
                throw new HelperException(ExitInvalidProtocol);

            object visible;
            if (!envelope.TryGetValue("visible", out visible) || !(visible is bool))
                throw new HelperException(ExitInvalidProtocol);

            object pid;
            if (!envelope.TryGetValue("ownerPid", out pid) || !(pid is long)
                || (long)pid <= 0 || (long)pid > int.MaxValue)
                throw new HelperException(ExitInvalidProtocol);

            object ownerExe;
            if (!envelope.TryGetValue("ownerExecutable", out ownerExe) || !(ownerExe is string)
                || !IsValidComponent((string)ownerExe))
                throw new HelperException(ExitInvalidProtocol);

            return new LaunchSpec
            {
                command = (string)cmd,
                args = args,
                cwd = (string)cwd,
                visible = (bool)visible,
                ownerPid = (int)(long)pid,
                ownerExecutable = (string)ownerExe,
                commandLine = BuildCommandLine((string)cmd, args),
            };
        }

        private static bool IsValidComponent(string value)
        {
            if (value == null) return false;
            if (value.IndexOf('\0') >= 0) return false;
            return Encoding.UTF8.GetByteCount(value) <= MaxComponentBytes;
        }

        private static string NormalizePath(string value)
        {
            if (string.IsNullOrEmpty(value)) return value ?? string.Empty;
            return value.Replace('/', '\\').TrimEnd('\\');
        }

        // Windows argument quoting (plan Task 2).
        private static string QuoteArgument(string value)
        {
            if (value.Length > 0 && value.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return value;
            var result = new StringBuilder("\"");
            int slashes = 0;
            foreach (char ch in value)
            {
                if (ch == '\\')
                {
                    slashes++;
                    continue;
                }
                if (ch == '"')
                {
                    result.Append('\\', slashes * 2 + 1).Append('"');
                }
                else
                {
                    result.Append('\\', slashes).Append(ch);
                }
                slashes = 0;
            }
            return result.Append('\\', slashes * 2).Append('"').ToString();
        }

        private static string BuildCommandLine(string command, List<string> args)
        {
            var sb = new StringBuilder();
            sb.Append(QuoteArgument(command));
            foreach (string arg in args)
            {
                sb.Append(' ');
                sb.Append(QuoteArgument(arg));
            }
            return sb.ToString();
        }

        // -------------------------------------------------------------------
        // Owner binding (fail closed before creating the provider)
        // -------------------------------------------------------------------

        private static SafeProcessHandle OpenOwner(int ownerPid, string ownerExecutable)
        {
            IntPtr handle = NativeMethods.OpenProcess(
                SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, false, ownerPid);
            if (handle == IntPtr.Zero || handle == (IntPtr)(-1))
                throw new HelperException(ExitOwnerBindingFailed);
            var safe = new SafeProcessHandle(handle);
            try
            {
                int exitCode;
                if (NativeMethods.GetExitCodeProcess(safe, out exitCode) && exitCode != STILL_ACTIVE)
                    throw new HelperException(ExitOwnerBindingFailed);

                var sb = new StringBuilder(32768);
                int size = sb.Capacity;
                if (!NativeMethods.QueryFullProcessImageNameW(safe, 0, sb, ref size))
                    throw new HelperException(ExitOwnerBindingFailed);

                string actual = NormalizePath(sb.ToString(0, size));
                string expected = NormalizePath(ownerExecutable);
                bool match = string.Equals(actual, expected, StringComparison.OrdinalIgnoreCase)
                    || string.Equals(Path.GetFileName(actual), Path.GetFileName(expected), StringComparison.OrdinalIgnoreCase);
                if (!match) throw new HelperException(ExitOwnerBindingFailed);
                return safe;
            }
            catch
            {
                safe.Dispose();
                throw;
            }
        }

        // -------------------------------------------------------------------
        // Provider creation + job ownership
        // -------------------------------------------------------------------

        private static void CreateStdHandles(
            out SafeFileHandle providerStdinRead,
            out SafeFileHandle helperStdinWrite,
            out SafeFileHandle providerStdoutWrite,
            out SafeFileHandle helperStdoutRead,
            out SafeFileHandle providerStderrWrite,
            out SafeFileHandle helperStderrRead)
        {
            var saInherit = new SECURITY_ATTRIBUTES { bInheritHandle = true };
            if (!NativeMethods.CreatePipe(out providerStdinRead, out helperStdinWrite, saInherit, 0))
                throw new HelperException(ExitProviderFailed);
            if (!NativeMethods.CreatePipe(out helperStdoutRead, out providerStdoutWrite, saInherit, 0))
                throw new HelperException(ExitProviderFailed);
            if (!NativeMethods.CreatePipe(out helperStderrRead, out providerStderrWrite, saInherit, 0))
                throw new HelperException(ExitProviderFailed);

            // The provider side must inherit; clear inheritance on the helper side only.
            if (!NativeMethods.SetHandleInformation(helperStdinWrite.DangerousGetHandle(), HANDLE_FLAG_INHERIT, 0))
                throw new HelperException(ExitProviderFailed);
            if (!NativeMethods.SetHandleInformation(helperStdoutRead.DangerousGetHandle(), HANDLE_FLAG_INHERIT, 0))
                throw new HelperException(ExitProviderFailed);
            if (!NativeMethods.SetHandleInformation(helperStderrRead.DangerousGetHandle(), HANDLE_FLAG_INHERIT, 0))
                throw new HelperException(ExitProviderFailed);
        }

        private static IntPtr BuildAttributeList(
            SafeFileHandle stdin, SafeFileHandle stdout, SafeFileHandle stderr)
        {
            IntPtr size = IntPtr.Zero;
            if (!NativeMethods.InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size))
                throw new HelperException(ExitProviderFailed);
            IntPtr list = Marshal.AllocHGlobal(size);
            try
            {
                if (!NativeMethods.InitializeProcThreadAttributeList(list, 1, 0, ref size))
                    throw new HelperException(ExitProviderFailed);
                IntPtr[] handles =
                {
                    stdin.DangerousGetHandle(), stdout.DangerousGetHandle(), stderr.DangerousGetHandle(),
                };
                IntPtr handleArray = Marshal.AllocHGlobal(handles.Length * IntPtr.Size);
                try
                {
                    Marshal.Copy(handles, 0, handleArray, handles.Length);
                    if (!NativeMethods.UpdateProcThreadAttribute(
                        list, 0, (IntPtr)PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
                        handleArray, (IntPtr)(handles.Length * IntPtr.Size), IntPtr.Zero, IntPtr.Zero))
                        throw new HelperException(ExitProviderFailed);
                }
                finally
                {
                    Marshal.FreeHGlobal(handleArray);
                }
            }
            catch
            {
                Marshal.FreeHGlobal(list);
                throw;
            }
            return list;
        }

        private static int RunProvider(LaunchSpec spec, Stream appStdin)
        {
            SafeJobHandle job = null;
            SafeProcessHandle providerProcess = null;
            SafeThreadHandle providerThread = null;
            SafeProcessHandle ownerHandle = null;
            SafeFileHandle providerStdinRead = null, providerStdoutWrite = null, providerStderrWrite = null;
            SafeFileHandle helperStdinWrite = null, helperStdoutRead = null, helperStderrRead = null;
            IntPtr attributeList = IntPtr.Zero;
            FileStream providerStdin = null, providerStdout = null, providerStderr = null;
            Task pumpIn = null, pumpOut = null, pumpErr = null;

            try
            {
                ownerHandle = OpenOwner(spec.ownerPid, spec.ownerExecutable);

                if (!NativeMethods.CreateJobObjectW(out job, IntPtr.Zero))
                    throw new HelperException(ExitJobSetupFailed);
                var extended = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION
                {
                    BasicLimitInformation =
                    {
                        LimitFlags = (int)JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                    },
                };
                if (!NativeMethods.SetInformationJobObject(
                    job, JobObjectExtendedLimitInformation, ref extended, Marshal.SizeOf(extended)))
                    throw new HelperException(ExitJobSetupFailed);

                CreateStdHandles(
                    out providerStdinRead, out helperStdinWrite,
                    out providerStdoutWrite, out helperStdoutRead,
                    out providerStderrWrite, out helperStderrRead);

                attributeList = BuildAttributeList(providerStdinRead, providerStdoutWrite, providerStderrWrite);

                var si = new STARTUPINFOEX
                {
                    StartupInfo =
                    {
                        cb = Marshal.SizeOf(typeof(STARTUPINFOEX)),
                        dwFlags = (int)(STARTF_USESTDHANDLES | (spec.visible ? 0 : STARTF_USESHOWWINDOW)),
                        wShowWindow = spec.visible ? (short)0 : SW_HIDE,
                        hStdInput = providerStdinRead.DangerousGetHandle(),
                        hStdOutput = providerStdoutWrite.DangerousGetHandle(),
                        hStdError = providerStderrWrite.DangerousGetHandle(),
                    },
                    lpAttributeList = attributeList,
                };

                var pi = new PROCESS_INFORMATION();
                uint flags = CREATE_SUSPENDED | EXTENDED_STARTUPINFO_PRESENT;
                if (!NativeMethods.CreateProcessW(
                    spec.command,
                    new StringBuilder(spec.commandLine),
                    IntPtr.Zero,
                    IntPtr.Zero,
                    true,
                    flags,
                    IntPtr.Zero,
                    spec.cwd.Length > 0 ? spec.cwd : null,
                    ref si,
                    out pi))
                {
                    throw new HelperException(ExitProviderFailed);
                }
                providerProcess = new SafeProcessHandle(pi.hProcess);
                providerThread = new SafeThreadHandle(pi.hThread);

                // Assign the suspended root to the job BEFORE resume.
                if (!NativeMethods.AssignProcessToJobObject(job, providerProcess))
                {
                    NativeMethods.TerminateProcess(providerProcess, 1);
                    throw new HelperException(ExitProviderFailed);
                }

                // Prove assignment: emit readiness, then resume the provider.
                Console.Error.Write(Encoding.ASCII.GetString(ReadyLine));
                Console.Error.Flush();

                if (!NativeMethods.ResumeThread(providerThread))
                    throw new HelperException(ExitProviderFailed);

                providerStdin = new FileStream(helperStdinWrite, FileAccess.Write, 8192, false);
                providerStdout = new FileStream(helperStdoutRead, FileAccess.Read, 8192, false);
                providerStderr = new FileStream(helperStderrRead, FileAccess.Read, 8192, false);

                pumpIn = Task.Run(() => Pump(appStdin, providerStdin));
                pumpOut = Task.Run(() => Pump(providerStdout, Console.OpenStandardOutput()));
                pumpErr = Task.Run(() => Pump(providerStderr, Console.OpenStandardError()));

                uint wait = NativeMethods.WaitForMultipleObjects(2, new[]
                {
                    ownerHandle.DangerousGetHandle(), providerProcess.DangerousGetHandle(),
                }, false, INFINITE);
                int providerExitCode;
                if (wait == WAIT_OBJECT_0)
                {
                    NativeMethods.TerminateJobObject(job, 1);
                    NativeMethods.GetExitCodeProcess(providerProcess, out providerExitCode);
                }
                else if (wait == WAIT_OBJECT_0 + 1)
                {
                    NativeMethods.GetExitCodeProcess(providerProcess, out providerExitCode);
                }
                else
                {
                    NativeMethods.TerminateJobObject(job, 1);
                    throw new HelperException(ExitProviderFailed);
                }

                // Close provider stdin so the provider observes EOF, then drain the pumps.
                try { providerStdin.Dispose(); } catch { }
                try { Task.WaitAll(new[] { pumpIn, pumpOut, pumpErr }, PumpDrainTimeoutMs); } catch { }

                if (!WaitForJobEmpty(job, CleanupDeadlineMs))
                    throw new HelperException(ExitCleanupUnproven);

                // Surface only provider exit codes that do not collide with helper codes.
                if (providerExitCode >= 0 && providerExitCode <= 63) return providerExitCode;
                return ExitProviderFailed;
            }
            catch (HelperException)
            {
                throw;
            }
            catch (Exception)
            {
                throw new HelperException(ExitProviderFailed);
            }
            finally
            {
                if (attributeList != IntPtr.Zero)
                {
                    NativeMethods.DeleteProcThreadAttributeList(attributeList);
                    Marshal.FreeHGlobal(attributeList);
                }
                SafeDispose(ref providerStdinRead);
                SafeDispose(ref providerStdoutWrite);
                SafeDispose(ref providerStderrWrite);
                SafeDispose(ref helperStdinWrite);
                SafeDispose(ref helperStdoutRead);
                SafeDispose(ref helperStderrRead);
                if (providerStdin != null) { try { providerStdin.Dispose(); } catch { } }
                if (providerStdout != null) { try { providerStdout.Dispose(); } catch { } }
                if (providerStderr != null) { try { providerStderr.Dispose(); } catch { } }
                if (appStdin != null) { try { appStdin.Dispose(); } catch { } }
                SafeDispose(ref providerProcess);
                SafeDispose(ref providerThread);
                SafeDispose(ref ownerHandle);
                SafeDispose(ref job);
            }
        }

        private static void SafeDispose<T>(ref T handle) where T : SafeHandle
        {
            if (handle != null)
            {
                try { handle.Dispose(); } catch { }
                handle = null;
            }
        }

        private static void Pump(Stream source, Stream sink)
        {
            byte[] buffer = new byte[8192];
            try
            {
                int read;
                while ((read = source.Read(buffer, 0, buffer.Length)) > 0)
                {
                    sink.Write(buffer, 0, read);
                    sink.Flush();
                }
            }
            catch
            {
                // Benign when a peer closes early; job-based cleanup is authoritative.
            }
        }

        private static bool WaitForJobEmpty(SafeJobHandle job, int deadlineMs)
        {
            int elapsed = 0;
            while (elapsed < deadlineMs)
            {
                JOBOBJECT_BASIC_ACCOUNTING_INFORMATION info;
                int ret;
                if (!NativeMethods.QueryInformationJobObject(
                    job, JobObjectBasicAccountingInformation,
                    out info, Marshal.SizeOf(typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION)), out ret))
                    return false;
                if (info.ActiveProcesses == 0) return true;
                Thread.Sleep(50);
                elapsed += 50;
            }
            return false;
        }

        // -------------------------------------------------------------------
        // Constants
        // -------------------------------------------------------------------

        private const uint CREATE_SUSPENDED = 0x00000004;
        private const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
        private const uint PROC_THREAD_ATTRIBUTE_HANDLE_LIST = 0x00020002;
        private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
        private const int JobObjectExtendedLimitInformation = 9;
        private const int JobObjectBasicAccountingInformation = 1;
        private const int HANDLE_FLAG_INHERIT = 0x00000001;
        private const uint STARTF_USESTDHANDLES = 0x00000100;
        private const uint STARTF_USESHOWWINDOW = 0x00000001;
        private const short SW_HIDE = 0;
        private const int SYNCHRONIZE = 0x00100000;
        private const int PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
        private const uint INFINITE = 0xFFFFFFFF;
        private const uint WAIT_OBJECT_0 = 0;
        private const int STILL_ACTIVE = 259;

        // -------------------------------------------------------------------
        // Minimal JSON reader (no external assembly dependency)
        // -------------------------------------------------------------------

        private static class Json
        {
            private static string source;
            private static int index;

            internal static object Parse(string text)
            {
                if (string.IsNullOrEmpty(text)) throw new FormatException("empty json");
                source = text;
                index = 0;
                object value = ReadValue();
                SkipWhitespace();
                if (index != source.Length) throw new FormatException("trailing content");
                return value;
            }

            private static char Peek() => index < source.Length ? source[index] : '\0';

            private static void SkipWhitespace()
            {
                while (index < source.Length)
                {
                    char c = source[index];
                    if (c == ' ' || c == '\t' || c == '\n' || c == '\r') index++;
                    else break;
                }
            }

            private static object ReadValue()
            {
                SkipWhitespace();
                if (index >= source.Length) throw new FormatException("unexpected end");
                char c = source[index];
                if (c == '{') return ReadObject();
                if (c == '[') return ReadArray();
                if (c == '"') return ReadString();
                if (c == 't') return ReadLiteral("true", true);
                if (c == 'f') return ReadLiteral("false", false);
                if (c == 'n') return ReadLiteral("null", null);
                if (c == '-' || (c >= '0' && c <= '9')) return ReadNumber();
                throw new FormatException("unexpected token");
            }

            private static Dictionary<string, object> ReadObject()
            {
                var dict = new Dictionary<string, object>();
                index++; // {
                SkipWhitespace();
                if (Peek() == '}') { index++; return dict; }
                while (true)
                {
                    SkipWhitespace();
                    if (Peek() != '"') throw new FormatException("expected key");
                    string key = ReadString();
                    SkipWhitespace();
                    if (Peek() != ':') throw new FormatException("expected colon");
                    index++; // :
                    dict[key] = ReadValue();
                    SkipWhitespace();
                    char c = Peek();
                    if (c == ',') { index++; continue; }
                    if (c == '}') { index++; break; }
                    throw new FormatException("expected , or }");
                }
                return dict;
            }

            private static List<object> ReadArray()
            {
                var list = new List<object>();
                index++; // [
                SkipWhitespace();
                if (Peek() == ']') { index++; return list; }
                while (true)
                {
                    list.Add(ReadValue());
                    SkipWhitespace();
                    char c = Peek();
                    if (c == ',') { index++; continue; }
                    if (c == ']') { index++; break; }
                    throw new FormatException("expected , or ]");
                }
                return list;
            }

            private static string ReadString()
            {
                index++; // opening quote
                var sb = new StringBuilder();
                while (index < source.Length)
                {
                    char c = source[index++];
                    if (c == '"') return sb.ToString();
                    if (c == '\\')
                    {
                        if (index >= source.Length) throw new FormatException("bad escape");
                        char e = source[index++];
                        switch (e)
                        {
                            case '"': sb.Append('"'); break;
                            case '\\': sb.Append('\\'); break;
                            case '/': sb.Append('/'); break;
                            case 'b': sb.Append('\b'); break;
                            case 'f': sb.Append('\f'); break;
                            case 'n': sb.Append('\n'); break;
                            case 'r': sb.Append('\r'); break;
                            case 't': sb.Append('\t'); break;
                            case 'u':
                                if (index + 4 > source.Length) throw new FormatException("bad unicode escape");
                                string hex = source.Substring(index, 4);
                                index += 4;
                                sb.Append((char)int.Parse(hex, NumberStyles.HexNumber, CultureInfo.InvariantCulture));
                                break;
                            default: throw new FormatException("bad escape");
                        }
                    }
                    else
                    {
                        sb.Append(c);
                    }
                }
                throw new FormatException("unterminated string");
            }

            private static object ReadNumber()
            {
                int start = index;
                bool isDouble = false;
                while (index < source.Length)
                {
                    char c = source[index];
                    if (c >= '0' && c <= '9') { index++; }
                    else if (c == '-' || c == '+' || c == '.' || c == 'e' || c == 'E') { index++; if (c == '.' || c == 'e' || c == 'E') isDouble = true; }
                    else break;
                }
                string num = source.Substring(start, index - start);
                if (isDouble)
                {
                    double d;
                    if (!double.TryParse(num, NumberStyles.Float, CultureInfo.InvariantCulture, out d))
                        throw new FormatException("bad number");
                    return d;
                }
                long l;
                if (!long.TryParse(num, NumberStyles.Integer, CultureInfo.InvariantCulture, out l))
                    throw new FormatException("bad number");
                return l;
            }

            private static object ReadLiteral(string literal, object value)
            {
                if (index + literal.Length > source.Length) throw new FormatException("bad literal");
                for (int i = 0; i < literal.Length; i++)
                {
                    if (source[index + i] != literal[i]) throw new FormatException("bad literal");
                }
                index += literal.Length;
                return value;
            }
        }
    }

    // -----------------------------------------------------------------------
    // Win32 interop
    // -----------------------------------------------------------------------

    [SuppressUnmanagedCodeSecurity]
    internal sealed class SafeJobHandle : SafeHandleZeroOrMinusOneIsInvalid
    {
        internal SafeJobHandle() : base(true) { }

        internal SafeJobHandle(IntPtr handle) : base(true) { this.handle = handle; }

        protected override bool ReleaseHandle() => NativeMethods.CloseHandle(handle);
    }

    [SuppressUnmanagedCodeSecurity]
    internal sealed class SafeProcessHandle : SafeHandleZeroOrMinusOneIsInvalid
    {
        internal SafeProcessHandle() : base(true) { }

        internal SafeProcessHandle(IntPtr handle) : base(true) { this.handle = handle; }

        protected override bool ReleaseHandle() => NativeMethods.CloseHandle(handle);
    }

    [SuppressUnmanagedCodeSecurity]
    internal sealed class SafeThreadHandle : SafeHandleZeroOrMinusOneIsInvalid
    {
        internal SafeThreadHandle() : base(true) { }

        internal SafeThreadHandle(IntPtr handle) : base(true) { this.handle = handle; }

        protected override bool ReleaseHandle() => NativeMethods.CloseHandle(handle);
    }

    [StructLayout(LayoutKind.Sequential)]
    internal sealed class SECURITY_ATTRIBUTES
    {
        public int nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES));
        public IntPtr lpSecurityDescriptor = IntPtr.Zero;
        [MarshalAs(UnmanagedType.Bool)]
        public bool bInheritHandle = false;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct PROCESS_INFORMATION
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public int dwProcessId;
        public int dwThreadId;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    internal struct STARTUPINFO
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    internal struct STARTUPINFOEX
    {
        public STARTUPINFO StartupInfo;
        public IntPtr lpAttributeList;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public int LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public int ActiveProcessLimit;
        public IntPtr Affinity;
        public int PriorityClass;
        public int SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct IO_COUNTERS
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct JOBOBJECT_BASIC_ACCOUNTING_INFORMATION
    {
        public ulong TotalUserTime;
        public ulong TotalKernelTime;
        public ulong ThisPeriodTotalUserTime;
        public ulong ThisPeriodTotalKernelTime;
        public uint TotalPageFaultCount;
        public uint TotalProcesses;
        public uint ActiveProcesses;
        public uint TotalTerminatedProcesses;
    }

    [SuppressUnmanagedCodeSecurity]
    internal static class NativeMethods
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        internal static extern bool CreateJobObjectW(out SafeJobHandle hJob, IntPtr lpName);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern bool SetInformationJobObject(
            SafeJobHandle hJob, int jobObjectInfoClass,
            ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION lpJobObjectInfo, int cbJobObjectInfoLength);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern bool QueryInformationJobObject(
            SafeJobHandle hJob, int jobObjectInfoClass,
            out JOBOBJECT_BASIC_ACCOUNTING_INFORMATION lpJobObjectInfo,
            int cbJobObjectInfoLength, out int lpReturnLength);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern bool AssignProcessToJobObject(SafeJobHandle hJob, SafeProcessHandle hProcess);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern bool TerminateJobObject(SafeJobHandle hJob, uint uExitCode);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        internal static extern bool CreateProcessW(
            string lpApplicationName,
            StringBuilder lpCommandLine,
            IntPtr lpProcessAttributes,
            IntPtr lpThreadAttributes,
            bool bInheritHandles,
            uint dwCreationFlags,
            IntPtr lpEnvironment,
            string lpCurrentDirectory,
            ref STARTUPINFOEX lpStartupInfo,
            out PROCESS_INFORMATION lpProcessInformation);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern bool InitializeProcThreadAttributeList(
            IntPtr lpAttributeList, int dwAttributeCount, int dwFlags, ref IntPtr lpSize);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern bool UpdateProcThreadAttribute(
            IntPtr lpAttributeList, int dwFlags, IntPtr Attribute,
            IntPtr lpValue, IntPtr cbSize, IntPtr lpPreviousValue, IntPtr lpReturnSize);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern bool DeleteProcThreadAttributeList(IntPtr lpAttributeList);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern bool CreatePipe(
            out SafeFileHandle hReadPipe, out SafeFileHandle hWritePipe,
            SECURITY_ATTRIBUTES lpPipeAttributes, int nSize);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern bool SetHandleInformation(IntPtr hObject, int dwMask, int dwFlags);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern bool ResumeThread(SafeThreadHandle hThread);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern bool TerminateProcess(SafeProcessHandle hProcess, uint uExitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern IntPtr OpenProcess(int dwDesiredAccess, bool bInheritHandle, int dwProcessId);

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        internal static extern bool QueryFullProcessImageNameW(
            SafeProcessHandle hProcess, int dwFlags, StringBuilder lpExeName, ref int lpdwSize);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern uint WaitForMultipleObjects(
            int nCount, IntPtr[] lpHandles, bool bWaitAll, uint dwMilliseconds);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern bool GetExitCodeProcess(SafeProcessHandle hProcess, out int lpExitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern bool CloseHandle(IntPtr hObject);
    }
}
