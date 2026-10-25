param([Parameter(Mandatory=$true)][string]$ProviderSource)
$ErrorActionPreference='Stop'
try {
  Add-Type -Path $ProviderSource
  $request = [Console]::ReadLine() | ConvertFrom-Json
  if ($request.operation -eq 'inspect') {
    $revision = [PapersConditionalFileSave]::Inspect($request.path,$request.approvedRoot)
    [Console]::WriteLine((@{kind='result';token=$revision.Token;sha256=$revision.Sha256} | ConvertTo-Json -Compress))
  } elseif ($request.operation -eq 'save') {
    $permission = [Action]{
      [Console]::WriteLine('{"kind":"authorize"}')
      [Console]::Out.Flush()
      if ([Console]::ReadLine() -ne 'commit-authorized') { throw 'Save permission was withdrawn' }
    }
    $result = [PapersConditionalFileSave]::SaveChecked($request.path,$request.workingCopy,$request.approvedRoot,$request.sourceSha256,$request.editedSha256,$request.token,$permission,$permission)
    [Console]::WriteLine((@{kind='result';savedSha256=$result.SavedSha256} | ConvertTo-Json -Compress))
  } else { throw 'Unsupported provider operation' }
} catch {
  $code='PROVIDER_REFUSED'
  if ($_.Exception.ToString().Contains('The source revision changed') -or $_.Exception.ToString().Contains('The source changed;')) { $code='VERSION_CHANGED' }
  [Console]::WriteLine((@{kind='error';code=$code} | ConvertTo-Json -Compress))
  exit 1
}
