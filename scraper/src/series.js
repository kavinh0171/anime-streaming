const { fetch } = require('./http');
const logger = require('./logger');
const config = require('./config');

const BASE = config.base;

async function scrapeSeries(slug, type = 'series') {
  const path = type === 'movie' ? '/movies/' : '/series/';
  const url = `${BASE}${path}${slug}/`;
  logger.info(`Series: ${slug} (${type})`);
  const $ = await fetch(url, { referer: BASE });
  if ($('body').text().includes('Page not found') || $('title').text().includes('404')) {
    logger.warn(`Series not found: ${slug}`);
    return null;
  }
  const title = $('h1').first().text().trim() || $('meta[property="og:title"]').attr('content')?.replace(/ - Watch.*/, '').trim() || slug.replace(/-/g, ' ');
  const descEl = $('[style*="max-height"] p, .entry-content > p, article > p').first();
  const description = descEl.text().trim() || '';
  const tmdbPoster = $('img[data-src*="tmdb"]').first();
  const tmdbSrc = (tmdbPoster.attr('data-src') || '').replace(/^\/\//, 'https://');
  const posterUrl = tmdbSrc ? tmdbSrc.replace('/w342/', '/w500/') : '';
  const img = posterUrl || $('.post-thumbnail img').first().attr('data-src') || $('.post-thumbnail img').first().attr('src') || '';
  const coverImg = $('img[data-src*="w1280"]').first().attr('data-src')?.replace(/^\/\//, 'https://') || img;
  const rating = 0;
  const bodyText = $('body').text();
  const yearMatch = bodyText.match(/\b(19[5-9]\d|20[0-2]\d)\b/);
  const year = yearMatch ? parseInt(yearMatch[0]) : null;
  let status = 'ongoing';
  if (/\bcompleted\b/i.test(bodyText)) status = 'completed';
  if (url.includes('/movies/')) type = 'movie';
  const studio = '';
  const duration = '';
  const epCountMatch = bodyText.match(/(\d+)\s*Episodes?/);
  const total_episodes = epCountMatch ? parseInt(epCountMatch[1]) : 0;
  const genreTags = [];
  $('a[href*="/category/genre/"]').each((_, el) => {
    const name = $(el).text().trim();
    if (name && name.length < 50) genreTags.push(name);
  });
  const seasonData = [];
  $('a.sel-temp, .sel-temp a, [data-season]').each((_, el) => {
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
