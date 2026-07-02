require('dotenv').config();
const supabase = require('../../database/config');

async function clearToonstream() {
  // Delete all toonstream anime + cascade (episodes, seasons, video_sources)
  const { data: series } = await supabase.from('anime_series').select('id, slug, title').like('slug', 'ts-%');
  if (!series || series.length === 0) { console.log('No toonstream data found'); return; }
  console.log(`Found ${series.length} toonstream series to delete`);
  for (const s of series) {
    console.log(`  Deleting: ${s.title} (${s.slug})`);
    const { data: eps } = await supabase.from('episodes').select('id').eq('anime_id', s.id);
    const epIds = (eps || []).map(e => e.id);
    if (epIds.length > 0) await supabase.from('video_sources').delete().in('episode_id', epIds);
    await supabase.from('episodes').delete().eq('anime_id', s.id);
    await supabase.from('seasons').delete().eq('anime_id', s.id);
    await supabase.from('anime_genres').delete().eq('anime_id', s.id);
    await supabase.from('anime_series').delete().eq('id', s.id);
  }
  console.log('Done clearing toonstream data');
}

clearToonstream().catch(console.error).finally(() => process.exit());
