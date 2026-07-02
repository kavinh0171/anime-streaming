require('dotenv').config();
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  // Intercept all requests to see XHR/fetch calls
  page.on('response', response => {
    if (response.url().includes('api') || response.url().includes('data')) {
      console.log('API:', response.url().substring(0, 150));
    }
  });

  await page.goto('https://toonplay.in/anime/series?page=1', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(4000);

  // Check window.__NEXT_DATA__ or __NUXT__ for route data
  const nextData = await page.evaluate(() => {
    return {
      nextData: window.__NEXT_DATA__,
      nuxt: window.__NUXT__,
      routes: window.__routes,
      initialState: window.__INITIAL_STATE__,
    };
  });
  
  if (nextData.nextData) {
    console.log('\n=== NEXT DATA FOUND ===');
    console.log(JSON.stringify(nextData.nextData).substring(0, 2000));
  }

  // Check all script tags for JSON data
  const scripts = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('script')).map(s => ({
      id: s.id,
      type: s.type,
      content: s.textContent.substring(0, 300)
    })).filter(s => s.content.includes('anime') || s.content.includes('series') || s.content.includes('watch'));
  });
  
  console.log('\n=== Relevant scripts ===');
  scripts.forEach(s => console.log(s.id, '|', s.type, '|', s.content.substring(0, 500)));

  // Get all card titles
  const cardData = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[class*="group/card"]')).map(card => {
      const title = card.querySelector('h4')?.textContent?.trim();
      const img = card.querySelector('img')?.getAttribute('src') || card.querySelector('img')?.getAttribute('data-src');
      const type = card.querySelector('[class*="uppercase"]')?.textContent?.trim();
      // Get onclick or navigate attributes from any child
      return { title, img, type };
    });
  });
  
  console.log(`\n=== Cards found: ${cardData.length} ===`);
  cardData.slice(0, 5).forEach(c => console.log(c.title, '|', c.type, '|', c.img?.substring(0, 60)));

  await browser.close();
})();
