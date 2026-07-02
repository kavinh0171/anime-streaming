require('dotenv').config();
const logger = require('./logger');
const supabase = require('../../database/config');

const ANILIST_API = 'https://graphql.anilist.co';
const QUERY = `query($title:String){Media(search:$title,type:ANIME){trending popularity title{english romaji}}}`;

async function fetchAnilist(title) {
  try {
    const res = await fetch(ANILIST_API, {
      method:'POST', headers:{'Content-Type':'application/json','Accept':'application/json'},
      body:JSON.stringify({query:QUERY,variables:{title}}),
      signal:AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.data?.Media || null;
  } catch { return null; }
}

async function backfill() {
  logger.info('Fetching all anime from database...');
  const { data: animeList, error } = await supabase
    .from('anime_series')
    .select('id, title, trending, popularity');

  if (error) { logger.error('DB error:', error); return; }
  if (!animeList || animeList.length === 0) { logger.info('No anime found.'); return; }

  logger.info(`Processing ${animeList.length} anime...`);
  let updated = 0, failed = 0;

  for (let i = 0; i < animeList.length; i++) {
    const a = animeList[i];
    const title = a.title.replace(/[®™]/g, '').trim();
    logger.info(`[${i+1}/${animeList.length}] ${title}`);
    const data = await fetchAnilist(title);
    if (data) {
      const { error: ue } = await supabase
        .from('anime_series')
        .update({ trending: data.trending || 0, popularity: data.popularity || 0 })
        .eq('id', a.id);
      if (!ue) updated++; else failed++;
    } else {
      // Set to 0 so we don't retry failed lookups
      await supabase.from('anime_series').update({ trending: 0, popularity: 0 }).eq('id', a.id);
      failed++;
    }
    if ((i + 1) % 10 === 0) logger.info(`  Progress: ${i+1}/${animeList.length} (${updated} updated, ${failed} failed)`);
    await new Promise(r => setTimeout(r, 500)); // rate limit
  }

  logger.info(`Done: ${updated} updated, ${failed} failed`);
}

backfill().catch(console.error);
