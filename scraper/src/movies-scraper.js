const { createPage, delay, safeNavigate } = require('./browser');
const db = require('./supabase');
const logger = require('./logger');

const BASE_URL = 'https://toonplay.in';

async function scrapeMoviesList(page = 1) {
  const url = page === 1 ? `${BASE_URL}/anime/movies` : `${BASE_URL}/anime/movies?page=${page}`;
  logger.info(`Scraping movies page ${page}: ${url}`);

  const { page: p, context } = await createPage();
  try {
    await safeNavigate(p, url);
    await p.waitForSelector('article, .item, .anime-card, a[href*="/watch/"]', { timeout: 15000 }).catch(() => {});

    const movies = await p.evaluate(() => {
      const items = [];
      const links = document.querySelectorAll('a[href*="/watch/"]');
      const seen = new Set();

      links.forEach((link) => {
        const href = link.getAttribute('href');
        if (!href || seen.has(href)) return;
        seen.add(href);

        const card = link.closest('article, div') || link;
        const img = card.querySelector('img');
        const titleEl = card.querySelector('.title, h2, h3, .name, [class*="title"]');

        items.push({
          url: href.startsWith('http') ? href : `https://toonplay.in${href}`,
          title: titleEl ? titleEl.textContent.trim() : link.textContent.trim() || 'Unknown',
          thumbnail: img ? img.getAttribute('src') || img.getAttribute('data-src') || '' : '',
        });
      });
      return items;
    });

    logger.info(`Found ${movies.length} movies on page ${page}`);
    return movies;
  } catch (err) {
    logger.error(`Error scraping movies page ${page}:`, err);
    return [];
  } finally {
    await context.close();
  }
}

async function scrapeMovieDetail(url) {
  logger.info(`Scraping movie detail: ${url}`);

  const { page: p, context } = await createPage();
  try {
    await safeNavigate(p, url);
    await p.waitForTimeout(3000);

    const data = await p.evaluate(() => {
      const getText = (sel) => document.querySelector(sel)?.textContent?.trim() || '';
      const getAttr = (sel, attr) => document.querySelector(sel)?.getAttribute(attr) || '';

      const title = getText('h1') || getText('.entry-title') || getText('[class*="title"]');
      const desc = getText('.description, .entry-content, [class*="description"]');
      const cover = getAttr('.cover img, .poster img, [class*="thumb"] img', 'src');
      const rating = parseFloat(getText('.rating, [class*="rating"]')) || 0;

      const genres = [];
      document.querySelectorAll('.genres a, .genre a, [class*="genre"] a').forEach((a) => {
        const g = a.textContent.trim();
        if (g) genres.push(g);
      });

      const meta = {};
      document.querySelectorAll('.meta-info span, .info span, [class*="meta"] span').forEach((s) => {
        const label = s.querySelector('strong, b')?.textContent?.trim()?.toLowerCase() || '';
        const value = s.textContent.replace(label, '').replace(/[:]/g, '').trim();
        if (label) meta[label] = value;
      });

      const status = 'movie';
      const studio = meta['studio'] || '';
      const year = parseInt(meta['year'] || meta['release'] || '') || null;
      const duration = meta['duration'] || '';

      return { title, description: desc, cover_image: cover, rating, genres, status, studio, release_year: year, duration };
    });

    if (!data.title) {
      data.title = url.split('/watch/')[1]?.split('/')[0]?.replace(/-/g, ' ') || url;
    }

    const slug = url.split('/watch/')[1]?.split('/')[0] || url.split('/').pop();
    const animeRecord = {
      title: data.title,
      slug,
      description: data.description,
      cover_image: data.cover_image,
      thumbnail: data.cover_image,
      rating: data.rating,
      release_year: data.release_year,
      status: 'completed',
      studio: data.studio,
      type: 'movie',
      duration: data.duration,
      total_episodes: 1,
      source_url: url,
    };

    const anime = await db.upsertAnime(animeRecord);
    logger.info(`Upserted movie: ${data.title} (${slug})`);

    for (const genreName of data.genres) {
      const genre = await db.upsertGenre(genreName);
      if (genre && anime) {
        const supabase = require('../../database/config');
        await supabase.from('anime_genres').upsert(
          { anime_id: anime.id, genre_id: genre.id },
          { onConflict: 'anime_id,genre_id' }
        ).catch(() => {});
      }
    }

    const seasonRecord = await db.upsertSeason({
      anime_id: anime.id,
      season_number: 1,
      title: 'Movie',
      episode_count: 1,
    });

    const epRecord = await db.upsertEpisode({
      anime_id: anime.id,
      season_id: seasonRecord.id,
      episode_number: 1,
      title: data.title,
      thumbnail: data.cover_image,
    });

    const sources = await p.evaluate(() => {
      const results = [];
      document.querySelectorAll('iframe[src*="gogoplay"], iframe[src*="vidplay"], iframe[src*="rabbitstream"], #player iframe, .player iframe, video source, video').forEach((el) => {
        const src = el.getAttribute('src') || el.getAttribute('data-src');
        if (src) {
          results.push({
            url: src,
            type: el.tagName === 'IFRAME' ? 'iframe' : 'direct',
            quality: el.getAttribute('data-quality') || 'HD',
            language: 'sub',
          });
        }
      });
      return results;
    });

    for (const source of sources) {
      await db.upsertVideoSource({
        episode_id: epRecord.id,
        source_url: source.url,
        source_type: source.type,
        quality: source.quality,
        language: source.language,
      });
    }

    logger.info(`Found ${sources.length} video sources for movie`);
    return anime;
  } catch (err) {
    logger.error(`Error scraping movie detail ${url}:`, err);
    return null;
  } finally {
    await context.close();
  }
}

module.exports = { scrapeMoviesList, scrapeMovieDetail };
