const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

async function upsertAnime(anime) {
  const { data, error } = await supabase.from('anime_series').upsert(anime, {
    onConflict: 'slug',
    ignoreDuplicates: false,
  }).select('id').single();
  if (error) throw error;
  return data;
}

async function upsertSeason(season) {
  const { data, error } = await supabase.from('seasons').upsert(season, {
    onConflict: 'anime_id,season_number',
    ignoreDuplicates: false,
  }).select('id').single();
  if (error) throw error;
  return data;
}

async function upsertEpisode(episode) {
  const { data, error } = await supabase.from('episodes').upsert(episode, {
    onConflict: 'anime_id,episode_number,season_id',
    ignoreDuplicates: false,
  }).select('id').single();
  if (error) throw error;
  return data;
}

async function upsertGenre(name, slug) {
  const { data, error } = await supabase.from('genres').upsert({ name, slug }, {
    onConflict: 'slug',
    ignoreDuplicates: false,
  }).select('id').single();
  if (error) throw error;
  return data;
}

async function upsertAnimeGenre(animeId, genreId) {
  const { error } = await supabase.from('anime_genres').upsert({
    anime_id: animeId, genre_id: genreId,
  }, { onConflict: 'anime_id,genre_id' });
  if (error) throw error;
}

async function insertVideoSource(vs) {
  const { error } = await supabase.from('video_sources').insert(vs);
  if (error) throw error;
}

async function logScrape(log) {
  const { error } = await supabase.from('scraping_logs').insert(log);
  if (error) throw error;
}

async function getExistingSeriesSlugs() {
  const { data, error } = await supabase.from('anime_series').select('slug');
  if (error) throw error;
  return new Set(data.map(r => r.slug));
}

async function getExistingEpisodeKeys() {
  const { data, error } = await supabase.from('episodes').select('anime_id,episode_number,season_id');
  if (error) throw error;
  return new Set(data.map(r => `${r.anime_id}:${r.episode_number}:${r.season_id}`));
}

module.exports = {
  supabase,
  upsertAnime,
  upsertSeason,
  upsertEpisode,
  upsertGenre,
  upsertAnimeGenre,
  insertVideoSource,
  logScrape,
  getExistingSeriesSlugs,
  getExistingEpisodeKeys,
};
