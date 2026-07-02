require('dotenv').config();
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  const page = await context.newPage();

  const apis = [];
  page.on('response', async (r) => {
    if (r.url().includes('/api/extract')) {
      try { apis.push({ url: r.url(), data: await r.json() }); } catch(e) {}
    }
  });

  await page.goto('https://toonplay.in/watch/series-overflow', {
    waitUntil: 'domcontentloaded', timeout: 30000,
  });
  await page.waitForTimeout(5000);

  console.log('Extract APIs captured:', apis.length);
  apis.forEach(a => {
    console.log('URL:', a.url.substring(0, 150));
    console.log('Data:', JSON.stringify(a.data, null, 2));
  });

  // Check the iframe on the page
  const iframe = await page.evaluate(() => {
    const el = document.querySelector('#cinema-series-server1-iframe');
    return el ? el.getAttribute('src') : 'NOT FOUND';
  });
  console.log('\nVideo iframe src:', iframe);

  await browser.close();
})();
