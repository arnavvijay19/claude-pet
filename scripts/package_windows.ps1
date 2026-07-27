Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'dist'
$folder = Join-Path $dist 'Claude Pet-win32-x64'
$zip = Join-Path $dist 'Claude-Pet-win32-x64.zip'
foreach ($path in @($folder, $zip)) {
  if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }
}
& npm.cmd run package:win
if ($LASTEXITCODE -ne 0) { throw 'Electron packaging failed.' }
& node (Join-Path $root 'scripts\verify_package.js') $folder
if ($LASTEXITCODE -ne 0) { throw 'Package verification failed.' }
foreach ($entry in Get-ChildItem -LiteralPath $folder -Recurse -Force) {
  if ($entry.LastWriteTimeUtc -lt [datetime]'1980-01-02T00:00:00Z') {
    $entry.LastWriteTimeUtc = [datetime]'1980-01-02T00:00:00Z'
  }
}
Compress-Archive -LiteralPath $folder -DestinationPath $zip -Force
Get-FileHash -LiteralPath $zip -Algorithm SHA256
