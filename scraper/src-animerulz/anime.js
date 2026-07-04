const axios = require('axios');

const HI_ANIME_API = 'https://hianime.streamindia.co.in/api/v2/hianime';
const ANIMELOK_API = 'https://animelok.streamindia.co.in/api/anime';

const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
};

async function fetchMetadata(anilistId) {
  const r = await axios.get(`${HI_ANIME_API}/anilist/anime/${anilistId}`, {
    headers: { ...COMMON_HEADERS, 'Referer': `https://animerulzapp.buzz/anime-${anilistId}` },
    timeout: 20000,
  });
  if (r.data.status !== 200 || !r.data.data) throw new Error('Invalid metadata response');
  return r.data.data;
}

function parseMeta(meta) {
  const title = meta.title?.english || meta.title?.romaji || 'Unknown';
  const description = (meta.description || '').replace(/<[^>]+>/g, '').replace(/\[Written by MAL Rewrite\]/g, '').trim().slice(0, 2000);
  const poster = meta.coverImage?.extraLarge || meta.coverImage?.large || '';
  const cover = meta.bannerImage || poster;
  const genres = meta.genres || [];
  const year = meta.seasonYear || null;
  const totalEps = meta.episodes || 0;
  const status = meta.status === 'RELEASING' ? 'ongoing' : (meta.status === 'FINISHED' ? 'completed' : 'ongoing');
  const format = meta.format || 'TV';

  const seasonData = [];
  if (meta.season && meta.seasonYear) {
    seasonData.push({ season_number: 1 });
  }

  return {
    title,
    slug: `anime-${meta.id}`,
    description,
    thumbnail: poster,
    cover_image: cover,
    release_year: year,
    status,
    type: format === 'MOVIE' ? 'movie' : 'series',
    genres,
    total_episodes: totalEps,
    seasons: seasonData,
  };
}

async function getAnimelokSlug(anilistId, animelokIds) {
  for (const slug of animelokIds) {
    try {
      const r = await axios.get(ANIMELOK_API, {
        params: { id: slug, ep: 1 },
        headers: COMMON_HEADERS,
        timeout: 10000,
        validateStatus: () => true,
      });
      if (r.status === 200) return slug;
    } catch { }
  }
  return animelokIds[0] || null;
}

async function fetchEpisodeSource(slug, epNum) {
  try {
    const r = await axios.get(ANIMELOK_API, {
      params: { id: slug, ep: epNum },
      headers: COMMON_HEADERS,
      timeout: 10000,
      validateStatus: () => true,
    });
    if (r.status === 200 && r.data.multi) {
      return { url: r.data.multi, hash: r.data.multi.split('/video/')[1] || '' };
    }
    return null;
  } catch {
    return null;
  }
}

async function scrapeAnime(anilistId, animelokIds) {
  const meta = await fetchMetadata(anilistId);
  const info = parseMeta(meta);

  if (info.total_episodes === 0) return null;

  const slug = await getAnimelokSlug(anilistId, animelokIds);
  if (!slug) return null;

  const episodes = [];
  for (let ep = 1; ep <= info.total_episodes; ep++) {
    const source = await fetchEpisodeSource(slug, ep);
    if (!source) break;
    episodes.push({
      episode_number: ep,
      season_number: 1,
      title: `Episode ${ep}`,
      source_url: source.url,
      source_hash: source.hash,
    });
  }

  if (episodes.length === 0) return null;

  return {
    ...info,
    total_episodes: episodes.length,
    episodes,
  };
}

module.exports = { scrapeAnime };
