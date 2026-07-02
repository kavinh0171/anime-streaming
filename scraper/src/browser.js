const { chromium } = require('playwright');
const logger = require('./logger');

let browser = null;

async function getBrowser() {
  if (browser && browser.isConnected()) {
    return browser;
  }
  browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--blink-settings=imagesEnabled=false',
    ],
  });
  logger.info('Browser launched');
  return browser;
}

async function createPage(extraHeaders = {}) {
  const b = await getBrowser();
  const context = await b.newContext({
    userAgent: randomUserAgent(),
    viewport: { width: 1920, height: 1080 },
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      ...extraHeaders,
    },
  });
  const page = await context.newPage();
  await page.setDefaultTimeout(30000);
  return { page, context };
}

function randomUserAgent() {
  const agents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  ];
  return agents[Math.floor(Math.random() * agents.length)];
}

async function delay(ms) {
  const base = parseInt(process.env.REQUEST_DELAY_MS || '2000');
  const jitter = Math.random() * 1000;
  return new Promise((r) => setTimeout(r, base + jitter));
}

async function safeNavigate(page, url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
      return true;
    } catch (err) {
      logger.warn(`Navigation attempt ${attempt}/${retries} failed for ${url}: ${err.message}`);
      if (attempt === retries) throw err;
      await delay(3000 * attempt);
    }
  }
}

async function cleanup() {
  if (browser) {
    try {
      await browser.close();
      logger.info('Browser closed');
    } catch (err) {
      logger.error('Error closing browser:', err);
    }
    browser = null;
  }
}

module.exports = {
  getBrowser,
  createPage,
  randomUserAgent,
  delay,
  safeNavigate,
  cleanup,
};
