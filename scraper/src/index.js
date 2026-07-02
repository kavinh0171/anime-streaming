require('dotenv').config();
const logger = require('./logger');
const db = require('./supabase');
const toonstream = require('./toonstream-scraper');

function clearLine() { process.stdout.write('\r\x1b[K'); }

// Intercept logger to clear progress line before each log
const _logInfo = logger.info.bind(logger);
const _logWarn = logger.warn.bind(logger);
const _logError = logger.error.bind(logger);
logger.info = (msg) => { clearLine(); _logInfo(msg); };
logger.warn = (msg) => { clearLine(); _logWarn(msg); };
logger.error = (msg, ...args) => { clearLine(); _logError(msg, ...args); };

let forceMode = false;
let maxPages = 0;

async function withBrowser(fn) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--blink-settings=imagesEnabled=false', '--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
  try { return await fn(ctx); } finally { await browser.close(); }
}

async function scrapeFull() {
  const log = await db.logScrapingStart('full');
  logger.info('=== Starting FULL scrape ===');
  try {
    const totalResults = await withBrowser(ctx => toonstream.scrapeFull(ctx, maxPages, forceMode));
    await db.logScrapingComplete(log.id, totalResults, null);
    logger.info(`=== FULL scrape complete: ${totalResults} added/updated ===`);
  } catch (err) {
    logger.error('Full scrape failed:', err);
    await db.logScrapingComplete(log.id, 0, [err.message]);
  }
}

async function scrapeIncremental() {
  const log = await db.logScrapingStart('incremental');
  logger.info('=== Starting INCREMENTAL scrape ===');
  try {
    const totalItems = await withBrowser(ctx => toonstream.scrapeIncremental(ctx, maxPages, forceMode));
    await db.logScrapingComplete(log.id, totalItems, null);
    logger.info(`=== Incremental done: ${totalItems} added/updated ===`);
  } catch (err) {
    logger.error('Incremental scrape failed:', err);
    await db.logScrapingComplete(log.id, 0, [err.message]);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const typeFlag = args.find((a) => a.startsWith('--type='));
  const type = typeFlag ? typeFlag.split('=')[1] : 'incremental';
  const maxPagesFlag = args.find((a) => a.startsWith('--max-pages='));
  if (maxPagesFlag) maxPages = parseInt(maxPagesFlag.split('=')[1], 10) || 0;
  forceMode = args.includes('--force');

  try {
    switch (type) {
      case 'incremental':
      case 'toonstream': await scrapeIncremental(); break;
      case 'full': await scrapeFull(); break;
      default: await scrapeIncremental();
    }
  } catch (err) {
    logger.error('Fatal error:', err);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

module.exports = {
  scrapeFull,
  scrapeIncremental,
};

if (require.main === module) {
  main();
}
