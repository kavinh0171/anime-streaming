const axios = require('axios');
const cheerio = require('cheerio');
const { sleep } = require('./http');
const logger = require('./logger');
const config = require('./config');

const BASE = config.base;
const AJAX_METHOD = config.seasonAjaxMethod;

async function loadSeasonEpisodes(postId, seasonNum) {
  if (!postId) return [];
  const url = `${BASE}/wp-admin/admin-ajax.php`;
  logger.info(`  Season ${seasonNum} (post=${postId})`);
  try {
    let html;
    if (AJAX_METHOD === 'get') {
      const resp = await axios.get(url, {
        params: { action: 'action_select_season', post: postId, season: String(seasonNum) },
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Referer': `${BASE}/series/`,
        },
        timeout: 15000,
      });
      html = typeof resp.data === 'string' ? resp.data : resp.data?.data || '';
    } else {
      const resp = await axios.post(url,
        new URLSearchParams({ action: 'action_select_season', post: postId, season: String(seasonNum) }),
        {
          headers: {
            'User-Agent': 'Mozilla/5.0',
            'Content-Type': 'application/x-www-form-urlencoded',
            'Referer': `${BASE}/series/`,
          },
          timeout: 15000,
        }
      );
      html = typeof resp.data === 'string' ? resp.data : resp.data?.data || '';
    }
    await sleep(500);
    const $ = cheerio.load(html);
    const episodes = [];
    $('a[href*="/episode/"]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      const match = href.match(/\/episode\/(.+?)-(\d+)x(\d+)\/?$/);
      if (!match) return;
      const slug = match[1];
      const sNum = parseInt(match[2]);
      const epNum = parseInt(match[3]);
      if (sNum !== seasonNum) return;
      const img = $(el).find('img').attr('src') || '';
      const title = $(el).find('.entry-title').text().trim() || $(el).attr('title') || '';
      episodes.push({
        episode_url: href,
        slug,
        season_number: sNum,
        episode_number: epNum,
        title,
        thumbnail: img.startsWith('//') ? 'https:' + img : img,
      });
    });
    return episodes;
  } catch (err) {
    logger.warn(`  Season ${seasonNum} AJAX failed: ${err.message}`);
    return [];
  }
}

module.exports = { loadSeasonEpisodes };
