const { fetch } = require('./http');
const logger = require('./logger');

async function extractCdnHash(episodeUrl) {
  logger.info(`  Episode page: ${episodeUrl}`);
  try {
    const $ = await fetch(episodeUrl, { referer: 'https://toonstream.vip/' });
    let trid = '';
    $('iframe[src*="trembed"]').each((_, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src') || '';
      const m = src.match(/trid=(\d+)/);
      if (m && !trid) trid = m[1];
    });
    if (!trid) {
      logger.warn(`  No trembed iframe found`);
      return null;
    }
    logger.info(`  trid=${trid}, fetching trembed iframe...`);
    const trembedUrl = `https://toonstream.vip/?trembed=0&trid=${trid}&trtype=2`;
    const $iframe = await fetch(trembedUrl, { referer: episodeUrl });
    let cdnUrl = '';
    $iframe('iframe[src*="as-cdn"]').each((_, el) => {
      const src = $iframe(el).attr('src');
      if (src && src.includes('/video/')) cdnUrl = src;
    });
    if (!cdnUrl) {
      logger.warn(`  No CDN iframe found in trembed`);
      return null;
    }
    const hash = cdnUrl.match(/\/video\/([a-f0-9]{32})/)?.[1];
    if (!hash) {
      logger.warn(`  No hash in CDN URL: ${cdnUrl}`);
      return null;
    }
    return {
      cdn_url: cdnUrl,
      cdn_hash: hash,
    };
  } catch (err) {
    logger.warn(`  Failed to extract CDN hash: ${err.message}`);
    return null;
  }
}

module.exports = { extractCdnHash };
