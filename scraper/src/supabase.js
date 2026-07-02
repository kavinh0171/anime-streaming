const supabase = require('../../database/config');
const logger = require('./logger');

async function upsertGenre(name) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const { data, error } = await supabase
    .from('genres')
    .upsert({ name, slug }, { onConflict: 'name' })
    .select()
    .single();
  if (error) logger.error('Genre upsert error:', error);
  return data;
}

async function upsertAnime(anime) {
  const { data, error } = await supabase
    .from('anime_series')
    .upsert(anime, { onConflict: 'slug' })
    .select()
    .single();
  if (error) logger.error(`Anime upsert error for ${anime.title}:`, error);
  return data;
}

async function upsertSeason(season) {
  const { data, error } = await supabase
    .from('seasons')
    .upsert(season, { onConflict: 'anime_id,season_number' })
    .select()
    .single();
  if (error) logger.error('Season upsert error:', error);
  return data;
}

async function upsertEpisode(episode) {
  const { data, error } = await supabase
    .from('episodes')
    .upsert(episode, { onConflict: 'anime_id,episode_number,season_id' })
    .select()
    .single();
  if (error) logger.error(`Episode upsert error for ep ${episode.episode_number}:`, error);
  return data;
}

async function upsertVideoSource(source) {
  const { data, error } = await supabase
    .from('video_sources')
    .insert(source)
    .select()
    .single();
  if (error && !error.message.includes('duplicate')) {
    logger.error('Video source insert error:', error);
  }
  return data;
}

async function getAnimeBySlug(slug) {
  const { data } = await supabase
    .from('anime_series')
    .select('*')
    .eq('slug', slug)
    .single();
  return data;
}

async function animeExists(slug) {
  const { data } = await supabase
    .from('anime_series')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();
  return data !== null;
}

async function getLatestAnime(limit = 20) {
  const { data } = await supabase
    .from('anime_series')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(limit);
  return data || [];
}

async function getAnimeWithEpisodes(slug) {
  const { data: anime } = await supabase
    .from('anime_series')
    .select(`
      *,
      seasons(*),
      episodes(*)
    `)
    .eq('slug', slug)
    .single();
  return anime;
}

async function logScrapingStart(type) {
  const { data } = await supabase
    .from('scraping_logs')
    .insert({ scraper_type: type, status: 'running' })
    .select()
    .single();
  return data;
}

async function logScrapingComplete(logId, itemsScraped, errors = null) {
  await supabase
    .from('scraping_logs')
    .update({
      status: errors ? 'completed_with_errors' : 'completed',
      completed_at: new Date().toISOString(),
      items_scraped: itemsScraped,
      errors: errors ? JSON.stringify(errors) : null,
    })
    .eq('id', logId);
}

module.exports = {
  upsertGenre,
  upsertAnime,
  upsertSeason,
  upsertEpisode,
  upsertVideoSource,
  getAnimeBySlug,
  getLatestAnime,
  getAnimeWithEpisodes,
  animeExists,
  logScrapingStart,
  logScrapingComplete,
};
