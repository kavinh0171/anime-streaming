const { fetch, sleep } = require('./http');
const logger = require('./logger');

const BASE = 'https://toonstream.vip';
const TOTAL_PAGES = 52;

async function discoverAllSeries(onSeries, onProgress) {
  let total = 0;
  for (let page = 1; page <= TOTAL_PAGES; page++) {
    const url = page === 1 ? `${BASE}/category/anime/` : `${BASE}/category/anime/page/${page}/`;
    logger.info(`Catalog page ${page}/${TOTAL_PAGES}: ${url}`);
    try {
      const $ = await fetch(url, { referer: BASE });
      const items = [];
      $('li[class*="post-"]').each((_, el) => {
        const link = $(el).find('a[href*="/series/"]').first();
        const href = link.attr('href');
        if (!href) return;
        const slug = href.replace(BASE + '/series/', '').replace(/\/$/, '');
        if (!slug || slug.includes('/category/')) return;
        const title = $(el).find('.entry-title').text().trim();
        const img = $(el).find('.post-thumbnail img').attr('src') || '';
        const rating = $(el).find('.vote').text().replace(/[^\d.]/g, '');
        items.push({ slug, title, thumbnail: img.replace(/\/\//, 'https://'), rating: rating ? parseFloat(rating) : 0 });
      });
      for (const item of items) {
        await onSeries(item);
        total++;
      }
      if (onProgress) onProgress(page, TOTAL_PAGES, items.length, total);
    } catch (err) {
      logger.error(`Failed catalog page ${page}: ${err.message}`);
    }
    await sleep(1000);
  }
  return total;
}

module.exports = { discoverAllSeries };
