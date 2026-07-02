require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  
  console.log('Navigating to series page...');
  await page.goto('https://toonplay.in/anime/series?page=1', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(5000);
  
  console.log('Title:', await page.title());
  
  // Dump page structure
  const structure = await page.evaluate(() => {
    const results = {};
    
    // Find all links with /watch/
    const watchLinks = document.querySelectorAll('a[href*="/watch/"]');
    results.watchLinkCount = watchLinks.length;
    results.sampleLinks = Array.from(watchLinks).slice(0, 3).map(a => ({
      href: a.href,
      text: a.textContent.trim().substring(0, 100),
      parentTag: a.parentElement?.tagName || '',
      parentClass: a.parentElement?.className || '',
      grandparentTag: a.parentElement?.parentElement?.tagName || '',
      grandparentClass: a.parentElement?.parentElement?.className || '',
    }));
    
    // Check common containers
    const selectors = [
      'article', '.item', '.post', '.mb', '.col', 
      '[class*="post"]', '[class*="anime"]', '[class*="item"]', 
      '[class*="card"]', '[class*="list"]', '[class*="grid"]',
      'li', 'div.row', '.row', '.container'
    ];
    
    results.containers = selectors.map(sel => {
      const els = document.querySelectorAll(sel);
      return {
        selector: sel,
        count: els.length,
        sample: els.length > 0 ? els[0].outerHTML.substring(0, 300) : null
      };
    }).filter(c => c.count > 0);
    
    // Get the main content area
    const main = document.querySelector('main, #main, .main, .content, #content, .site-content');
    results.mainContent = main ? main.outerHTML.substring(0, 1000) : 'No main element found';
    
    // Full body summary
    results.bodyClasses = document.body.className;
    results.bodyId = document.body.id;
    
    return results;
  });
  
  console.log('\n=== STRUCTURE ===');
  console.log('Watch links:', structure.watchLinkCount);
  console.log('Sample links:', JSON.stringify(structure.sampleLinks, null, 2));
  console.log('Body classes:', structure.bodyClasses);
  console.log('Body id:', structure.bodyId);
  console.log('\nContainers with count > 0:');
  structure.containers.forEach(c => {
    console.log(`\n--- ${c.selector} (${c.count}) ---`);
    console.log(c.sample?.substring(0, 500));
  });
  
  console.log('\n=== Main Content ===');
  console.log(structure.mainContent?.substring(0, 1500));
  
  fs.writeFileSync('page_dump.html', await page.content());
  console.log('\nFull HTML saved to page_dump.html');
  
  await browser.close();
})();
