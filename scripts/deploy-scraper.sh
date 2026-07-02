#!/bin/bash
# Deploy scraper to Ubuntu/Debian cloud server
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${CYAN}=== AnimeStream Scraper Deployment ===${NC}"

# Configuration
read -p "Supabase URL: " SUPABASE_URL
read -sp "Supabase Service Key: " SUPABASE_KEY
echo ""

# System dependencies
echo -e "${YELLOW}[1/6] Installing system dependencies...${NC}"
apt-get update -qq
apt-get install -y -qq curl gnupg git build-essential libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libdbus-1-3 libexpat1 libxcb1 libxkbcommon0 libx11-6 libxcomposite1 \
  libxdamage1 libxext6 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 \
  libasound2 libatspi2.0-0 > /dev/null 2>&1

# Node.js
echo -e "${YELLOW}[2/6] Installing Node.js...${NC}"
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
  apt-get install -y -qq nodejs > /dev/null 2>&1
fi
echo -e "${GREEN}  ✓ Node.js $(node -v)${NC}"

# Clone / Copy project
echo -e "${YELLOW}[3/6] Setting up project...${NC}"
PROJECT_DIR="/opt/anime-streaming"
mkdir -p $PROJECT_DIR
cp -r ../* $PROJECT_DIR/ 2>/dev/null || true
cd $PROJECT_DIR/scraper

# Dependencies
echo -e "${YELLOW}[4/6] Installing npm dependencies...${NC}"
npm install --quiet 2>&1 | tail -1
npx playwright install chromium 2>&1 | tail -1

# Environment
echo -e "${YELLOW}[5/6] Configuring environment...${NC}"
cat > .env << EOF
SUPABASE_URL=${SUPABASE_URL}
SUPABASE_SERVICE_KEY=${SUPABASE_KEY}
SCRAPER_PORT=3001
LOG_LEVEL=info
MAX_CONCURRENT_PAGES=3
REQUEST_DELAY_MS=2000
MAX_RETRIES=3
EOF

# Systemd service
echo -e "${YELLOW}[6/6] Creating systemd service...${NC}"
cat > /etc/systemd/system/anime-scraper.service << EOF
[Unit]
Description=AnimeStream Scraper Scheduler
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${PROJECT_DIR}/scraper
ExecStart=/usr/bin/node ${PROJECT_DIR}/scraper/src/scheduler.js
Restart=always
RestartSec=30
Environment=NODE_ENV=production
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable anime-scraper
systemctl start anime-scraper

echo -e "${GREEN}=== Deployment Complete ===${NC}"
echo -e "Service: anime-scraper"
echo -e "Status: $(systemctl is-active anime-scraper)"
echo -e "Logs: journalctl -u anime-scraper -f"
