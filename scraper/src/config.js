const SITE = (
  process.env.SCRAPE_SITE
  || process.argv.find(a => a.startsWith('--site='))?.split('=')[1]
  || 'animesalt'
).toLowerCase();

const SITES = {
  toonstream: {
    base: 'https://toonstream.vip',
    catalogPath: '/category/anime/',
    totalPages: 52,
    seasonAjaxMethod: 'post',
    episodePattern: 'trembed',
  },
  animesalt: {
    base: 'https://animesalt.ac',
    catalogPath: '/series/',
    totalPages: 33,
    seasonAjaxMethod: 'get',
    episodePattern: 'direct',
  },
};

if (!SITES[SITE]) {
  console.error(`Unknown site: "${SITE}". Valid: ${Object.keys(SITES).join(', ')}`);
  process.exit(1);
}

module.exports = { SITE, ...SITES[SITE], SITES };
