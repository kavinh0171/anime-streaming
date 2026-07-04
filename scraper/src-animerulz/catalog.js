const axios = require('axios');

const ANILIST_API = 'https://graphql.anilist.co';

const CATALOG_QUERY = `
  query ($page: Int, $perPage: Int) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { hasNextPage lastPage currentPage }
      media(type: ANIME, sort: POPULARITY_DESC) {
        id
        title { romaji english }
        format
        episodes
        status
        season
        seasonYear
        genres
        averageScore
      }
    }
  }
`;

async function getCatalogPage(page, perPage = 50) {
  const r = await axios.post(ANILIST_API, {
    query: CATALOG_QUERY,
    variables: { page, perPage }
  }, {
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    timeout: 30000,
  });
  return r.data.data.Page;
}

async function checkAnimerulzMapping(anilistId) {
  try {
    const r = await axios.get(`https://data.streamindia.co.in/api/animerulz-id=anime-${anilistId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': `https://animerulzapp.buzz/anime-${anilistId}` },
      timeout: 10000,
      validateStatus: () => true,
    });
    if (r.status === 200 && r.data.animelok_id) {
      return {
        available: true,
        animelokIds: Array.isArray(r.data.animelok_id) ? r.data.animelok_id : [r.data.animelok_id],
        languages: r.data.languages || [],
      };
    }
    return { available: false };
  } catch {
    return { available: false };
  }
}

module.exports = { getCatalogPage, checkAnimerulzMapping };
