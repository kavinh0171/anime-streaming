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
  };
}

function parseAnimelokSlug(slug) {
  const m = slug.match(/^(.+)-(\d+)x(\d+)$/);
  if (!m) return null;
  return { seriesName: m[1], seasonNumber: parseInt(m[2]), startEp: parseInt(m[3]) };
}

function buildSeasonRanges(animelokIds, totalEps) {
  const parsed = animelokIds.map(s => parseAnimelokSlug(s)).filter(Boolean);
  if (parsed.length === 0) return [];

  parsed.sort((a, b) => a.seasonNumber - b.seasonNumber);

  return parsed.map((p, i) => {
    const endEp = i < parsed.length - 1 ? parsed[i + 1].startEp - 1 : (totalEps === Infinity ? Infinity : totalEps);
    return {
      slug: animelokIds[i],
      seasonNumber: p.seasonNumber,
      startEp: p.startEp,
      endEp,
    };
  });
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

  const seasonRanges = buildSeasonRanges(animelokIds, info.total_episodes || Infinity);
  if (seasonRanges.length === 0) return null;

  const episodes = [];
  const seasons = [];

  for (const sr of seasonRanges) {
    const testEp = await fetchEpisodeSource(sr.slug, sr.startEp);
    if (!testEp) continue;

    seasons.push({ season_number: sr.seasonNumber });
    const seasonEps = [];

    const maxEp = sr.endEp === Infinity ? sr.startEp + 999 : sr.endEp;
    for (let ep = sr.startEp; ep <= maxEp; ep++) {
      const source = await fetchEpisodeSource(sr.slug, ep);
      if (!source) break;
      seasonEps.push({
        episode_number: ep,
        season_number: sr.seasonNumber,
        title: `Episode ${ep}`,
        source_url: source.url,
        source_hash: source.hash,
      });
    }

    episodes.push(...seasonEps);
  }

  if (episodes.length === 0) return null;

  return {
    ...info,
    total_episodes: episodes.length,
    seasons,
    episodes,
  };
}

module.exports = { scrapeAnime };
