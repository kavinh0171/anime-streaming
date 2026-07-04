require('dotenv').config();
const logger = require('../src/logger');
const db = require('../src/supabase');
const { getCatalogPage, checkAnimerulzMapping } = require('./catalog');
const { scrapeAnime } = require('./anime');

const PER_PAGE = 50;
const START_PAGE = parseInt(process.argv.find(a => a.startsWith('--start='))?.split('=')[1]) || 1;
const MAX_PAGES = parseInt(process.argv.find(a => a.startsWith('--max-pages='))?.split('=')[1]) || Infinity;
const MAX_ERRORS = 10;

async function main() {
  logger.info(`Starting animerulz scraper (start=${START_PAGE}, maxPages=${MAX_PAGES === Infinity ? 'all' : MAX_PAGES})`);
  let totalAnime = 0;
  let totalEpisodes = 0;
  let totalSources = 0;
  let errors = 0;
  let page = START_PAGE;

  const existingSlugs = await db.getExistingSeriesSlugs();

  while (true) {
    logger.info(`Fetching AniList page ${page}...`);
    let pageData;
    try {
      pageData = await getCatalogPage(page, PER_PAGE);
    } catch (e) {
      logger.error(`Failed to fetch page ${page}: ${e.message}`);
      if (++errors >= MAX_ERRORS) break;
      page++;
      continue;
    }

    if (!pageData?.media?.length || (page - START_PAGE + 1) >= MAX_PAGES) break;

    for (const item of pageData.media) {
      const id = item.id;
      const slug = `anime-${id}`;

      if (existingSlugs.has(slug)) {
        continue;
      }

      try {
        const mapping = await checkAnimerulzMapping(id);
        if (!mapping.available) continue;

        if (item.format === 'MOVIE') continue;

        const result = await scrapeAnime(id, mapping.animelokIds);
        if (!result) continue;

        const animeRecord = await db.upsertAnime({
          title: result.title,
          slug: result.slug,
          description: result.description,
          thumbnail: result.thumbnail,
          cover_image: result.cover_image,
          release_year: result.release_year,
          status: result.status,
          type: result.type,
          total_episodes: result.total_episodes,
          rating: 0,
          studio: '',
          duration: '',
        });

        const animeId = animeRecord.id;
        existingSlugs.add(result.slug);

        for (const genreName of result.genres) {
          try {
            const genreSlug = genreName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
            const { id: genreId } = await db.upsertGenre(genreName, genreSlug);
            await db.upsertAnimeGenre(animeId, genreId);
          } catch { }
        }

        for (const sd of result.seasons) {
          let seasonId;
          try {
            const { id } = await db.upsertSeason({
              anime_id: animeId,
              season_number: sd.season_number,
              title: `Season ${sd.season_number}`,
            });
            seasonId = id;
          } catch (e) {
            logger.warn(`  Season upsert failed: ${e.message}`);
            continue;
          }

          for (const ep of result.episodes) {
            try {
              const { id: episodeId } = await db.upsertEpisode({
                anime_id: animeId,
                season_id: seasonId,
                episode_number: ep.episode_number,
                title: ep.title || `Episode ${ep.episode_number}`,
                thumbnail: result.thumbnail,
                source_url: ep.source_url,
              });

              await db.insertVideoSource({
                episode_id: episodeId,
                source_url: ep.source_url,
                source_type: 'embed',
                quality: 'HD',
                language: 'multi',
              });

              totalSources++;
              totalEpisodes++;
            } catch (e) {
              logger.warn(`  Episode ${ep.episode_number} failed: ${e.message}`);
            }
          }
        }

        totalAnime++;
        logger.info(`Done: ${result.title} (${totalAnime} anime, ${totalEpisodes} eps, ${totalSources} sources)`);

        await new Promise(r => setTimeout(r, 500));
      } catch (e) {
        logger.warn(`Skipped ID ${id}: ${e.message}`);
      }
    }

    if (!pageData.pageInfo?.hasNextPage) break;
    page++;
  }

  logger.info(`Scrape complete: ${totalAnime} anime, ${totalEpisodes} episodes, ${totalSources} sources`);
}

main().catch(e => {
  logger.error(`Fatal: ${e.message}`);
  process.exit(1);
});
