param(
  [Parameter(Mandatory = $true)]
  [string]$SupabaseUrl,
  [Parameter(Mandatory = $true)]
  [string]$SupabaseServiceKey,
  [string]$SupabaseAnonKey = ""
)

$ProjectRoot = Split-Path -Parent $PSScriptRoot | Split-Path -Parent
$ScraperDir = Join-Path $ProjectRoot "scraper"
$FrontendDir = Join-Path $ProjectRoot "frontend"

Write-Host "=== AnimeStream Setup ===" -ForegroundColor Cyan

# 1. Create .env file for scraper
Write-Host "[1/5] Creating .env configuration..." -ForegroundColor Yellow
@"
SUPABASE_URL=$SupabaseUrl
SUPABASE_SERVICE_KEY=$SupabaseServiceKey
SCRAPER_PORT=3001
LOG_LEVEL=info
MAX_CONCURRENT_PAGES=3
REQUEST_DELAY_MS=2000
MAX_RETRIES=3
"@ | Set-Content -Path (Join-Path $ScraperDir ".env") -Force

# 2. Update frontend config
if ($SupabaseAnonKey) {
  Write-Host "[2/5] Updating frontend Supabase config..." -ForegroundColor Yellow
  $indexHtml = Join-Path $FrontendDir "index.html"
  $content = Get-Content $indexHtml -Raw
  $content = $content -replace "https://your-project.supabase.co", $SupabaseUrl
  $content = $content -replace "your-anon-key", $SupabaseAnonKey
  Set-Content -Path $indexHtml -Value $content
}

# 3. Install scraper dependencies
Write-Host "[3/5] Installing scraper dependencies..." -ForegroundColor Yellow
Set-Location $ScraperDir
npm install
npx playwright install chromium
if ($?) {
  Write-Host "  ✓ Playwright Chromium installed" -ForegroundColor Green
}

# 4. Create logs directory
Write-Host "[4/5] Creating logs directory..." -ForegroundColor Yellow
New-Item -ItemType Directory -Path (Join-Path $ScraperDir "logs") -Force | Out-Null

# 5. Test connection
Write-Host "[5/5] Testing Supabase connection..." -ForegroundColor Yellow
node (Join-Path $ScraperDir "src\test-connection.js")

Write-Host ""
Write-Host "=== Setup Complete ===" -ForegroundColor Green
Write-Host ""
Write-Host "To run the scraper:" -ForegroundColor Cyan
Write-Host "  npm run scrape:incremental  - Quick incremental scrape" -ForegroundColor White
Write-Host "  npm run scrape:full        - Full database scrape" -ForegroundColor White
Write-Host ""
Write-Host "To start the scheduler:" -ForegroundColor Cyan
Write-Host "  node src/scheduler.js" -ForegroundColor White
Write-Host ""
Write-Host "To serve the frontend:" -ForegroundColor Cyan
Write-Host "  Use any static file server (e.g., npx serve frontend)" -ForegroundColor White
