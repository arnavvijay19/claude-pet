$ErrorActionPreference = 'Stop'

$utf8 = New-Object System.Text.UTF8Encoding($false, $true)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8

function Write-BoundedJson {
    param([Parameter(Mandatory = $true)] [object] $Value)
    $json = $Value | ConvertTo-Json -Compress -Depth 4
    if ($utf8.GetByteCount($json) -gt 32768) {
        throw 'Result is too large.'
    }
    [Console]::Out.WriteLine($json)
    [Console]::Out.Flush()
}

function Read-BoundedJson {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line -or $utf8.GetByteCount($line) -gt 32768) {
        throw 'Invalid request.'
    }
    return $line | ConvertFrom-Json
}

$nativeMethods = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

public static class ClaudePetNativeCliInspection {
    [StructLayout(LayoutKind.Sequential)]
    public struct BY_HANDLE_FILE_INFORMATION {
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
    public static extern bool GetFileInformationByHandle(
        SafeFileHandle handle,
        out BY_HANDLE_FILE_INFORMATION information);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern uint GetFinalPathNameByHandle(
        SafeFileHandle handle,
        StringBuilder path,
        uint pathLength,
        uint flags);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint GetFileType(SafeFileHandle handle);
}
'@

$null = Add-Type -TypeDefinition $nativeMethods -Language CSharp

function Get-FinalPath {
    param([Parameter(Mandatory = $true)] $Handle)
    $builder = New-Object System.Text.StringBuilder 32768
    $length = [ClaudePetNativeCliInspection]::GetFinalPathNameByHandle(
        $Handle, $builder, [uint32]$builder.Capacity, [uint32]0)
    if ($length -eq 0 -or $length -ge $builder.Capacity) {
        throw 'Unable to resolve final path.'
    }
    $resolved = $builder.ToString()
    if ($resolved.StartsWith('\\?\UNC\', [StringComparison]::OrdinalIgnoreCase)) {
        return '\\' + $resolved.Substring(8)
    }
    if ($resolved.StartsWith('\\?\', [StringComparison]::OrdinalIgnoreCase)) {
        return $resolved.Substring(4)
    }
    return $resolved
}

function ConvertTo-NormalizedPath {
    param(
        [Parameter(Mandatory = $true)] [string] $Value,
        [Parameter(Mandatory = $true)] [string] $RelativeBase
    )
    $candidate = $Value
    if ($candidate.StartsWith('\??\UNC\', [StringComparison]::OrdinalIgnoreCase)) {
        $candidate = '\\' + $candidate.Substring(8)
    } elseif ($candidate.StartsWith('\??\', [StringComparison]::OrdinalIgnoreCase)) {
        $candidate = $candidate.Substring(4)
    } elseif ($candidate.StartsWith('\\?\UNC\', [StringComparison]::OrdinalIgnoreCase)) {
        $candidate = '\\' + $candidate.Substring(8)
    } elseif ($candidate.StartsWith('\\?\', [StringComparison]::OrdinalIgnoreCase)) {
        $candidate = $candidate.Substring(4)
    }
    if (-not [IO.Path]::IsPathRooted($candidate)) {
        $candidate = [IO.Path]::Combine($RelativeBase, $candidate)
    }
    $normalized = [IO.Path]::GetFullPath($candidate)
    if ($utf8.GetByteCount($normalized) -gt 16384) {
        throw 'Reparse path is too large.'
    }
    return $normalized
}

function Find-FirstReparseComponent {
    param([Parameter(Mandatory = $true)] [string] $CandidatePath)
    $fullPath = [IO.Path]::GetFullPath($CandidatePath)
    $root = [IO.Path]::GetPathRoot($fullPath)
    if ([string]::IsNullOrEmpty($root)) {
        throw 'Candidate must be absolute.'
    }
    $current = $root
    if (([IO.File]::GetAttributes($current) -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        return Get-Item -LiteralPath $current -Force
    }
    $relative = $fullPath.Substring($root.Length)
    foreach ($component in $relative.Split([char[]]'\', [StringSplitOptions]::RemoveEmptyEntries)) {
        $current = [IO.Path]::Combine($current, $component)
        if (([IO.File]::GetAttributes($current) -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            return Get-Item -LiteralPath $current -Force
        }
    }
    return $null
}

function Get-NormalizedReparseChain {
    param(
        [Parameter(Mandatory = $true)] [string] $CandidatePath,
        [Parameter(Mandatory = $true)] [string] $ExpectedFinalPath
    )
    $chain = @()
    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $currentPath = [IO.Path]::GetFullPath($CandidatePath)
    for ($depth = 0; $depth -le 8; $depth += 1) {
        $item = Find-FirstReparseComponent -CandidatePath $currentPath
        if ($null -eq $item) {
            break
        }
        if ($depth -eq 8) {
            throw 'Reparse depth exceeded.'
        }
        $linkPath = [IO.Path]::GetFullPath($item.FullName)
        if (-not $seen.Add($linkPath)) {
            throw 'Reparse cycle detected.'
        }
        $targets = @($item.Target)
        if ($targets.Count -ne 1 -or $targets[0] -isnot [string] -or
            [string]::IsNullOrWhiteSpace($targets[0])) {
            throw 'Invalid reparse target.'
        }
        $type = switch -Regex ([string]$item.LinkType) {
            '^Junction$' { 'junction'; break }
            '^SymbolicLink$' { 'symbolic-link'; break }
            default { throw 'Unsupported reparse type.' }
        }
        $rawTarget = ConvertTo-NormalizedPath -Value $targets[0] -RelativeBase ([IO.Path]::GetDirectoryName($linkPath))
        $remaining = $currentPath.Substring($linkPath.Length).TrimStart([char[]]'\')
        $chain += [pscustomobject][ordered]@{
            path = $linkPath
            rawTarget = $rawTarget
            type = $type
        }
        $currentPath = if ([string]::IsNullOrEmpty($remaining)) {
            $rawTarget
        } else {
            [IO.Path]::GetFullPath([IO.Path]::Combine($rawTarget, $remaining))
        }
    }
    if (-not $currentPath.Equals($ExpectedFinalPath, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Reparse terminal path mismatch.'
    }
    return $chain
}

function Get-PublisherOrganization {
    param($Certificate)
    if ($null -eq $Certificate) {
        return ''
    }
    $decoded = $Certificate.SubjectName.Decode(
        [Security.Cryptography.X509Certificates.X500DistinguishedNameFlags]::UseNewLines -bor
        [Security.Cryptography.X509Certificates.X500DistinguishedNameFlags]::DoNotUseQuotes)
    foreach ($line in $decoded -split "`r?`n") {
        if ($line -match '^\s*O\s*=\s*(.+?)\s*$') {
            return $Matches[1]
        }
    }
    return ''
}

$stream = $null
$ready = $false
$exitCode = 1
try {
    $request = Read-BoundedJson
    $requestKeys = @($request.PSObject.Properties.Name)
    if ($requestKeys.Count -ne 1 -or $requestKeys[0] -ne 'path' -or
        $request.path -isnot [string] -or [string]::IsNullOrWhiteSpace($request.path) -or
        -not [IO.Path]::IsPathRooted($request.path) -or
        -not $request.path.EndsWith('.exe', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Invalid request.'
    }

    $stream = New-Object IO.FileStream(
        $request.path,
        [IO.FileMode]::Open,
        [IO.FileAccess]::Read,
        [IO.FileShare]::Read,
        4096,
        [IO.FileOptions]::SequentialScan)
    $handle = $stream.SafeFileHandle

    $information = New-Object ClaudePetNativeCliInspection+BY_HANDLE_FILE_INFORMATION
    if (-not [ClaudePetNativeCliInspection]::GetFileInformationByHandle($handle, [ref]$information)) {
        throw 'Unable to inspect file identity.'
    }
    $finalPath = Get-FinalPath -Handle $handle
    $fileType = [ClaudePetNativeCliInspection]::GetFileType($handle)
    $attributes = [IO.FileAttributes]$information.FileAttributes
    $regularFile = $fileType -eq 1 -and ($attributes -band [IO.FileAttributes]::Directory) -eq 0
    $reparseChain = @(Get-NormalizedReparseChain -CandidatePath $request.path -ExpectedFinalPath $finalPath)
    $reparsePoint = $reparseChain.Count -gt 0

    $stream.Position = 0
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $hashBytes = $sha.ComputeHash($stream)
    } finally {
        $sha.Dispose()
    }
    $sha256 = ([BitConverter]::ToString($hashBytes)).Replace('-', '').ToLowerInvariant()

    $signature = Get-AuthenticodeSignature -LiteralPath $finalPath
    $signatureValid = $signature.Status -eq [System.Management.Automation.SignatureStatus]::Valid
    $publisher = Get-PublisherOrganization -Certificate $signature.SignerCertificate
    $versionInfo = [Diagnostics.FileVersionInfo]::GetVersionInfo($finalPath)
    $version = $versionInfo.ProductVersion
    if ([string]::IsNullOrWhiteSpace($version)) {
        $version = $versionInfo.FileVersion
    }
    if ($null -eq $version) {
        $version = ''
    }

    $facts = [ordered]@{
        path = $finalPath
        regularFile = [bool]$regularFile
        reparsePoint = [bool]$reparsePoint
        reparseChain = $reparseChain
        sha256 = $sha256
        volumeSerial = ('{0:X8}' -f [uint32]$information.VolumeSerialNumber)
        fileId = ('{0:X8}{1:X8}' -f [uint32]$information.FileIndexHigh, [uint32]$information.FileIndexLow)
        fileVersion = [string]$version
        publisher = [string]$publisher
        signatureValid = [bool]$signatureValid
    }
    Write-BoundedJson ([ordered]@{ type = 'ready'; facts = $facts })
    $ready = $true

    # The parent deliberately keeps stdin open. EOF or any bounded release request
    # closes this FILE_SHARE_READ-only handle; no path is accepted a second time.
    $releaseLine = [Console]::In.ReadLine()
    if ($null -ne $releaseLine) {
        if ($utf8.GetByteCount($releaseLine) -gt 32768) {
            throw 'Invalid release request.'
        }
        $release = $releaseLine | ConvertFrom-Json
        $releaseKeys = @($release.PSObject.Properties.Name)
        if ($releaseKeys.Count -ne 1 -or $releaseKeys[0] -ne 'action' -or $release.action -ne 'release') {
            throw 'Invalid release request.'
        }
    }
    $exitCode = 0
} catch {
    if (-not $ready) {
        try { Write-BoundedJson ([ordered]@{ type = 'error'; code = 'INSPECTION_FAILED' }) } catch {}
    }
} finally {
    if ($null -ne $stream) {
        $stream.Dispose()
    }
}

exit $exitCode
