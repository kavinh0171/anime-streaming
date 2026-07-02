require('dotenv').config();
const logger = require('./logger');
const db = require('./supabase');
const api = require('./api-scraper');

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

  logger.info('=== Starting FULL scrape ===');
  logger.info('Discovering total available content...\n');

  const firstSeriesPage = await api.fetchSeriesList(1, browser);
  const totalSeriesPages = firstSeriesPage.totalPages || 1;
  const firstMoviesPage = await api.fetchMoviesList(1, browser);
  const totalMoviePages = firstMoviesPage.totalPages || 1;

  const skippedPages = startPage - 1;
  totalItemsToScrape = ((totalSeriesPages - skippedPages) * 12) + (totalMoviePages * 12);
  logger.info(`Found ${totalSeriesPages} series pages, ${totalMoviePages} movie pages, ~${totalItemsToScrape} items remaining\n`);

  skippedCount = 0;
  currentItemCount = (startPage > 1 ? skippedPages * 12 : 0);
  let totalResults = 0;
  let allErrors = [];

  for (let page = startPage; page <= totalSeriesPages; page++) {
    const result = page === 1 ? firstSeriesPage : await api.fetchSeriesList(page, browser);
    const series = result.items;
    if (!series || series.length === 0) break;

    logger.info(`\nProcessing ${series.length} series from page ${page}/${totalSeriesPages}`);
    const { results, errors } = await processBatch(series, browser);
    totalResults += results.length;
    allErrors = allErrors.concat(errors);
  }

  for (let page = 1; page <= totalMoviePages; page++) {
    const result = page === 1 ? firstMoviesPage : await api.fetchMoviesList(page, browser);
    const movies = result.items;
    if (!movies || movies.length === 0) break;

    logger.info(`\nProcessing ${movies.length} movies from page ${page}/${totalMoviePages}`);
    const { results, errors } = await processBatch(movies, browser);
    totalResults += results.length;
    allErrors = allErrors.concat(errors);
  }

  await browser.close();
  console.log('\n');
  await db.logScrapingComplete(log.id, totalResults, allErrors.length > 0 ? allErrors : null);
  logger.info(`=== FULL scrape complete: ${totalResults} new, ${skippedCount} skipped, ${allErrors.length} errors ===`);
}

async function scrapeIncremental() {
  const log = await db.logScrapingStart('incremental');
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--blink-settings=imagesEnabled=false', '--disable-blink-features=AutomationControlled'] });

  skippedCount = 0;
  logger.info('=== Starting INCREMENTAL scrape ===');

  let totalItems = 0;
  let allErrors = [];

  const series = await api.fetchSeriesList(1, browser);
  const seriesBatch = (series.items || []).slice(0, 12);
  logger.info(`Processing ${seriesBatch.length} series from page 1`);
  const sResult = await processBatch(seriesBatch, browser);
  totalItems += sResult.results.length;
  allErrors = allErrors.concat(sResult.errors);

  const moviesPage = await api.fetchMoviesList(1, browser);
  const moviesBatch = (moviesPage.items || []).slice(0, 2);
  logger.info(`Processing ${moviesBatch.length} movies from page 1`);
  const mResult = await processBatch(moviesBatch, browser);
  totalItems += mResult.results.length;
  allErrors = allErrors.concat(mResult.errors);

  await browser.close();
  await db.logScrapingComplete(log.id, totalItems, allErrors.length > 0 ? allErrors : null);
  logger.info(`=== Incremental scrape complete: ${totalItems} new, ${skippedCount} skipped, ${allErrors.length} errors ===`);
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
      case 'full': await scrapeFull(); break;
      case 'incremental': await scrapeIncremental(); break;
      case 'series': await scrapeSeriesOnly(); break;
      case 'movies': await scrapeMoviesOnly(); break;
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
  skippedCount = 0;
  const log = await db.logScrapingStart('series');
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--blink-settings=imagesEnabled=false', '--disable-blink-features=AutomationControlled'] });

  const firstPage = await api.fetchSeriesList(1, browser);
  const totalPages = firstPage.totalPages || 1;
  const skippedPages = startPage - 1;
  totalItemsToScrape = (totalPages - skippedPages) * 12;
  currentItemCount = skippedPages * 12;
  let totalResults = 0;
  let allErrors = [];

  for (let page = startPage; page <= totalPages; page++) {
    const result = page === 1 ? firstPage : await api.fetchSeriesList(page, browser);
    const series = result.items;
    if (!series || series.length === 0) break;
    const { results, errors } = await processBatch(series, browser);
    totalResults += results.length;
    allErrors = allErrors.concat(errors);
  }

  await browser.close();
  console.log('\n');
  await db.logScrapingComplete(log.id, totalResults, allErrors.length > 0 ? allErrors : null);
  logger.info(`=== Series scrape complete: ${totalResults} new, ${skippedCount} skipped ===`);
}

async function scrapeMoviesOnly() {
  skippedCount = 0;
  const log = await db.logScrapingStart('movies');
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--blink-settings=imagesEnabled=false', '--disable-blink-features=AutomationControlled'] });

  const firstPage = await api.fetchMoviesList(1, browser);
  const totalPages = firstPage.totalPages || 1;
  totalItemsToScrape = totalPages * 12;
  currentItemCount = 0;
  let totalResults = 0;
  let allErrors = [];

  for (let page = 1; page <= totalPages; page++) {
    const result = page === 1 ? firstPage : await api.fetchMoviesList(page, browser);
    const movies = result.items;
    if (!movies || movies.length === 0) break;
    const { results, errors } = await processBatch(movies, browser);
    totalResults += results.length;
    allErrors = allErrors.concat(errors);
  }

  await browser.close();
  console.log('\n');
  await db.logScrapingComplete(log.id, totalResults, allErrors.length > 0 ? allErrors : null);
  logger.info(`=== Movies scrape complete: ${totalResults} new, ${skippedCount} skipped ===`);
}

main();
