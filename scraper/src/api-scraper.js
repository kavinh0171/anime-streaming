const { chromium } = require('playwright');
const logger = require('./logger');
const db = require('./supabase');
const supabaseClient = require('../../database/config');

const PAGE_BASE = 'https://toonplay.in';

const BROWSER_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--blink-settings=imagesEnabled=false', '--disable-blink-features=AutomationControlled'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const ANILIST_API = 'https://graphql.anilist.co';
const ANILIST_QUERY = `query($title:String){Media(search:$title,type:ANIME){trending popularity averageScore title{english romaji}}}`;

async function fetchAnilistData(title) {
  try {
    const res = await fetch(ANILIST_API, {
      method:'POST', headers:{'Content-Type':'application/json','Accept':'application/json'},
      body:JSON.stringify({query:ANILIST_QUERY,variables:{title}}),
      signal:AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.data?.Media || null;
  } catch { return null; }
}

async function createPage(browser) {
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1920, height: 1080 } });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
  return ctx.newPage();
}

async function captureApiResponse(page, urlPattern, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${urlPattern}`)), timeout);

    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes(urlPattern)) {
        try {
          const json = await response.json();
          clearTimeout(timer);
          resolve(json);
        } catch (e) { /* not json */ }
      }
    });
  });
}

async function fetchSeriesList(pageNum = 1, browser) {
  logger.info(`Fetching series list page ${pageNum} via API`);

  const ownBrowser = !browser;
  if (!browser) browser = await chromium.launch({ headless: true, args: BROWSER_ARGS });

  const page = await createPage(browser);
  const apiPromise = captureApiResponse(page, '/api/anime/series').catch(() => null);

  try {
    await page.goto(`${PAGE_BASE}/anime/series?page=${pageNum}`, {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);

    const data = await apiPromise;
    if (data && data.success) {
      logger.info(`API returned ${data.data?.length || 0} series (page ${pageNum}/${data.pagination?.totalPages})`);
      return {
        items: data.data || [],
        totalPages: data.pagination?.totalPages || 1,
      };
    }

    return { items: [], totalPages: 1 };
  } catch (err) {
    logger.error(`Error fetching series list page ${pageNum}:`, err);
    return { items: [], totalPages: 1 };
  } finally {
    await page.context().close();
    if (ownBrowser) await browser.close();
  }
}

async function fetchMoviesList(pageNum = 1, browser) {
  logger.info(`Fetching movies list page ${pageNum} via API`);

  const ownBrowser = !browser;
  if (!browser) browser = await chromium.launch({ headless: true, args: BROWSER_ARGS });

  const page = await createPage(browser);
  const apiPromise = captureApiResponse(page, '/api/anime/movies').catch(() => null);

  try {
    await page.goto(`${PAGE_BASE}/anime/movies${pageNum > 1 ? `?page=${pageNum}` : ''}`, {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);

    const data = await apiPromise;
    if (data && data.success) {
      logger.info(`API returned ${data.data?.length || 0} movies (page ${pageNum}/${data.pagination?.totalPages})`);
      return {
        items: data.data || [],
        totalPages: data.pagination?.totalPages || 1,
      };
    }

    return { items: [], totalPages: 1 };
  } catch (err) {
    logger.error(`Error fetching movies list page ${pageNum}:`, err);
    return { items: [], totalPages: 1 };
  } finally {
    await page.context().close();
    if (ownBrowser) await browser.close();
  }
}

async function fetchAnimeInfo(id, browser) {
  logger.info(`Fetching anime info for ${id}`);

  const ownBrowser = !browser;
  if (!browser) browser = await chromium.launch({ headless: true, args: BROWSER_ARGS });

  const page = await createPage(browser);
  const apiPromise = captureApiResponse(page, '/api/info').catch(() => null);

  try {
    await page.goto(`${PAGE_BASE}/watch/${id}`, {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);

    const data = await apiPromise;
    if (data && data.success && data.anime) {
      return data.anime;
    }

    logger.warn(`Failed to fetch info for ${id}`);
    return null;
  } catch (err) {
    logger.error(`Error fetching anime info for ${id}:`, err);
    return null;
  } finally {
    await page.context().close();
    if (ownBrowser) await browser.close();
  }
}

async function processAnimeItem(item, browser) {
  const id = item.id;
  if (!id) {
    const slug = item.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const fullId = `${item.type === 'movie' ? 'movies' : 'series'}-${slug}`;
    return processAnimeItem({ ...item, id: fullId }, browser);
  }

  const info = await fetchAnimeInfo(id, browser);
  if (!info) {
    logger.warn(`Skipping ${item.title}: no info returned`);
    return null;
  }

  const slug = id;
  const type = info.type === 'movie' ? 'movie' : 'series';
  const rating = parseFloat(info.rating || item.rating || 0);
  const seasonsList = info.seasonsList || [];
  const totalEps = type === 'movie'
    ? 1
    : seasonsList.reduce((sum, s) => sum + (s.episodeCount || s.episodes?.length || 0), 0);

  const anilist = await fetchAnilistData(info.title);
  const animeRecord = {
    title: info.title,
    slug,
    description: info.overview || '',
    cover_image: info.backdrop || info.image || item.image || '',
    thumbnail: info.image || item.image || '',
    rating: isNaN(rating) ? 0 : rating,
    release_year: info.year ? parseInt(info.year) : null,
    status: type === 'movie' ? 'completed' : 'ongoing',
    studio: (info.networks || []).join(', ') || '',
    type,
    total_episodes: totalEps,
    duration: info.episodeDuration || '',
    source_url: `${PAGE_BASE}/watch/${slug}`,
    popularity: anilist?.popularity || 0,
    trending: anilist?.trending || 0,
  };

  const anime = await db.upsertAnime(animeRecord);
  if (!anime) return null;

  // Genres
  const genres = info.genres || [];
  for (const genreName of genres) {
    const genre = await db.upsertGenre(genreName);
    if (genre) {
      try {
        await supabaseClient.from('anime_genres').upsert(
          { anime_id: anime.id, genre_id: genre.id },
          { onConflict: 'anime_id,genre_id' }
        );
      } catch (_) {}
    }
  }

  // Seasons & Episodes
  if (seasonsList.length === 0 && type === 'movie') {
    // Movie - single season/episode
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
      title: info.title,
      thumbnail: info.image || '',
    });

    // Movies have watchServers directly in the info API response
    const watchServers = info.watchServers || [];
    for (const server of watchServers) {
      if (server.url) {
        await db.upsertVideoSource({
          episode_id: epRecord.id,
          source_url: server.url,
          source_type: 'embed',
          quality: 'HD',
          language: 'sub',
        });
      }
    }
    if (watchServers.length > 0) {
      logger.info(`  Added ${watchServers.length} video source(s) for movie`);
    }
  } else {
    for (const season of seasonsList) {
      const seasonRecord = await db.upsertSeason({
        anime_id: anime.id,
        season_number: parseInt(season.season) || 1,
        title: season.title || `Season ${season.season}`,
        episode_count: season.episodeCount || season.episodes?.length || 0,
      });

      const episodes = season.episodes || [];
      for (const ep of episodes) {
        await db.upsertEpisode({
          anime_id: anime.id,
          season_id: seasonRecord.id,
          episode_number: ep.number,
          title: ep.title || `Episode ${ep.number}`,
          thumbnail: ep.image || '',
          source_url: `${PAGE_BASE}/${ep.id}`,
        });
      }
      // After all episodes are created, batch-fetch video sources
      if (episodes.length > 0 && (season.link || episodes[0]?.id)) {
        try {
          const extractResults = await fetchBatchVideoSources(id, [{ ...season, episodes }], browser);

          for (const ep of episodes) {
            const epUrl = `https://animesalt.ac/episode/${ep.id.replace('episode/', '')}`;
            const videoUrl = extractResults[epUrl];
            if (videoUrl) {
              // Get the episode record from DB
              const epRecords = await supabaseClient
                .from('episodes')
                .select('id')
                .eq('anime_id', anime.id)
                .eq('season_id', seasonRecord.id)
                .eq('episode_number', ep.number)
                .limit(1);
              const epRecord = epRecords?.data?.[0];
              if (epRecord) {
                await db.upsertVideoSource({
                  episode_id: epRecord.id,
                  source_url: videoUrl,
                  source_type: 'embed',
                  quality: 'HD',
                  language: 'sub',
                });
              }
            }
          }
        } catch (err) {
          logger.warn(`Failed to batch-fetch video sources: ${err.message}`);
        }
      }
    }
  }

  logger.info(`Processed: ${info.title} (${slug}) - ${totalEps} episodes, ${genres.length} genres`);
  return anime;
}

