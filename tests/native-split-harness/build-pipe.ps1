param([string]$OutputDirectory=(Join-Path $env:TEMP 'papers-native-split-next'))
$ErrorActionPreference='Stop'
& (Join-Path $PSScriptRoot 'build.ps1') -OutputDirectory $OutputDirectory
$repo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$native=Join-Path $repo 'resources\native'
$output=[IO.Path]::GetFullPath($OutputDirectory)
$csc=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$sources=@('chrome-window-session.cs','pane-group.cs','pane-layout.cs','pane-presentation.cs','pane-coordinator.cs','pane-coordinator-hub.cs','pane-documents.cs','pane-mount.cs','pane-region-contract.cs','pane-host-region.cs','pane-chrome-resolver.cs','pane-coordinator-host.cs') | ForEach-Object {Join-Path $native $_}
$refs=@('UIAutomationClient.dll','UIAutomationTypes.dll','WindowsBase.dll') | ForEach-Object {'/r:'+(Join-Path (Split-Path $csc) ('WPF\'+$_))}
& $csc /nologo /target:exe "/out:$output\pane-coordinator-host.exe" /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll $refs $sources
if($LASTEXITCODE -ne 0){throw 'Production coordinator compilation failed.'}
& $csc /nologo /target:winexe "/out:$output\pipe-harness.exe" /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll "/r:$output\pane-next.dll" (Join-Path $PSScriptRoot 'PipeHarness.cs')
if($LASTEXITCODE -ne 0){throw 'Production pipe harness compilation failed.'}
$probe=Start-Process -FilePath "$output\pipe-harness.exe" -WindowStyle Hidden -PassThru
if(-not $probe.WaitForExit(60000)){throw 'Production pipe verification timed out.'}
$lines=Get-Content -LiteralPath "$output\pipe-result.txt"
$lines
if($lines | Where-Object {$_ -match '^FAIL'}){throw 'Production pipe assertion failed.'}
