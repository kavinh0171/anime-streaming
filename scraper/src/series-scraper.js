const { createPage, delay, safeNavigate } = require('./browser');
const db = require('./supabase');
const logger = require('./logger');

const BASE_URL = 'https://toonplay.in';

async function scrapeSeriesList(page = 1) {
  const url = `${BASE_URL}/anime/series?page=${page}`;
  logger.info(`Scraping series list page ${page}: ${url}`);

  const { page: p, context } = await createPage();
  try {
    await safeNavigate(p, url);
    await p.waitForSelector('article, .item, .anime-card, a[href*="/watch/"]', { timeout: 15000 }).catch(() => {});

    const series = await p.evaluate(() => {
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

    logger.info(`Found ${series.length} series on page ${page}`);
    return series;
  } catch (err) {
    logger.error(`Error scraping series list page ${page}:`, err);
    return [];
  } finally {
    await context.close();
  }
}

async function scrapeSeriesDetail(url) {
  logger.info(`Scraping series detail: ${url}`);

  const { page: p, context } = await createPage();
  try {
    await safeNavigate(p, url);
    await p.waitForTimeout(3000);

    const data = await p.evaluate(() => {
      const getText = (sel) => document.querySelector(sel)?.textContent?.trim() || '';
      const getAttr = (sel, attr) => document.querySelector(sel)?.getAttribute(attr) || '';

      const title = getText('h1') || getText('.entry-title') || getText('[class*="title"]');
      const desc = getText('.description, .entry-content, [class*="description"], [class*="summary"]');
      const cover = getAttr('.cover img, .poster img, [class*="thumb"] img, .wp-post-image', 'src');
      const rating = parseFloat(getText('.rating, [class*="rating"], .star-rating')) || 0;

      const genres = [];
      document.querySelectorAll('.genres a, .genre a, [class*="genre"] a, .tag a').forEach((a) => {
        const g = a.textContent.trim();
        if (g) genres.push(g);
      });

      const meta = {};
      document.querySelectorAll('.meta-info span, .info span, [class*="meta"] span, [class*="info"] span').forEach((s) => {
        const label = s.querySelector('strong, b')?.textContent?.trim()?.toLowerCase() || '';
        const value = s.textContent.replace(label, '').replace(/[:]/g, '').trim();
        if (label) meta[label] = value;
      });

      const status = getText('.status, [class*="status"]') || meta['status'] || 'Ongoing';
      const studio = meta['studio'] || '';
      const year = parseInt(meta['year'] || meta['release'] || '') || null;
      const duration = meta['duration'] || meta['episode duration'] || '';

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
      status: data.status.toLowerCase().includes('ongoing') ? 'ongoing' : 'completed',
      studio: data.studio,
      type: 'series',
      duration: data.duration,
      source_url: url,
    };

    const anime = await db.upsertAnime(animeRecord);
    logger.info(`Upserted anime: ${data.title} (${slug})`);

    for (const genreName of data.genres) {
      const genre = await db.upsertGenre(genreName);
      if (genre && anime) {
        await supabase.from('anime_genres').upsert(
          { anime_id: anime.id, genre_id: genre.id },
          { onConflict: 'anime_id,genre_id' }
        ).catch(() => {});
      }
    }

    await scrapeEpisodes(p, anime.id, slug);

    return anime;
  } catch (err) {
    logger.error(`Error scraping series detail ${url}:`, err);
    return null;
  } finally {
    await context.close();
  }
}

async function scrapeEpisodes(page, animeId, slug) {
  logger.info(`Scraping episodes for ${slug}`);

  try {
    await page.waitForSelector('.seasons, .season-list, select#season, [class*="season"], .episode-list', { timeout: 10000 }).catch(() => {});

    const seasonData = await page.evaluate(() => {
      const seasons = [];
      const seasonSelect = document.querySelector('select#season, select[class*="season"], .season-select select');
      const seasonTabs = document.querySelectorAll('.season-tab, [class*="season-tab"], .season-btn');

      if (seasonSelect) {
        seasonSelect.querySelectorAll('option').forEach((opt) => {
          seasons.push({ number: parseInt(opt.value) || parseInt(opt.textContent) || 1, title: opt.textContent.trim(), elementIndex: opt.index });
        });
      } else if (seasonTabs.length > 0) {
        seasonTabs.forEach((tab, i) => {
          seasons.push({ number: i + 1, title: tab.textContent.trim(), elementIndex: i });
        });
      } else {
        const seasonHeadings = document.querySelectorAll('h2, h3, h4');
        seasonHeadings.forEach((h) => {
          const text = h.textContent.toLowerCase();
          if (text.includes('season')) {
            const num = parseInt(text.replace(/[^0-9]/g, '')) || seasons.length + 1;
            seasons.push({ number: num, title: h.textContent.trim(), elementIndex: seasons.length });
          }
        });
      }

      if (seasons.length === 0) {
        seasons.push({ number: 1, title: 'Season 1', elementIndex: 0 });
      }

      return seasons;
    });

    for (const season of seasonData) {
      const seasonRecord = await db.upsertSeason({
        anime_id: animeId,
        season_number: season.number,
        title: season.title || `Season ${season.number}`,
      });

      if (!seasonRecord) continue;

      if (seasonData.length > 1) {
        const select = await page.$('select#season, select[class*="season"]');
        if (select) {
          await select.selectOption(season.number.toString());
          await page.waitForTimeout(2000);
        } else {
          const tabs = await page.$$('.season-tab, [class*="season-tab"], .season-btn');
          if (tabs[season.elementIndex]) {
            await tabs[season.elementIndex].click();
            await page.waitForTimeout(2000);
          }
        }
      }

      await page.waitForTimeout(1000);

      const episodeList = await page.evaluate(() => {
        const episodes = [];
        const items = document.querySelectorAll(
          '.episode-item, .episode-card, .ep-list-item, [class*="episode"]:not(.season-), .eplister ul li, .episodes-list li'
        );

        items.forEach((item) => {
          const epNum = parseInt(
            item.querySelector('.ep-number, .num, .eps, .epl-num, [class*="ep-number"]')?.textContent?.replace(/[^0-9]/g, '') || '0'
          );
          const epTitle = item.querySelector('.ep-title, .title, .epl-title, [class*="ep-title"]')?.textContent?.trim() || '';
          const epImg = item.querySelector('img')?.getAttribute('src') || '';
          const epLink = item.querySelector('a')?.getAttribute('href') || '';

          if (epNum > 0) {
            episodes.push({ number: epNum, title: epTitle, thumbnail: epImg, url: epLink });
          }
        });
        return episodes;
      });

      for (const ep of episodeList) {
        const epRecord = await db.upsertEpisode({
          anime_id: animeId,
          season_id: seasonRecord.id,
          episode_number: ep.number,
          title: ep.title || `Episode ${ep.number}`,
          thumbnail: ep.thumbnail,
          source_url: ep.url || '',
        });

        if (ep.url) {
          try {
            await scrapeVideoSource(page, epRecord.id, ep.url);
          } catch (err) {
            logger.warn(`Failed to scrape video source for ep ${ep.number}: ${err.message}`);
          }
        }
      }

      await db.upsertSeason({
        ...seasonRecord,
        episode_count: episodeList.length,
      });

      logger.info(`Season ${season.number}: ${episodeList.length} episodes`);
    }
  } catch (err) {
    logger.error(`Error scraping episodes for ${slug}:`, err);
  }
}

async function scrapeVideoSource(page, episodeId, url) {
  try {
    const srcUrl = url.startsWith('http') ? url : `https://toonplay.in${url}`;
    await safeNavigate(page, srcUrl);
    await page.waitForTimeout(3000);

    const sources = await page.evaluate(() => {
      const results = [];
      const iframes = document.querySelectorAll('iframe[src*="gogoplay"], iframe[src*="vidplay"], iframe[src*="rabbitstream"], #player iframe, .player iframe');
      iframes.forEach((iframe) => {
        const src = iframe.getAttribute('src');
        if (src) {
          results.push({ url: src, type: 'iframe', quality: 'HD', language: 'sub' });
        }
      });

      const videoEls = document.querySelectorAll('video source, video');
      videoEls.forEach((v) => {
        const src = v.getAttribute('src');
        if (src) {
          results.push({ url: src, type: 'direct', quality: v.getAttribute('data-quality') || 'HD', language: 'sub' });
        }
      });

      const embeds = document.querySelectorAll('[data-src*="gogoplay"], [data-src*="vidplay"], [data-src*="rabbitstream"]');
      embeds.forEach((e) => {
        const src = e.getAttribute('data-src');
        if (src) {
          results.push({ url: src, type: 'embed', quality: 'HD', language: 'sub' });
        }
      });

      return results;
    });

    for (const source of sources) {
      await db.upsertVideoSource({
        episode_id: episodeId,
        source_url: source.url,
        source_type: source.type,
        quality: source.quality,
        language: source.language,
      });
    }

    logger.info(`Found ${sources.length} video sources for episode ${episodeId}`);
  } catch (err) {
    logger.warn(`Video source extraction error: ${err.message}`);
  }
}

module.exports = { scrapeSeriesList, scrapeSeriesDetail };
