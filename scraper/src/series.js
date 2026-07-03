const { fetch } = require('./http');
const logger = require('./logger');

const BASE = 'https://toonstream.vip';

async function scrapeSeries(slug) {
  const url = `${BASE}/series/${slug}/`;
  logger.info(`Series: ${slug}`);
  const $ = await fetch(url, { referer: BASE });
  if ($('body').text().includes('Page not found') || $('title').text().includes('404')) {
    logger.warn(`Series not found: ${slug}`);
    return null;
  }
  const title = $('.entry-title').first().text().trim() || slug.replace(/-/g, ' ');
  const description = $('.description, .entry-content p, [class*="sinopsis"] p').first().text().trim() || '';
  const img = $('.post-thumbnail img, .poster img').first().attr('src') || '';
  const coverImg = $('[class*="cover"] img, .background img, .banner img').first().attr('src') || img;
  const rating = parseFloat($('.vote, .rating').text().replace(/[^\d.]/g, '')) || 0;
  const yearText = $('.year, [class*="date"], .meta span').first().text().trim();
  const year = parseInt(yearText.match(/\d{4}/)?.[0]) || null;
  let status = 'ongoing';
  if ($('body').text().toLowerCase().includes('completed')) status = 'completed';
  let type = 'series';
  if (url.includes('/movies/') || $('body').text().includes('Movie')) type = 'movie';
  const studio = $('[class*="studio"]').first().text().trim() || '';
  const duration = $('[class*="duration"]').first().text().trim() || '';
  const totalEpText = $('[class*="episode"] .num, [class*="total"]').first().text().trim();
  const total_episodes = parseInt(totalEpText.match(/\d+/)?.[0]) || 0;
  const genreTags = [];
  $('[class*="genre"] a, .genres a, .tags a').each((_, el) => {
    const name = $(el).text().trim();
    if (name && name.length < 50) genreTags.push(name);
  });
  const seasonData = [];
  $('.sel-temp a, [data-season]').each((_, el) => {
    const postId = $(el).attr('data-post') || '';
    const seasonNum = parseInt($(el).attr('data-season')) || 0;
    if (postId && seasonNum) {
      seasonData.push({ post_id: postId, season_number: seasonNum });
    }
  });
  if (seasonData.length === 0) {
    seasonData.push({ post_id: '', season_number: 1 });
  }
  const thumbnail = img.startsWith('//') ? 'https:' + img : img;
  const cover_image = coverImg.startsWith('//') ? 'https:' + coverImg : coverImg;
  return {
    title,
    slug,
    description: description.substring(0, 2000),
    cover_image,
    thumbnail,
    rating,
    release_year: year,
    status,
    type,
    studio,
    duration,
    total_episodes,
    genres: [...new Set(genreTags)],
    seasons: seasonData,
  };
}

module.exports = { scrapeSeries };
