require('dotenv').config();
const supabase = require('../../database/config');

(async () => {
  const { data, error } = await supabase
    .from('anime_series')
    .update({ total_episodes: 1 })
    .eq('type', 'movie')
    .select('title');

  if (error) { console.error('Error:', error); return; }
  console.log('Updated movies:', data?.length);
  data?.forEach(m => console.log(' -', m.title));
})();
