require('dotenv').config();
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0' });
  await context.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
  const page = await context.newPage();

  let infoData = null;
  page.on('response', async (r) => {
    if (r.url().includes('/api/info')) {
      try { infoData = await r.json(); } catch(e) {}
    }
  });

  await page.goto('https://toonplay.in/watch/movies-your-name', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  if (infoData) {
    console.log('Full info response:');
    console.log(JSON.stringify(infoData, null, 2));
  }

  // Check all buttons on the page for a play/watch button
  const buttons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button')).map(b => ({
      id: b.id,
      text: b.textContent?.trim().substring(0, 60),
      className: (b.className || '').substring(0, 80),
    }));
  });
  console.log('\nButtons on page:');
  buttons.forEach(b => console.log(' -', b.id || '(no id)', '|', b.text));

  // Click first play/watch-like button
  for (const b of buttons) {
    if (b.text?.toLowerCase().includes('play') || b.text?.toLowerCase().includes('watch') || b.text?.toLowerCase().includes('server')) {
      console.log('\nClicking:', b.text);
      const el = await page.$(`button#${b.id}`);
      if (el) { await el.click(); await page.waitForTimeout(3000); break; }
    }
  }

  // Check again for iframe after clicking
  const iframe = await page.evaluate(() => {
    const el = document.querySelector('iframe');
    return el ? { src: el.getAttribute('src'), id: el.id } : 'NO IFRAME';
  });
  console.log('\nIframe after click:', JSON.stringify(iframe));

  await browser.close();
})();
