const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const logger = require('./logger');
const config = require('./config');
const db = require('./supabase');
const { discoverAllSeries } = require('./catalog');
const { scrapeSeries } = require('./series');
const { loadSeasonEpisodes } = require('./seasons');
const { extractCdnHash } = require('./episodes');
const { verifyCdnHash } = require('./sources');
const pLimit = require('p-limit').default;

const CONCURRENCY = parseInt(process.env.MAX_CONCURRENT_PAGES || '3');

async function scrapeSite(mode) {
  const startTime = Date.now();
  const logEntry = {
    scraper_type: config.SITE,
    status: 'running',
    started_at: new Date().toISOString(),
    items_scraped: 0,
    errors: '',
  };
  try {
    await db.logScrape(logEntry);
  } catch (e) { /* log table may not exist yet */ }

  const existingSlugs = mode === 'incremental' ? await db.getExistingSeriesSlugs() : new Set();
  let totalAnime = 0;
  let totalEpisodes = 0;
  let errors = [];

  const limit = pLimit(CONCURRENCY);

  const processSeries = async (catalogItem) => {
    if (existingSlugs.has(catalogItem.slug) && mode !== 'full') {
      return;
    }
    const seriesInfo = await scrapeSeries(catalogItem.slug, catalogItem.type || 'series');
    if (!seriesInfo) return;
    try {
      const { id: animeId } = await db.upsertAnime({
        title: seriesInfo.title,
        slug: seriesInfo.slug,
        description: seriesInfo.description,
        cover_image: seriesInfo.cover_image,
        thumbnail: seriesInfo.thumbnail,
        rating: seriesInfo.rating,
        release_year: seriesInfo.release_year,
        status: seriesInfo.status,
        type: seriesInfo.type,
        studio: seriesInfo.studio,
        duration: seriesInfo.duration,
        total_episodes: seriesInfo.total_episodes,
      });
      for (const genreName of seriesInfo.genres) {
        const genreSlug = genreName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        if (!genreSlug) continue;
        try {
          const { id: genreId } = await db.upsertGenre(genreName, genreSlug);
          await db.upsertAnimeGenre(animeId, genreId);
        } catch (e) { /* genre may already exist */ }
      }
      for (const sd of seriesInfo.seasons) {
        const { id: seasonId } = await db.upsertSeason({
          anime_id: animeId,
          season_number: sd.season_number,
          title: `Season ${sd.season_number}`,
        });
        const episodes = await loadSeasonEpisodes(sd.post_id, sd.season_number);
        for (const ep of episodes) {
          try {
            const source = await extractCdnHash(ep.episode_url);
            const sourceUrl = source ? source.cdn_url : '';
            const epData = {
              anime_id: animeId,
              season_id: seasonId,
              episode_number: ep.episode_number,
              title: ep.title || `Episode ${ep.episode_number}`,
              thumbnail: ep.thumbnail || '',
              source_url: sourceUrl,
            };
            const { id: episodeId } = await db.upsertEpisode(epData);
            if (source) {
              await db.insertVideoSource({
                episode_id: episodeId,
                source_url: source.cdn_url,
                source_type: 'embed',
                quality: 'HD',
                language: 'sub',
              });
              logger.info(`  Stored ${source.provider || 'embed'}: ${source.cdn_hash || source.cdn_url.substring(0, 60)}`);
              if (source.languages && source.languages.length > 0) {
                for (const lang of source.languages) {
                  if (lang.url) {
                    await db.insertVideoSource({
                      episode_id: episodeId,
                      source_url: lang.url,
                      source_type: 'embed',
                      quality: 'HD',
                      language: lang.language,
                    });
                    logger.info(`  Stored ${lang.label || lang.language} source: ${lang.url.substring(0, 50)}`);
                  }
                }
              }
            }
            totalEpisodes++;
          } catch (e) {
            errors.push(`Episode ${ep.episode_number}: ${e.message}`);
          }
        }
      }
      totalAnime++;
      logger.info(`Done: ${seriesInfo.title} (${totalAnime} series, ${totalEpisodes} eps)`);
    } catch (e) {
      errors.push(`${seriesInfo.slug}: ${e.message}`);
      logger.error(`Failed ${seriesInfo.slug}: ${e.message}`);
    }
  };

  await discoverAllSeries(
    (item) => limit(() => processSeries(item)),
    (page, total, count, runningTotal) => {
      logger.info(`Catalog progress: page ${page}/${total} (${count} items, ${runningTotal} total)`);
    }
  );

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  logger.info(`=== Scrape complete: ${totalAnime} series, ${totalEpisodes} episodes in ${elapsed}min ===`);
  if (errors.length > 0) {
    logger.error(`Errors (${errors.length}): ${errors.slice(0, 10).join(' | ')}`);
  }
  try {
    await db.supabase.from('scraping_logs').insert({
      scraper_type: config.SITE,
      status: errors.length > 0 ? 'completed_with_errors' : 'completed',
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      items_scraped: totalEpisodes,
      errors: errors.slice(0, 500).join('\n'),
    });
  } catch (e) { /* ok */ }
}

const mode = process.argv.includes('--type=full') ? 'full'
  : process.argv.includes('--type=incremental') ? 'incremental'
  : 'full';

logger.info(`Starting scraper for "${config.SITE}" in ${mode} mode`);
scrapeSite(mode).catch(err => {
  logger.error(`Fatal: ${err.message}`);
  process.exit(1);
});
