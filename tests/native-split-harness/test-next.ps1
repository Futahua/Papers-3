param([string]$OutputDirectory=(Join-Path $env:TEMP 'papers-native-split-next'))
$ErrorActionPreference='Stop'
$h=[IO.Path]::GetFullPath($OutputDirectory)
$exe=Join-Path $h 'native-split-next.exe'
$report=Join-Path $h 'next-validation.txt'
$lines=[Collections.Generic.List[string]]::new()
$checkpoint=Join-Path $h ('crash-mount-'+[guid]::NewGuid().ToString('N')+'.json')
$probe=$null
$mount=$null
try {
    $started=Get-Date
    $smoke=Start-Process -FilePath $exe -ArgumentList '--selftest' -WindowStyle Hidden -PassThru
    if(-not $smoke.WaitForExit(25000)){throw 'Selftest timed out.'}
    $result=Get-Item -LiteralPath (Join-Path $h 'smoke-result.txt')
    if($result.LastWriteTime -lt $started){throw 'Selftest did not produce fresh evidence.'}
    $checks=Get-Content -LiteralPath $result.FullName
    foreach($line in $checks){$lines.Add($line)}
    if($checks | Where-Object {$_ -match '^(FAIL|EXCEPTION)'}){throw 'Selftest assertion failed.'}

    $probe=Start-Process -FilePath $exe -ArgumentList @('--crash-probe',$checkpoint) -WindowStyle Hidden -PassThru
    $until=(Get-Date).AddSeconds(12)
    while(-not (Test-Path -LiteralPath ($checkpoint+'.ready')) -and (Get-Date) -lt $until){Start-Sleep -Milliseconds 40}
    if(-not (Test-Path -LiteralPath ($checkpoint+'.ready'))){throw 'Crash fixture did not become ready.'}
    $recovery=(Get-Content -LiteralPath ($checkpoint+'.ready') -Raw).Trim()
    $saved=Get-Content -LiteralPath $recovery -Raw | ConvertFrom-Json
    # Terminate only the exact disposable host launched above. Never a production app.
    $probe.Refresh()
    if($probe.HasExited -or $probe.Path -ne $exe -or $saved.HostPid -ne $probe.Id){throw 'Crash-host identity changed.'}
    Set-Content -LiteralPath ($recovery+".released") -Value "stale-previous-generation" -Encoding UTF8
    Stop-Process -Id $probe.Id -Force
    $until=(Get-Date).AddSeconds(12)
    while(-not (Test-Path -LiteralPath ($recovery+'.recovered')) -and -not (Test-Path -LiteralPath ($recovery+'.failed')) -and (Get-Date) -lt $until){Start-Sleep -Milliseconds 40}
    if(-not (Test-Path -LiteralPath ($recovery+'.recovered'))){throw 'Independent guard did not confirm recovery.'}
    $lines.Add("PASS stale release marker cannot disable current crash recovery generation")
    Add-Type -Path (Join-Path $h 'pane-next.dll')
    foreach($peer in $saved.Peers){
        $hwnd=[IntPtr][long]$peer.Window.Handle
        $placement=New-Object Native+Placement
        $placement.Length=[Runtime.InteropServices.Marshal]::SizeOf([type][Native+Placement])
        $okay=[Native]::GetWindowPlacement($hwnd,[ref]$placement)
        $expected=$peer.Window.Placement
        $okay=$okay -and $placement.Normal.L -eq $expected.Normal.L -and $placement.Normal.T -eq $expected.Normal.T -and $placement.Normal.R -eq $expected.Normal.R -and $placement.Normal.B -eq $expected.Normal.B -and $placement.Show -eq $expected.Show -and [Native]::IsWindowVisible($hwnd) -eq [bool]$peer.Window.Visible -and (([Native]::GetWindowLong($hwnd,-20) -band 8) -eq ([int]$peer.Window.ExStyle -band 8))
        if(-not $okay){throw ('Crash restoration mismatch for fixture '+$peer.Window.Handle)}
        $lines.Add('PASS independent crash guard restores full native state for fixture '+$peer.Window.Handle)
    }
    $mount=Start-Process -FilePath $exe -ArgumentList @('--remount-probe',$checkpoint) -WindowStyle Hidden -PassThru
    if(-not $mount.WaitForExit(15000)){throw 'Fresh-process remount timed out.'}
    $remount=Get-Content -LiteralPath ($checkpoint+'.remount-result') -Raw
    $lines.Add($remount.Trim())
    if(-not $remount.StartsWith('PASS')){throw 'Fresh-process remount failed.'}
} catch {
    $lines.Add('FAIL validation: '+$_.Exception.Message)
    throw
} finally {
    $lines | Set-Content -LiteralPath $report -Encoding UTF8
    # Clean only this run's named fixture executables if an assertion interrupted cleanup.
    if(Test-Path -LiteralPath $checkpoint){
        $data=Get-Content -LiteralPath $checkpoint -Raw | ConvertFrom-Json
        foreach($peer in $data.Peers){try{
            $fixture=Get-Process -Id $peer.Pid -ErrorAction Stop
            if($fixture.Path -eq $exe -and $fixture.MainWindowTitle.StartsWith('Native split fixture:')){$fixture.CloseMainWindow() | Out-Null}
        }catch{}}
    }
}
Write-Output ('PASS '+($lines | Where-Object {$_ -match '^PASS'}).Count+' checks. Evidence: '+$report)
