require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');

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
        console.log('CAPTURED API:', url);
      } catch (e) {
        // Not JSON
      }
    }
  });
  
  await page.goto('https://toonplay.in/anime/series?page=1', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);
  
  console.log('\n\n=== API Responses Captured:', apiResponses.length, '===');
  
  for (const resp of apiResponses) {
    console.log('\nURL:', resp.url);
    const data = resp.data;
    if (Array.isArray(data)) {
      console.log('Array length:', data.length);
      console.log('First item:', JSON.stringify(data[0], null, 2).substring(0, 1000));
    } else if (data.data && Array.isArray(data.data)) {
      console.log('Data array length:', data.data.length);
      console.log('First item:', JSON.stringify(data.data[0], null, 2).substring(0, 1000));
    } else {
      console.log('Structure:', JSON.stringify(data).substring(0, 2000));
    }
  }
  
  // Also get a watch page
  if (apiResponses.length > 0) {
    console.log('\n\n=== Now navigating to a watch page ===');
    await page.goto('https://toonplay.in/watch/series-witch-hat-atelier', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);
    
    // Check for second round of API calls
    console.log('Watch page URL:', page.url());
    console.log('Watch page title:', await page.title());
  }
  
  fs.writeFileSync('api_dump.json', JSON.stringify(apiResponses, null, 2));
  console.log('\nFull API dump saved to api_dump.json');
  
  await browser.close();
})();
