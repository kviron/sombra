$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$config=Get-Content tauri.conf.json -Raw | ConvertFrom-Json
$env:SOMBRA_UPDATER_PUBLIC_KEY=$config.plugins.updater.pubkey
$env:SOMBRA_UPDATER_ENDPOINT=$config.plugins.updater.endpoints[0]
$env:TAURI_SIGNING_PRIVATE_KEY=(Resolve-Path release-secrets/sombra.key).Path
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD=''
node release-build.mjs
if ($LASTEXITCODE -ne 0) { throw 'Release build failed' }
$installer=Get-Item "target/release/bundle/nsis/$($config.productName)_$($config.version)_x64-setup.exe"
if (!(Test-Path "$($installer.FullName).sig")) { throw 'Signed installer is missing' }
node release-manifest.mjs $installer.FullName "https://sombra.mi-nerva.ru/updates/$($config.version)/$($installer.Name)"
if ($LASTEXITCODE -ne 0) { throw 'Manifest generation failed' }
$destination=Join-Path $PSScriptRoot "release/$($config.version)"
New-Item -ItemType Directory -Force -Path $destination | Out-Null
Copy-Item -LiteralPath $installer.FullName -Destination $destination
Copy-Item -LiteralPath "$($installer.FullName).sig" -Destination $destination
Copy-Item -LiteralPath 'latest.json' -Destination $destination
Write-Host "Release ready: $destination"
