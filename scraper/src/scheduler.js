require('dotenv').config();
const cron = require('node-cron');
const logger = require('./logger');
const { cleanup } = require('./browser');
const scraper = require('./index');

async function runScraper(type) {
  logger.info(`[Scheduler] Starting ${type} scrape`);
  try {
    if (type === 'full') {
      await scraper.scrapeFull();
    } else {
      await scraper.scrapeIncremental();
    }
    logger.info(`[Scheduler] ${type} scrape completed successfully`);
  } catch (err) {
    logger.error(`[Scheduler] ${type} scrape failed:`, err);
  } finally {
    await cleanup();
  }
}

// Schedule: full scrape every day at 3 AM
cron.schedule('0 3 * * *', () => {
  logger.info('[Scheduler] Cron trigger: Daily full scrape');
  runScraper('full');
});

// Schedule: incremental scrape every 6 hours
cron.schedule('0 */6 * * *', () => {
  logger.info('[Scheduler] Cron trigger: Incremental scrape');
  runScraper('incremental');
});

logger.info('[Scheduler] Started. Full scrape at 3 AM daily. Incremental every 6 hours.');

// Keep process alive
process.stdin.resume();
