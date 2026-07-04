const { fetch, sleep } = require('./http');
const logger = require('./logger');
const config = require('./config');

const BASE = config.base;
const TOTAL_PAGES = config.totalPages;
const CATALOG_PATH = config.catalogPath;

async function discoverAllSeries(onSeries, onProgress) {
  let total = 0;
  const seenSlugs = new Set();
  for (let page = 1; page <= TOTAL_PAGES; page++) {
    const url = page === 1 ? `${BASE}${CATALOG_PATH}` : `${BASE}${CATALOG_PATH}page/${page}/`;
    logger.info(`Catalog page ${page}/${TOTAL_PAGES}: ${url}`);
    try {
      const $ = await fetch(url, { referer: BASE });

      // Stop if page is empty (404/redirect to homepage)
      if ($('body').text().includes('Page not found') || $('title').text().includes('404')) {
        logger.info(`Page ${page} not found, stopping catalog`);
        break;
      }

      const items = [];
      // Target the visual ToroFilm cards (not the hidden WordPress loop items)
      $('article[class*="post"], li[class*="post-"]').each((_, el) => {
        const link = $(el).find('a[href*="/series/"], a[href*="/movies/"]').first();
        const href = link.attr('href');
        if (!href) return;
        const slugMatch = href.match(/\/(?:series|movies)\/(.+?)\/?$/);
        if (!slugMatch) return;
        const slug = slugMatch[1];
        if (!slug || slug.includes('/category/') || seenSlugs.has(slug)) return;
        seenSlugs.add(slug);
        const title = $(el).find('.entry-title, h2').first().text().trim() || link.text().trim();
        const tmdbPoster = $(el).find('img[data-src*="tmdb"]').first();
        const tmdbSrc = (tmdbPoster.attr('data-src') || '').replace(/^\/\//, 'https://');
        const posterUrl = tmdbSrc ? tmdbSrc.replace('/w342/', '/w500/') : '';
        const img = posterUrl || $(el).find('.post-thumbnail img').attr('data-src') || $(el).find('.post-thumbnail img').attr('src') || '';
        const type = href.includes('/movies/') ? 'movie' : 'series';
        items.push({
          slug,
          title,
          type,
          thumbnail: img.startsWith('//') ? 'https:' + img : img,
          rating: 0,
        });
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
