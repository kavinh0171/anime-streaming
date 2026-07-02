require('dotenv').config();
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  // Capture all API responses
  const apis = [];
  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.includes('animesalt') || url.includes('gogoplay') || url.includes('vidplay') || url.includes('rabbitstream') || url.includes('.m3u8') || url.includes('.mp4')) {
      apis.push({ url: url.substring(0, 200), status: resp.status() });
    }
  });

  // Go to an episode page directly
  await page.goto('https://toonplay.in/episode/witch-hat-atelier-1x1', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(4000);

  console.log('=== Episode Page URL ===');
  console.log(page.url());
  console.log('Title:', await page.title());

  // Check the page structure for video player
  const structure = await page.evaluate(() => {
    const results = {};

    // All iframes on page
    results.iframes = Array.from(document.querySelectorAll('iframe')).map(f => ({
      src: f.getAttribute('src'),
      id: f.id,
      className: f.className?.substring(0, 100),
      width: f.getAttribute('width'),
      height: f.getAttribute('height'),
    }));

    // All video elements
    results.videos = Array.from(document.querySelectorAll('video, video source, [data-src*="http"]')).map(v => ({
      src: v.getAttribute('src') || v.getAttribute('data-src'),
      tag: v.tagName,
    }));

    // Player divs
    results.playerDivs = Array.from(document.querySelectorAll('[id*="player"], [class*="player"], [id*="video"], [class*="video"]')).map(el => ({
      id: el.id,
      className: el.className?.substring(0, 100),
      innerHTML: el.innerHTML.substring(0, 300),
    }));

    // Check for embed scripts
    results.scripts = Array.from(document.querySelectorAll('script')).map(s => ({
      src: s.getAttribute('src'),
      content: s.textContent?.substring(0, 200),
    })).filter(s => s.src?.includes('player') || s.src?.includes('embed') || s.src?.includes('video') || s.textContent?.includes('iframe') || s.textContent?.includes('player'));

    return results;
  });

  console.log('\n=== IFRAMES ===');
  structure.iframes.forEach(f => console.log(JSON.stringify(f)));

  console.log('\n=== VIDEOS ===');
  structure.videos.forEach(v => console.log(JSON.stringify(v)));

  console.log('\n=== PLAYER DIVS ===');
  structure.playerDivs.forEach(p => console.log(JSON.stringify(p)));

  console.log('\n=== SCRIPTS ===');
  structure.scripts.forEach(s => console.log(JSON.stringify(s)));

  console.log('\n=== CAPTURED API URLs ===');
  apis.forEach(a => console.log(a.url, a.status));

  // Check for animesalt embed
  console.log('\n=== Full page HTML (body) ===');
  const bodyHTML = await page.evaluate(() => document.body.innerHTML.substring(0, 5000));
  console.log(bodyHTML);

  await browser.close();
})();
