require('dotenv').config();
const logger = require('./logger');
const db = require('./supabase');
const api = require('./api-scraper');
const toonstream = require('./toonstream-scraper');

const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_PAGES || '3');

function clearLine() { process.stdout.write('\r\x1b[K'); }

function showProgress(current, total, type) {
  if (total === 0) return;
  const pct = Math.min(100, Math.round((current / total) * 100));
  const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
  process.stdout.write(`\r  ${type}: [${bar}] ${current}/${total} (${pct}%)`);
}

// Intercept logger to clear progress line before each log
const _logInfo = logger.info.bind(logger);
const _logWarn = logger.warn.bind(logger);
const _logError = logger.error.bind(logger);
logger.info = (msg) => { clearLine(); _logInfo(msg); };
logger.warn = (msg) => { clearLine(); _logWarn(msg); };
logger.error = (msg, ...args) => { clearLine(); _logError(msg, ...args); };

let currentItemCount = 0;
let totalItemsToScrape = 0;

let skippedCount = 0;
let forceMode = false;
let startPage = 1;

async function processBatch(items, browser) {
  const results = [];
  const errors = [];

  for (const item of items) {
    try {
      if (item.id && !forceMode) {
        const stored = await db.getAnimeBySlug(item.id);
        if (stored) {
          // Check if episode count changed — if so, re-process to get new eps
          const listingEps = parseInt(item.episodes);
          const storedEps = stored.total_episodes || 0;
          if (listingEps && listingEps > storedEps) {
            logger.info(`  Episode count changed for ${item.title}: ${storedEps} → ${listingEps}, re-processing`);
          } else {
            skippedCount++;
            currentItemCount++;
            showProgress(currentItemCount, totalItemsToScrape, 'Overall');
            continue;
          }
        }
      }
      const result = await api.processAnimeItem(item, browser);
      if (result) results.push(result);
      currentItemCount++;
      showProgress(currentItemCount, totalItemsToScrape, 'Overall');
    } catch (err) {
      errors.push({ id: item.id, title: item.title, error: err.message });
      logger.error(`Failed: ${item.title} - ${err.message}`);
    }
  }

  return { results, errors };
}

async function scrapeFull() {
  const log = await db.logScrapingStart('full');
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--blink-settings=imagesEnabled=false', '--disable-blink-features=AutomationControlled'] });

  logger.info('=== Starting FULL scrape (ToonStream) ===');
  try {
    const totalResults = await toonstream.scrapeFull(browser);
    await db.logScrapingComplete(log.id, totalResults, null);
    logger.info(`=== FULL scrape complete: ${totalResults} added/updated ===`);
  } catch (err) {
    logger.error('Full scrape failed:', err);
    await db.logScrapingComplete(log.id, 0, [err.message]);
  } finally {
    await browser.close();
  }
}

async function scrapeToonstreamOnly() {
  const log = await db.logScrapingStart('toonstream');
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--blink-settings=imagesEnabled=false', '--disable-blink-features=AutomationControlled'] });
  logger.info('=== Starting ToonStream full scan (all pages) ===');
  const added = await toonstream.scrapeFull(browser);
  await browser.close();
  await db.logScrapingComplete(log.id, added, null);
  logger.info(`=== ToonStream full scan complete: ${added} added/updated ===`);
}

async function scrapeIncremental() {
  const log = await db.logScrapingStart('incremental');
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--blink-settings=imagesEnabled=false', '--disable-blink-features=AutomationControlled'] });

  skippedCount = 0;
  logger.info('=== Starting INCREMENTAL scrape (ToonStream) ===');

  let totalItems = 0;
  try {
    totalItems = await toonstream.scrapeIncremental(browser);
    await db.logScrapingComplete(log.id, totalItems, null);
    logger.info(`=== Incremental scrape complete: ${totalItems} added/updated ===`);
  } catch (err) {
    logger.error('Incremental scrape failed:', err);
    await db.logScrapingComplete(log.id, 0, [err.message]);
  } finally {
    await browser.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const typeFlag = args.find((a) => a.startsWith('--type='));
  const type = typeFlag ? typeFlag.split('=')[1] : 'incremental';
  forceMode = args.includes('--force');
  const startPageFlag = args.find((a) => a.startsWith('--start-page='));
  if (startPageFlag) startPage = parseInt(startPageFlag.split('=')[1], 10) || 1;

  try {
    switch (type) {
      case 'incremental': await scrapeIncremental(); break;
      case 'full': await scrapeFull(); break;
      case 'toonstream': await scrapeToonstreamOnly(); break;
      case 'series': await scrapeFull(); break;
      case 'movies':
        logger.warn('ToonStream does not have movies. Skipping movies scrape.');
        break;
      default: await scrapeIncremental();
    }
  } catch (err) {
    logger.error('Fatal error:', err);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

async function scrapeSeriesOnly() {
  await scrapeFull();
}

async function scrapeMoviesOnly() {
  logger.warn('ToonStream does not have movies. Skipping.');
}

module.exports = {
  scrapeFull,
  scrapeIncremental,
  scrapeSeriesOnly,
  scrapeMoviesOnly,
  scrapeToonstreamOnly
};

if (require.main === module) {
  main();
}
