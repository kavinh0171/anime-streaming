require('dotenv').config();
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0' });
  await context.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
  const page = await context.newPage();

  const apis = [];
  page.on('response', async (r) => {
    const url = r.url();
    if (url.includes('/api/')) {
      try { 
        if (url.includes('extract')) apis.push({ type: 'extract', data: await r.json() });
        else if (url.includes('info')) apis.push({ type: 'info', url: url.substring(0, 150) });
      } catch(e) {}
    }
  });

  await page.goto('https://toonplay.in/watch/movies-your-name', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  console.log('Final URL:', page.url());

  for (const api of apis) {
    console.log('\n' + api.type + ':');
    if (api.data) console.log(JSON.stringify(api.data).substring(0, 1000));
    else console.log(api.url);
  }

  // Check iframe
  const iframe = await page.evaluate(() => {
    const el = document.querySelector('#cinema-series-server1-iframe');
    return el ? el.getAttribute('src') : 'NOT FOUND';
  });
  console.log('\nIframe src:', iframe);

  await browser.close();
})();
