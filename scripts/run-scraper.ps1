param(
  [ValidateSet("full", "incremental", "series", "movies")]
  [string]$Type = "incremental"
)

$ScraperDir = Join-Path $PSScriptRoot "..\scraper"
Set-Location $ScraperDir

$LogDir = Join-Path $ScraperDir "logs"
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$LogFile = Join-Path $LogDir "scrape-$Type-$Timestamp.log"

Write-Host "Starting $Type scrape..." -ForegroundColor Cyan
Write-Host "Log: $LogFile" -ForegroundColor Gray

node src/index.js --type=$Type 2>&1 | Tee-Object -FilePath $LogFile

if ($LASTEXITCODE -eq 0) {
  Write-Host "Scrape completed successfully!" -ForegroundColor Green
} else {
  Write-Host "Scrape failed with exit code $LASTEXITCODE" -ForegroundColor Red
}
