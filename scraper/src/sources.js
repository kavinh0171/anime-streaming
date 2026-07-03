const axios = require('axios');
const logger = require('./logger');

async function verifyCdnHash(hash) {
  const apiUrl = `https://as-cdn21.top/player/index.php?data=${hash}&do=getVideo`;
  try {
    const resp = await axios.post(apiUrl,
      `hash=${hash}&r=https://toonstream.vip/`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Referer': `https://as-cdn21.top/video/${hash}`,
          'X-Requested-With': 'XMLHttpRequest',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 15000,
      }
    );
    const data = resp.data;
    if (data?.videoSource || data?.securedLink) {
      const hlsUrl = data.videoSource || data.securedLink;
      const expires = hlsUrl.match(/expires=(\d+)/)?.[1];
      const expiresDate = expires ? new Date(parseInt(expires) * 1000).toISOString() : 'unknown';
      logger.info(`  API OK - expires: ${expiresDate}`);
      return {
        hls: true,
        hls_url: hlsUrl,
        expires: parseInt(expires) || 0,
        expires_date: expiresDate,
        video_image: data.videoImage || '',
      };
    }
    logger.warn(`  API response has no videoSource`);
    return null;
  } catch (err) {
    logger.warn(`  CDN API failed: ${err.message}`);
    return null;
  }
}

module.exports = { verifyCdnHash };