async function fetchBatchVideoSources(animeId, seasonsList, browser) {
  const ownBrowser = !browser;
  if (!browser) browser = await chromium.launch({ headless: true, args: BROWSER_ARGS });

  const page = await createPage(browser);
  const extractResults = {};

  const epIds = [];
  for (const season of seasonsList) {
    for (const ep of (season.episodes || [])) {
      epIds.push({ season: season.season, ep: ep.number, id: ep.id });
    }
  }
  if (epIds.length === 0) { await page.context().close(); if (ownBrowser) await browser.close(); return {}; }

  try {
    const cleanSlug = animeId.replace(/^(series-|movies-)/, '');
    await page.goto(`https://toonplay.in/watch/series-${cleanSlug}`, {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);

    // Directly call the extract API for each episode from within the page context
    for (const epInfo of epIds) {
      const epPath = epInfo.id.replace(/^episode\//, '');
      const epUrl = `https://animesalt.ac/episode/${epPath}`;
      if (extractResults[epUrl]) continue;

      try {
        const result = await page.evaluate(async (url) => {
          const r = await fetch(`https://anime.streamindia.co.in/api/extract?url=${encodeURIComponent(url)}`, {
            headers: { 'Referer': 'https://toonplay.in/', 'Origin': 'https://toonplay.in' },
          });
          if (r.ok) return await r.json();
          return null;
        }, epUrl);
        if (result?.success && result?.data?.videoPlayerUrl) {
          extractResults[epUrl] = result.data.videoPlayerUrl;
        }
      } catch (e) {}
    }

    return extractResults;
  } catch (err) {
    logger.warn(`Batch video source fetch error: ${err.message}`);
    return extractResults;
  } finally {
    await page.context().close();
    if (ownBrowser) await browser.close();
  }
}

async function fetchVideoSource(episodeId) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--blink-settings=imagesEnabled=false', '--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    viewport: { width: 1920, height: 1080 },
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();
  let videoUrl = null;

  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('/api/extract')) {
      try {
        const json = await response.json();
        if (json.success && json.data?.videoPlayerUrl) {
          videoUrl = json.data.videoPlayerUrl;
        }
      } catch (e) {}
    }
  });

  try {
    // We need to be on the watch page for the extract API to work
    // Build anime slug from episodeId (e.g. "episode/witch-hat-atelier-1x1")
    const animeSlug = episodeId.split('/').pop()?.split('-').slice(0, -2).join('-') || episodeId;
    await page.goto(`https://toonplay.in/watch/series-${animeSlug}`, {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    await page.waitForTimeout(5000);
    return videoUrl;
  } catch (err) {
    logger.warn(`Video source fetch error for ${episodeId}: ${err.message}`);
    return null;
  } finally {
    await browser.close();
  }
}

module.exports = {
  fetchSeriesList,
  fetchMoviesList,
  fetchAnimeInfo,
  processAnimeItem,
  fetchVideoSource,
};
