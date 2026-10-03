param(
  [Parameter(Mandatory = $true)][string]$MarkerPath,
  [int]$X = 120,
  [int]$Y = 140
)

# Launches exactly ONE uniquely titled disposable WinForms window owned by the
# live-proof harness. Writes { pid, title } to the marker path, then runs the
# message loop until the window is closed (WM_CLOSE exits the process).
# The window is visible, top-level, has a non-empty exact title and positive
# bounds, so it is an eligible helper candidate. Nothing else is ever touched.

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = "AYG-015R3-$PID-" + ([System.Guid]::NewGuid().ToString('N').Substring(0, 8))
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$form.Location = New-Object System.Drawing.Point($X, $Y)
$form.Size = New-Object System.Drawing.Size(400, 300)
$form.ShowInTaskbar = $true
$form.MinimizeBox = $true
$form.MaximizeBox = $true

@{ pid = $PID; title = $form.Text; x = $X; y = $Y }
  | ConvertTo-Json -Compress
  | Set-Content -LiteralPath $MarkerPath -Encoding UTF8

[System.Windows.Forms.Application]::Run($form)
