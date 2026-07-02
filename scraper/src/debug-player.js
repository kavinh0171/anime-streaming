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
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();

  // Intercept animesalt requests
  page.on('response', r => {
    const url = r.url();
    if (url.includes('animesalt.ac') || url.includes('gogoplay') || url.includes('vidplay')) {
      console.log('EMBED URL:', url.substring(0, 200), r.status());
    }
  });

  await page.goto('https://toonplay.in/watch/series-witch-hat-atelier', {
    waitUntil: 'domcontentloaded', timeout: 30000,
  });
  await page.waitForTimeout(5000);

  // Get the full player area HTML
  const playerHTML = await page.evaluate(() => {
    const arena = document.querySelector('#cinematic-watch-arena');
    if (!arena) return 'NO ARENA FOUND';
    return arena.innerHTML.substring(0, 5000);
  });

  console.log('=== PLAYER AREA HTML ===');
  console.log(playerHTML);

  // Also check any script tags that load the player
  const playerScripts = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('script'))
      .map(s => ({ src: s.getAttribute('src') || '', content: s.textContent.substring(0, 300) }))
      .filter(s => s.src.includes('player') || s.src.includes('embed') || s.src.includes('video') || s.content.includes('player') || s.content.includes('iframe'));
  });

  console.log('\n=== PLAYER SCRIPTS ===');
  playerScripts.forEach(s => console.log(s.src?.substring(0, 200) || s.content?.substring(0, 200)));

  await browser.close();
})();
