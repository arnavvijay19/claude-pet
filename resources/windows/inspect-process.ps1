param(
  [Parameter(Mandatory = $true)]
  [ValidateRange(1, 2147483647)]
  [int]$ProcessId
)

$ErrorActionPreference = 'Stop'

try {
  $process = [System.Diagnostics.Process]::GetProcessById($ProcessId)
  $executablePath = $process.MainModule.FileName
  if ([string]::IsNullOrWhiteSpace($executablePath)) {
    throw 'The process executable path is unavailable.'
  }
  [ordered]@{
    exists = $true
    executablePath = $executablePath
  } | ConvertTo-Json -Compress
} catch [System.ArgumentException] {
  [ordered]@{
    exists = $false
    executablePath = $null
  } | ConvertTo-Json -Compress
} catch {
  Write-Error $_
  exit 1
}
