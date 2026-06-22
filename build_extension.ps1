$ManifestPath = "extension\manifest.json"
$ReleasesDir = "releases"

If (-Not (Test-Path $ManifestPath)) {
    Write-Host "Erro: manifest.json não encontrado em $ManifestPath" -ForegroundColor Red
    Exit
}

$ManifestContent = Get-Content $ManifestPath | Out-String
$ManifestData = ConvertFrom-Json $ManifestContent
$Version = $ManifestData.version

If (-Not (Test-Path $ReleasesDir)) {
    New-Item -ItemType Directory -Force -Path $ReleasesDir | Out-Null
}

$ZipFileName = "CaptureOS_Extension_v$Version.zip"
$ZipFilePath = Join-Path $ReleasesDir $ZipFileName

If (Test-Path $ZipFilePath) {
    Remove-Item $ZipFilePath -Force
}

Write-Host "Empacotando a versão v$Version..." -ForegroundColor Cyan
Compress-Archive -Path "extension\*" -DestinationPath $ZipFilePath -Force
Write-Host "Sucesso! Arquivo gerado em: $ZipFilePath" -ForegroundColor Green
