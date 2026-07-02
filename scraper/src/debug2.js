require('dotenv').config();
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  
  await page.goto('https://toonplay.in/anime/series?page=1', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(5000);
  
  const data = await page.evaluate(() => {
    // Get all cards in the grid
    const cards = document.querySelectorAll('[class*="group/card"]');
    const items = [];
    
    cards.forEach(card => {
      // Get the link
      const link = card.querySelector('a');
      const img = card.querySelector('img');
      const titleEl = card.querySelector('[class*="title"], h2, h3, .font-bold, [class*="font-semibold"]');
      
      items.push({
        outerHTML: card.outerHTML.substring(0, 800),
        linkHref: link?.getAttribute('href'),
        linkOnClick: link?.getAttribute('onclick'),
        imgSrc: img?.getAttribute('src') || img?.getAttribute('data-src'),
        imgAlt: img?.getAttribute('alt'),
        titleText: titleEl?.textContent?.trim(),
      });
    });
    
    return items.slice(0, 3);
  });
  
  console.log(JSON.stringify(data, null, 2));
  
  // Also check all links on page
  const allLinks = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a')).map(a => ({
      href: a.href,
      text: a.textContent.trim().substring(0, 50),
      class: a.className.substring(0, 80),
    })).filter(l => l.href && !l.href.startsWith('javascript'));
  });
  console.log('\n=== ALL LINKS ===');
  allLinks.slice(0, 30).forEach(l => console.log(l.href, '|', l.text, '|', l.class));
  
  await browser.close();
})();
