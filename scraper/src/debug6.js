require('dotenv').config();
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  
  const apiResponses = [];
  
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('animesalt.streamindia.co.in/api/')) {
      try {
        const json = await response.json();
        apiResponses.push({ url, data: json });
      } catch (e) {}
    }
  });
  
  // Get a watch page
  await page.goto('https://toonplay.in/watch/series-witch-hat-atelier', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);
  
  // Switch episodes to capture episode API
  const episodeItems = await page.$$('[class*="group/episode"], [class*="episode-item"], [class*="episode"], button[class*="ep"]');
  if (episodeItems.length > 0) {
    await episodeItems[1]?.click().catch(() => {});
    await page.waitForTimeout(3000);
  }
  
  // Click season selector if exists
  const seasonBtns = await page.$$('[class*="season"] button, button[class*="season"]');
  if (seasonBtns.length > 0) {
    await seasonBtns[0]?.click().catch(() => {});
    await page.waitForTimeout(2000);
  }
  
  console.log('\n=== API Responses (watch page) ===');
  for (const resp of apiResponses) {
    const url = resp.url;
    const data = resp.data;
    console.log('\nURL:', url);
    const str = JSON.stringify(data, null, 2);
    if (str.length > 3000) {
      console.log(str.substring(0, 3000) + '...');
    } else {
      console.log(str);
    }
  }
  
  // Also check movies endpoint
  await page.goto('https://toonplay.in/anime/movies', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);
  
  console.log('\n\n=== Movies page API ===');
  for (const resp of apiResponses) {
    if (resp.url.includes('movies') || resp.url.includes('home')) {
      console.log('\nURL:', resp.url);
      const str = JSON.stringify(resp.data, null, 2);
      console.log(str.substring(0, 2000));
    }
  }
  
  await browser.close();
})();
