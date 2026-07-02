require('dotenv').config();
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  
  await page.goto('https://toonplay.in/anime/series?page=1', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(5000);
  
  // Check all data attributes, event listeners, and full card detail
  const cardDetail = await page.evaluate(() => {
    const cards = document.querySelectorAll('[class*="group/card"]');
    return Array.from(cards).slice(0, 2).map(card => {
      // Get all attributes
      const attrs = {};
      Array.from(card.attributes).forEach(attr => attrs[attr.name] = attr.value);
      
      // Get inner content structure
      const inner = card.innerHTML.substring(0, 1500);
      
      // Check for any href or data-* attributes on any child
      const allDataAttrs = [];
      card.querySelectorAll('*').forEach(el => {
        Array.from(el.attributes).forEach(attr => {
          if (attr.name.startsWith('data-') || attr.name === 'href' || attr.name === 'onclick') {
            allDataAttrs.push({ tag: el.tagName, attr: attr.name, value: attr.value.substring(0, 200) });
          }
        });
      });
      
      // Check for next/image or Link components
      const linkEls = card.querySelectorAll('[href], [data-href], [data-url], [data-link], [navigate]');
      
      return { attrs, inner, allDataAttrs, linkEls: linkEls.length };
    });
  });
  
  console.log('Card detail:', JSON.stringify(cardDetail, null, 2));
  
  // Try clicking the first card and see what happens
  console.log('\n=== Clicking first card ===');
  await page.click('[class*="group/card"]:first-child');
  await page.waitForTimeout(3000);
  console.log('New URL:', page.url());
  console.log('New title:', await page.title());
  
  // Get watch page structure
  if (page.url().includes('/watch/')) {
    const watchData = await page.evaluate(() => {
      const h1 = document.querySelector('h1')?.textContent;
      const desc = document.querySelector('[class*="description"], [class*="synopsis"], p')?.textContent?.substring(0, 300);
      return { title: h1, desc };
    });
    console.log('Watch page:', watchData);
  }
  
  await browser.close();
})();
