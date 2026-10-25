param([switch]$DeviceChecks)
$ErrorActionPreference = 'Stop'
$signingDirectory = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'PapersMobileSigning'
New-Item -ItemType Directory -Path $signingDirectory -Force | Out-Null
$keyPath = Join-Path $signingDirectory 'papers-mobile.jks'
$passwordPath = Join-Path $signingDirectory 'password.dpapi'
$keytoolPath = 'D:\Programs\Android Studio\jbr\bin\keytool.exe'
if (Test-Path -LiteralPath $keyPath) {
  if (-not (Test-Path -LiteralPath $passwordPath)) { throw 'Signing password needs recovery; refusing to replace the existing signing identity.' }
  $protectedPassword = [IO.File]::ReadAllBytes($passwordPath)
  $passwordBytes = [Security.Cryptography.ProtectedData]::Unprotect($protectedPassword, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
} else {
  if (Test-Path -LiteralPath $passwordPath) { throw 'Signing key needs recovery; refusing to create a replacement identity.' }
  $randomBytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Fill($randomBytes)
  $passwordBytes = [Text.Encoding]::UTF8.GetBytes([Convert]::ToBase64String($randomBytes))
  $protectedPassword = [Security.Cryptography.ProtectedData]::Protect($passwordBytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  [IO.File]::WriteAllBytes($passwordPath, $protectedPassword)
}
$env:PAPERS_ANDROID_STORE_PASSWORD = [Text.Encoding]::UTF8.GetString($passwordBytes)
$env:PAPERS_ANDROID_KEY_PASSWORD = $env:PAPERS_ANDROID_STORE_PASSWORD
$env:PAPERS_ANDROID_KEYSTORE = $keyPath
try {
  if (-not (Test-Path -LiteralPath $keyPath)) {
    & $keytoolPath -genkeypair -alias papers-mobile -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=Papers Mobile, O=Futahua' -keystore $keyPath -storepass:env PAPERS_ANDROID_STORE_PASSWORD -keypass:env PAPERS_ANDROID_KEY_PASSWORD
    if ($LASTEXITCODE -ne 0) { throw 'Signing identity generation failed.' }
  }
  if ($DeviceChecks) { & node (Join-Path $PSScriptRoot 'build.mjs') --device-checks }
  else { & node (Join-Path $PSScriptRoot 'build.mjs') }
  if ($LASTEXITCODE -ne 0) { throw 'Android build or signing failed.' }
} finally {
  Remove-Item Env:PAPERS_ANDROID_STORE_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:PAPERS_ANDROID_KEY_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:PAPERS_ANDROID_KEYSTORE -ErrorAction SilentlyContinue
  [Array]::Clear($passwordBytes, 0, $passwordBytes.Length)
}
