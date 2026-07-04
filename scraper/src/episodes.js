const { fetch } = require('./http');
const logger = require('./logger');
const config = require('./config');

const DEAD_DOMAINS = ['vidstreaming.xyz'];

// --- Toonstream: trembed-based extraction ---

async function extractFromTrembed(trembedUrl, episodeUrl) {
  const $iframe = await fetch(trembedUrl, { referer: episodeUrl });
  let result = null;

  $iframe('iframe').each((_, el) => {
    if (result) return;
    const src = $iframe(el).attr('src') || '';
    if (src.includes('as-cdn21.top') && src.includes('/video/')) {
      const hash = src.match(/\/video\/([a-f0-9]{32})/)?.[1];
      if (hash) result = { cdn_url: src, cdn_hash: hash, provider: 'as-cdn' };
    }
  });
  if (result) return result;

  $iframe('iframe').each((_, el) => {
    if (result) return;
    const src = $iframe(el).attr('src') || '';
    if (src.startsWith('http') && !DEAD_DOMAINS.some(d => src.includes(d))) {
      result = { cdn_url: src, cdn_hash: '', provider: 'embed' };
    }
  });
  return result;
}

async function extractToonstream(episodeUrl) {
  logger.info(`  Episode page: ${episodeUrl}`);
  try {
    const $ = await fetch(episodeUrl, { referer: `${config.base}/` });
    const trembedFrames = [];
    $('iframe[src*="trembed"], iframe[data-src*="trembed"]').each((_, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src') || '';
      const m = src.match(/trembed=(\d+)/);
      const trid = src.match(/trid=(\d+)/);
      if (m && trid) {
        trembedFrames.push({ option: parseInt(m[1]), trid: trid[1], src });
      }
    });
    if (trembedFrames.length === 0) {
      logger.warn(`  No trembed iframe found`);
      return null;
    }
    const trid = trembedFrames[0].trid;
    const maxOption = Math.max(...trembedFrames.map(f => f.option));
    logger.info(`  trid=${trid}, ${trembedFrames.length} trembed options (0-${maxOption})`);
    for (let i = 0; i <= maxOption; i++) {
      const trembedUrl = `${config.base}/?trembed=${i}&trid=${trid}&trtype=2`;
      try {
        const result = await extractFromTrembed(trembedUrl, episodeUrl);
        if (result) {
          logger.info(`  trembed=${i}: found ${result.provider} source`);
          return result;
        }
        logger.info(`  trembed=${i}: no usable source`);
      } catch (err) {
        logger.warn(`  trembed=${i}: ${err.message}`);
      }
    }
    logger.warn(`  No usable source across all trembed options`);
    return null;
  } catch (err) {
    logger.warn(`  Failed to extract CDN hash: ${err.message}`);
    return null;
  }
}

// --- Animesalt: direct iframe extraction + multi-language ---

async function extractAnimeSalt(episodeUrl) {
  logger.info(`  Episode page: ${episodeUrl}`);
  try {
    const $ = await fetch(episodeUrl, { referer: `${config.base}/` });

    const result = {
      cdn_url: '',
      cdn_hash: '',
      provider: '',
      languages: [],
    };

    // Server 1: as-cdn21.top direct iframe
    $('iframe[src*="as-cdn21.top"]').each((_, el) => {
      const src = $(el).attr('src') || '';
      const hash = src.match(/\/video\/([a-f0-9]{32})/)?.[1];
      if (hash) {
        result.cdn_url = src;
        result.cdn_hash = hash;
        result.provider = 'as-cdn';
      }
    });

    // Server 2: multi-language player (lazy-loaded via data-src)
    $('iframe[data-src*="multi-lang-plyr"]').each((_, el) => {
      const dataSrc = $(el).attr('data-src') || '';
      try {
        const b64 = dataSrc.match(/data=([A-Za-z0-9+/=_-]+)/)?.[1];
        if (b64) {
          const decoded = Buffer.from(b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
          const langs = JSON.parse(decoded);
          const langMap = {
            hindi: 'hin', tamil: 'tam', telugu: 'tel', bengali: 'ben',
            malayalam: 'mal', kannada: 'kan', english: 'eng',
            japanese: 'jpn', korean: 'kor',
          };
          for (const lang of langs) {
            const code = (lang.language || '').toLowerCase();
            result.languages.push({
              language: langMap[code] || code.substring(0, 3),
              url: lang.link || '',
              label: lang.language || '',
            });
          }
        }
      } catch (e) {
        logger.warn(`  Failed to decode multi-lang data: ${e.message}`);
      }
    });

    if (result.cdn_hash) {
      logger.info(`  Found as-cdn21.top: ${result.cdn_hash}${result.languages.length > 0 ? ` + ${result.languages.length} languages` : ''}`);
      return result;
    }

    logger.warn(`  No CDN source found on episode page`);
    return null;
  } catch (err) {
    logger.warn(`  Failed to extract source: ${err.message}`);
    return null;
  }
}

// --- Main dispatcher ---

async function extractCdnHash(episodeUrl) {
  if (config.SITE === 'animesalt') {
    return extractAnimeSalt(episodeUrl);
  }
  return extractToonstream(episodeUrl);
}

module.exports = { extractCdnHash };
