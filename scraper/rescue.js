require('dotenv').config();
const logger = require('./src/logger');
const db = require('./src/supabase');
const { scrapeSeries } = require('./src/series');
const { loadSeasonEpisodes } = require('./src/seasons');
const { extractCdnHash } = require('./src/episodes');

const slugs = process.argv.slice(2);
if (!slugs.length) {
  logger.error('Usage: node rescue.js [--type=movie] <slug1> <slug2> ...');
  process.exit(1);
}

const typeFlag = slugs.find(a => a.startsWith('--type='));
const type = typeFlag ? typeFlag.split('=')[1] : 'series';
const cleanSlugs = slugs.filter(a => !a.startsWith('--'));

(async () => {
  for (const slug of cleanSlugs) {
    logger.info(`=== Rescuing: ${slug} (${type}) ===`);
    const info = await scrapeSeries(slug, type);
    if (!info) { logger.warn(`  NOT FOUND: ${slug}`); continue; }

    const existing = await db.supabase.from('anime_series').select('id').eq('slug', slug).maybeSingle();
    let animeId;
    if (existing.data) {
      animeId = existing.data.id;
      logger.info(`  Already exists, re-scraping (id=${animeId})`);
    } else {
      const r = await db.upsertAnime({
        title: info.title, slug: info.slug, description: info.description,
        cover_image: info.cover_image, thumbnail: info.thumbnail,
        rating: info.rating, release_year: info.release_year,
        status: info.status, type: info.type, studio: info.studio,
        duration: info.duration, total_episodes: info.total_episodes,
      });
      animeId = r.id;
    }

    for (const g of info.genres) {
      const gs = g.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (!gs) continue;
      const { id: gid } = await db.upsertGenre(g, gs);
      await db.upsertAnimeGenre(animeId, gid);
    }

    let totalEps = 0;
    for (const sd of info.seasons) {
      const { id: seasonId } = await db.upsertSeason({
        anime_id: animeId, season_number: sd.season_number,
        title: `Season ${sd.season_number}`,
      });
      const episodes = await loadSeasonEpisodes(sd.post_id, sd.season_number);
      logger.info(`  Season ${sd.season_number}: ${episodes.length} episodes`);

      for (const ep of episodes) {
        const source = await extractCdnHash(ep.episode_url);
        const sourceUrl = source ? source.cdn_url : '';
        const { id: episodeId } = await db.upsertEpisode({
          anime_id: animeId, season_id: seasonId,
          episode_number: ep.episode_number,
          title: ep.title || `Episode ${ep.episode_number}`,
          thumbnail: ep.thumbnail || '',
          source_url: sourceUrl,
        });
        if (source) {
          await db.insertVideoSource({
            episode_id: episodeId, source_url: source.cdn_url,
            source_type: 'embed', quality: 'HD', language: 'sub',
          });
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
              }
            }
          }
        }
        totalEps++;
        logger.info(`  Ep ${ep.episode_number} -> ${source ? (source.cdn_hash || 'multi-lang') : 'NO SOURCE'}`);
      }
    }
    logger.info(`  Done: ${info.title} — ${totalEps} episodes`);
  }
  logger.info('=== All rescues complete ===');
  process.exit(0);
})().catch(e => { logger.error(e.message); process.exit(1); });
