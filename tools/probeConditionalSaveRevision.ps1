$ErrorActionPreference='Stop'
Add-Type -Path (Join-Path $PSScriptRoot '../resources/native/conditional-file-save.cs')
$root=Join-Path ([IO.Path]::GetTempPath()) ('papers-save-revision-'+[Guid]::NewGuid())
[IO.Directory]::CreateDirectory($root) | Out-Null
foreach($operation in @('unchanged','timestamp','identical-replacement')) {
  $source=Join-Path $root ($operation+'.txt')
  $upload=Join-Path $root ($operation+'-upload.txt')
  [IO.File]::WriteAllText($source,'original')
  [IO.File]::WriteAllText($upload,'edited')
  $revision=[PapersConditionalFileSave]::Inspect($source,$root)
  $replacement=[PapersConditionalFileSave]::Inspect($upload,$root)
  if($operation -eq 'timestamp'){[IO.File]::SetLastWriteTimeUtc($source,[DateTime]::UtcNow.AddHours(-2))}
  if($operation -eq 'identical-replacement'){
    $other=Join-Path $root 'identical.txt';[IO.File]::WriteAllText($other,'original')
    [IO.File]::Replace($other,$source,(Join-Path $root 'replaced-original.txt'))
  }
  $refused=$false
  try{[PapersConditionalFileSave]::SaveChecked($source,$upload,$root,$revision.Sha256,$replacement.Sha256,$revision.Token,$null,$null) | Out-Null}
  catch{if($operation -eq 'unchanged'){throw};$refused=$true}
  if($operation -eq 'unchanged') {if([IO.File]::ReadAllText($source) -ne 'edited'){throw 'Save failed'}}
  else {if(!$refused -or [IO.File]::ReadAllText($source) -ne 'original'){throw 'Changed revision was overwritten'}}
  if([IO.File]::ReadAllText($upload) -ne 'edited'){throw 'Working copy lost'}
  Write-Output "PASS revision $operation"
}
Write-Output "Generated fixtures retained at $root"
