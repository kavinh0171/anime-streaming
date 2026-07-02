require('dotenv').config();
const supabase = require('../../database/config');

(async () => {
  const { data: items, error } = await supabase.from('anime_series').select('id, title, slug').ilike('slug', 'ts-%');
  if (error) { console.error('Query error:', error); process.exit(1); }
  if (!items || items.length === 0) { console.log('No toonstream items found'); process.exit(0); }
  console.log(`Found ${items.length} toonstream items to delete:`);
  for (const item of items) {
    console.log(`  ${item.slug} — ${item.title}`);
  }
  for (const item of items) {
    const { data: eps } = await supabase.from('episodes').select('id').eq('anime_id', item.id);
    if (eps && eps.length > 0) {
      const epIds = eps.map(e => e.id);
      await supabase.from('video_sources').delete().in('episode_id', epIds);
      console.log(`  Deleted ${epIds.length} video_sources for ${item.slug}`);
      await supabase.from('episodes').delete().eq('anime_id', item.id);
      console.log(`  Deleted episodes for ${item.slug}`);
    }
    await supabase.from('seasons').delete().eq('anime_id', item.id);
    await supabase.from('anime_genres').delete().eq('anime_id', item.id);
    await supabase.from('anime_series').delete().eq('id', item.id);
    console.log(`  Deleted anime: ${item.slug}`);
  }
  console.log(`\nDone. Deleted ${items.length} toonstream items.`);
})();
