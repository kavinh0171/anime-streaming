require('dotenv').config();
const supabase = require('../../database/config');

(async () => {
  const { data: anime, error } = await supabase
    .from('anime_series')
    .select('title, type, total_episodes, rating')
    .order('created_at', { ascending: false });

  if (error) { console.error('Error:', error); return; }

  console.log('Anime in DB:', anime?.length || 0);
  anime?.forEach(a => console.log(' -', a.title, '|', a.type, '|', (a.total_episodes || 0) + ' eps', '|', a.rating));

  const { data: genres } = await supabase.from('genres').select('name');
  console.log('\nGenres:', genres?.length || 0);
  genres?.forEach(g => console.log(' -', g.name));

  const { count: epCount } = await supabase
    .from('episodes')
    .select('*', { count: 'exact', head: true });

  console.log('\nTotal episodes:', epCount || 0);
})();
