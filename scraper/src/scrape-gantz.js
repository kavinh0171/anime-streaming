require('dotenv').config();
const { chromium } = require('playwright');
const toonstream = require('./toonstream-scraper');
const logger = require('./logger');

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'] });
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
  try {
    const item = { title: 'GANTZ', rating: 8.5, image: '', slug: 'gantz', postId: '' };
    logger.info('Scraping GANTZ only...');
    const result = await toonstream.processAnimeItem(item, ctx);
    logger.info(`Result: ${JSON.stringify(result)}`);
  } finally { await browser.close(); }
}
main().catch(err => { console.error(err); process.exit(1); });
