require('dotenv').config();
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  await page.goto('https://toonplay.in/watch/series-witch-hat-atelier', {
    waitUntil: 'domcontentloaded', timeout: 30000,
  });
  await page.waitForTimeout(4000);

  const data = await page.evaluate(() => {
    const iframes = Array.from(document.querySelectorAll('iframe')).map(f => ({
      src: f.getAttribute('src'),
      id: f.id,
      cls: (f.className || '').substring(0, 80),
    }));

    const playerDivs = Array.from(document.querySelectorAll('[id*="player"], [class*="player"]')).map(el => ({
      id: el.id,
      cls: (el.className || '').substring(0, 80),
      html: el.innerHTML.substring(0, 300),
    }));

    return { url: location.href, title: document.title, iframes, playerDivs };
  });

  console.log('URL:', data.url);
  console.log('Title:', data.title);
  console.log('\nIFRAMES:', JSON.stringify(data.iframes, null, 2));
  console.log('\nPLAYER DIVS:', JSON.stringify(data.playerDivs, null, 2));

  // Also check the animesalt info API response for video links
  await browser.close();
})();
