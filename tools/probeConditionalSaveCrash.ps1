param([string]$ChildDirectory)
$ErrorActionPreference = 'Stop'
Add-Type -Path (Join-Path $PSScriptRoot '../resources/native/conditional-file-save.cs')
function Digest($path) {
  $stream = [IO.File]::OpenRead($path)
  $hash = [Security.Cryptography.SHA256]::Create()
  try { [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-','').ToLowerInvariant() }
  finally { $stream.Dispose(); $hash.Dispose() }
}
if ($ChildDirectory) {
  $source = Join-Path $ChildDirectory 'source.bin'
  $upload = Join-Path $ChildDirectory 'upload.bin'
  $crash = [Action]{
    [IO.File]::WriteAllText((Join-Path $ChildDirectory 'flushed.marker'),'verified bytes flushed; not committed')
    [Diagnostics.Process]::GetCurrentProcess().Kill()
  }
  [PapersConditionalFileSave]::Save($source,$upload,$ChildDirectory,(Digest $source),(Digest $upload),$null,$crash) | Out-Null
  throw 'Crash callback returned unexpectedly'
}
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('papers-save-crash-' + [Guid]::NewGuid())
[IO.Directory]::CreateDirectory($fixture) | Out-Null
$source = Join-Path $fixture 'source.bin'
$upload = Join-Path $fixture 'upload.bin'
[IO.File]::WriteAllBytes($source,[byte[]](1,2,3,4,5))
[IO.File]::WriteAllBytes($upload,[byte[]](9,8,7))
$originalHash = Digest $source
$uploadHash = Digest $upload
$arguments = '-NoProfile -MTA -File "' + $PSCommandPath + '" -ChildDirectory "' + $fixture + '"'
$child = Start-Process powershell.exe -ArgumentList $arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $fixture 'stdout.txt') -RedirectStandardError (Join-Path $fixture 'stderr.txt')
if (!$child.WaitForExit(20000)) { throw "Generated crash probe is still running: PID $($child.Id); fixture $fixture" }
if (!(Test-Path -LiteralPath (Join-Path $fixture 'flushed.marker'))) { throw ('Child did not reach pre-commit checkpoint: ' + [IO.File]::ReadAllText((Join-Path $fixture 'stderr.txt'))) }
if ((Digest $source) -ne $originalHash -or (Digest $upload) -ne $uploadHash) { throw 'Process death lost source or working copy bytes' }
# Verify rollback released locks and a subsequent checked save succeeds.
[PapersConditionalFileSave]::Save($source,$upload,$fixture,$originalHash,$uploadHash,$null) | Out-Null
if ((Digest $source) -ne $uploadHash) { throw 'Subsequent save failed' }
Write-Output 'PASS real process death after flush: original and working copy retained; next save succeeded'
Write-Output "Generated fixture retained at $fixture"
