$ErrorActionPreference = 'Stop'
Add-Type -Path (Join-Path $PSScriptRoot '../resources/native/conditional-file-save.cs')
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('papers-conditional-save-' + [Guid]::NewGuid())
[IO.Directory]::CreateDirectory($fixtureRoot) | Out-Null
function Digest($path) {
  $stream = [IO.File]::OpenRead($path)
  $hash = [Security.Cryptography.SHA256]::Create()
  try { [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-','').ToLowerInvariant() }
  finally { $stream.Dispose(); $hash.Dispose() }
}
foreach ($operation in @('commit','source-conflict','upload-conflict','cancel','write','delete-recreate','rename','replace','parent-rename','truncate','empty','outside-root','same-file','hard-link')) {
  $directory = Join-Path $fixtureRoot $operation
  [IO.Directory]::CreateDirectory($directory) | Out-Null
  $source = Join-Path $directory 'source.bin'
  $upload = Join-Path $fixtureRoot ($operation + '-upload.bin')
  [IO.File]::WriteAllBytes($source, [byte[]](1,2,3,4,5,6,7,8))
  [IO.File]::WriteAllBytes($upload, [byte[]](9,8,7))
  if ($operation -eq 'empty') { [IO.File]::WriteAllBytes($upload, [byte[]]@()) }
  $sourceHash = Digest $source
  $uploadHash = Digest $upload
  if ($operation -eq 'source-conflict') { [IO.File]::WriteAllText($source,'external') }
  if ($operation -eq 'upload-conflict') { [IO.File]::WriteAllText($upload,'external') }
  $before = Digest $source
  $approvedRoot = $directory
  $replacement = $upload
  if ($operation -eq 'outside-root') { $approvedRoot = Join-Path $fixtureRoot 'other' }
  if ($operation -eq 'same-file') { $replacement = $source }
  if ($operation -eq 'hard-link') { New-Item -ItemType HardLink -Path ($source+'.link') -Target $source | Out-Null }
  $script:blocked = $false
  $prepared = [Action]{
    if ($operation -eq 'cancel') { throw 'Generated cancellation' }
    try {
      switch ($operation) {
        'write' { [IO.File]::WriteAllText($source,'external') }
        'delete-recreate' { [IO.File]::Delete($source); [IO.File]::WriteAllText($source,'external') }
        'rename' { [IO.File]::Move($source,$source+'.moved') }
        'replace' { [IO.File]::Replace($upload,$source,$null) }
        'parent-rename' { [IO.Directory]::Move($directory,$directory+'.moved') }
      }
    } catch { $script:blocked = $true }
  }
  $failed = $false
  try { $result = [PapersConditionalFileSave]::Save($source,$replacement,$approvedRoot,$sourceHash,$uploadHash,$prepared) } catch {
    if ($operation -notin @('source-conflict','upload-conflict','cancel','outside-root','same-file','hard-link')) { throw }
    $failed = $true
  }
  if ($operation -in @('source-conflict','upload-conflict','cancel','outside-root','same-file','hard-link')) {
    if (!$failed -or (Digest $source) -ne $before) { throw "Refusal changed source: $operation" }
  } else {
    if ((Digest $source) -ne $uploadHash -or $result.SavedSha256 -ne $uploadHash) { throw "Saved bytes differ: $operation" }
    if ($operation -in @('write','delete-recreate','rename','replace','parent-rename') -and !$script:blocked) { throw "Concurrent operation escaped fence: $operation" }
  }
  if (!(Test-Path -LiteralPath $upload)) { throw "Working copy lost: $operation" }
  Write-Output "PASS $operation"
}
Write-Output "Generated fixtures retained at $fixtureRoot"
