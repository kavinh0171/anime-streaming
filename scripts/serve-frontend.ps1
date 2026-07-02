param(
  [int]$Port = 3000
)

$FrontendDir = Join-Path $PSScriptRoot "..\frontend"

Write-Host "Starting frontend server..." -ForegroundColor Cyan
Write-Host "URL: http://localhost:$Port" -ForegroundColor Green

# Check if npx is available
if (Get-Command "npx" -ErrorAction SilentlyContinue) {
  npx serve $FrontendDir -l $Port --no-clipboard
} else {
  Write-Host "npx not found. Install Node.js or use another static file server." -ForegroundColor Red
  Write-Host "Alternative: python -m http.server $Port -d $FrontendDir" -ForegroundColor Yellow
  python -m http.server $Port -d $FrontendDir
}
