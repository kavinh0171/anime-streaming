# AnimeStream - Anime Streaming Platform

A complete anime streaming website with automated scraping from toonstream.vip, Supabase backend, and a Crunchyroll-like UI.

## Architecture

```
anime-streaming/
├── frontend/          # Static website (HTML, CSS, JS)
│   ├── index.html     # SPA entry point
│   ├── css/style.css  # Crunchyroll-like styles
│   └── js/
│       ├── api.js     # Supabase REST client
│       └── app.js     # SPA router & UI logic
├── scraper/           # Playwright scraper
│   ├── src/
│   │   ├── index.js         # Entry & orchestration
│   │   ├── browser.js       # Playwright browser mgmt
│   │   ├── series-scraper.js # Series scraping logic
│   │   ├── movies-scraper.js # Movies scraping logic
│   │   ├── supabase.js      # Database operations
│   │   ├── scheduler.js     # Cron scheduler
│   │   └── logger.js        # Winston logging
│   └── package.json
├── database/
│   ├── schema.sql    # Full Supabase schema
│   └── config.js     # Supabase client
├── scripts/          # Deployment & automation
├── docker-compose.yml
└── vercel.json
```

## Prerequisites

- Node.js >= 18
- Supabase project (free tier works)
- For scraper: Playwright (installed automatically)

## Quick Setup

### 1. Supabase Database

1. Create a Supabase project at https://supabase.com
2. Go to SQL Editor → New Query
3. Copy and paste `database/schema.sql` → Run
4. Go to Project Settings → API → copy URL and anon key

### 2. Frontend Config

Edit `frontend/index.html` and replace:
- `https://your-project.supabase.co` → your Supabase URL
- `your-anon-key` → your Supabase anon key

Or use the setup script:
```powershell
.\scripts\setup.ps1 -SupabaseUrl "https://your-project.supabase.co" -SupabaseServiceKey "service-role-key" -SupabaseAnonKey "anon-key"
```

### 3. Run Frontend

```powershell
# Option 1: Vercel (recommended)
npx vercel --prod

# Option 2: Static server
npx serve frontend -l 3000

# Option 3: PowerShell script
.\scripts\serve-frontend.ps1 -Port 3000
```

### 4. Run Scraper

```powershell
cd scraper
npm install
npx playwright install chromium
npm run scrape:incremental   # Quick test (10 series)
npm run scrape:full          # Full database scrape
```

### 5. Daily Automation

**Local (PowerShell):**
```powershell
# Use Task Scheduler to run:
powershell -File "C:\path\to\scripts\run-scraper.ps1" -Type full
```

**Cloud (systemd):**
```bash
chmod +x scripts/deploy-scraper.sh
sudo ./scripts/deploy-scraper.sh
```

**Docker:**
```bash
docker-compose up -d
```

## Scraper Features

- **Browser automation** via Playwright for JavaScript-heavy pages
- **Handles dynamic content** - watches DOM changes for episode/season switching
- **Concurrent scraping** with configurable parallelism
- **Retry logic** with exponential backoff
- **User-agent rotation** to avoid blocking
- **Incremental updates** - only scrapes new content
- **Comprehensive logging** via Winston

## Database Schema

| Table | Purpose |
|-------|---------|
| `anime_series` | Core anime metadata |
| `seasons` | Season groupings per series |
| `episodes` | Individual episode data |
| `video_sources` | Video URLs (iframe/direct) |
| `genres` | Genre tags |
| `anime_genres` | Many-to-many junction |
| `featured_anime` | Homepage curation |
| `scraping_logs` | Scraper run history |

## API Endpoints (Supabase REST)

The frontend uses Supabase REST API directly:

```
GET /rest/v1/anime_series?select=*,seasons(*),episodes(*)
GET /rest/v1/anime_series?title=ilike.*naruto*
GET /rest/v1/genres
GET /rest/v1/featured_anime?select=anime_series(*)
```

## Deployment

### Frontend (Vercel)
```bash
npx vercel --prod
```

### Scraper (Docker)
```bash
docker-compose up -d
```

### Scraper (Cloud VM)
```bash
# Copy files to server, then:
sudo bash scripts/deploy-scraper.sh
```

## Monitoring

Check scraper logs:
```bash
# systemd
journalctl -u anime-scraper -f

# Docker
docker logs -f anime-scraper

# Local
cat scraper/logs/combined.log
```

View scrape history in Supabase: `SELECT * FROM scraping_logs ORDER BY started_at DESC;`

## Security

- Use Supabase Row Level Security (RLS) - already configured in schema
- Service role key for scraper, anon key for frontend
- Rate limiting built into scraper (configurable delay)
- No sensitive data exposed to frontend
