require('dotenv').config();
const supabase = require('../../database/config');

(async () => {
  const { data: v, count, error } = await supabase
    .from('video_sources')
    .select('*', { count: 'exact' });

  if (error) { console.error('Error:', error); return; }

  console.log('Video sources count:', count);
  console.log('Sample:');
  (v || []).slice(0, 8).forEach(vs => {
    console.log(' -', vs.source_url?.substring(0, 100));
  });

  // Check which episodes are missing video sources
  const { data: eps } = await supabase
    .from('episodes')
    .select('id, episode_number, anime_id');

  console.log(`\nTotal episodes: ${eps?.length || 0}`);

  const epIds = new Set((v || []).map(vs => vs.episode_id));
  const missing = (eps || []).filter(ep => !epIds.has(ep.id));
  console.log(`Episodes WITHOUT video source: ${missing.length}`);

  if (missing.length > 0) {
    console.log('First 3 missing:');
    missing.slice(0, 3).forEach(ep => console.log(' - episode:', ep.episode_number, 'anime:', ep.anime_id));
  }
})();
