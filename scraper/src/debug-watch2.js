require('dotenv').config();
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
  });

  // Remove webdriver detection
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') console.log('CONSOLE ERROR:', msg.text());
  });

  page.on('response', r => {
    const url = r.url();
    if (url.includes('api/info') || url.includes('api/home')) {
      console.log('API:', url.substring(0, 150), r.status());
    }
  });

  console.log('Navigating...');
  await page.goto('https://toonplay.in/watch/series-witch-hat-atelier', {
    waitUntil: 'domcontentloaded', timeout: 30000,
  });

  await page.waitForTimeout(5000);

  console.log('Final URL:', page.url());
  console.log('Title:', await page.title());

  if (page.url().includes('/watch/')) {
    const data = await page.evaluate(() => {
      const iframes = Array.from(document.querySelectorAll('iframe')).map(f => ({
        src: f.getAttribute('src'),
        id: f.id,
      }));
      return {
        iframes,
        bodyHTML: document.body.innerHTML.substring(0, 3000),
      };
    });
    console.log('IFRAMES:', JSON.stringify(data.iframes, null, 2));
    console.log('BODY:', data.bodyHTML);
  } else {
    console.log('Redirected to homepage - checking why...');
    const check = await page.evaluate(() => {
      return {
        cookies: document.cookie,
        localStorage: Object.keys(localStorage).reduce((acc, k) => { acc[k] = localStorage.getItem(k)?.substring(0,100); return acc; }, {}),
        bodyClass: document.body.className,
      };
    });
    console.log('Check:', JSON.stringify(check, null, 2));
  }

  await browser.close();
})();
