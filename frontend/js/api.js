const API = (() => {
  const SUPABASE_URL = window.__SUPABASE_URL__ || 'https://your-project.supabase.co';
  const SUPABASE_KEY = window.__SUPABASE_ANON_KEY__ || 'your-anon-key';

  async function request(path, options = {}) {
    const url = `${SUPABASE_URL}/rest/v1/${path}`;
    const headers = {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (options.prefer) {
      headers['Prefer'] = options.prefer;
    }

    const response = await fetch(url, { ...options, headers });
    if (!response.ok) throw new Error(`API error: ${response.status} ${response.statusText}`);
    return response.json();
  }

  function buildQuery(path, params = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        query.append(key, value);
      }
    });
    const qs = query.toString();
    return qs ? `${path}?${qs}` : path;
  }

  return {
    // Anime series
    async getAnimeList({ page = 1, limit = 20, type, status, genre, sort = 'updated_at.desc', search } = {}) {
      const params = {
        select: '*',
        limit,
        offset: (page - 1) * limit,
        order: sort,
      };
      if (type) params.type = `eq.${type}`;
      if (status) params.status = `eq.${status}`;
      if (search) params.title = `ilike.*${search}*`;

      let path = buildQuery('anime_series', params);
      if (genre) {
        const genrePath = buildQuery('anime_genres', {
          select: 'anime_id',
          'genre_id': `eq.${genre}`,
          limit: 1000,
        });
        const genreData = await request(genrePath);
        const ids = genreData.map(g => g.anime_id);
        if (ids.length > 0) {
          path += `&id=in.(${ids.join(',')})`;
        } else {
          return { data: [], count: 0 };
        }
      }

      const url = `${SUPABASE_URL}/rest/v1/${path}`;
      const headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'count=exact',
      };
      const response = await fetch(url, { headers });
      if (!response.ok) throw new Error(`API error: ${response.status}`);
      const data = await response.json();
      const range = response.headers.get('content-range');
      const count = range ? parseInt(range.split('/')[1]) : data.length;
      return { data, count };
    },

    async getAnimeBySlug(slug) {
      const data = await request(buildQuery('anime_series', {
        select: '*,seasons(*),episodes(*,video_sources(*)),anime_genres(*)',
        slug: `eq.${slug}`,
        limit: 1,
      }));
      const anime = data[0] || null;
      if (anime && anime.anime_genres) {
        const genres = await this.getGenres();
        const genreMap = {};
        genres.forEach(g => { genreMap[g.id] = g.name; });
        anime.anime_genres = anime.anime_genres.map(ag => ({
          ...ag,
          name: genreMap[ag.genre_id] || '',
        }));
      }
      return anime;
    },

    async getAnimeById(id) {
      const data = await request(buildQuery('anime_series', {
        select: '*,seasons(*),episodes(*,video_sources(*)),anime_genres(genre_id)',
        id: `eq.${id}`,
        limit: 1,
      }));
      return data[0] || null;
    },

    async getFeatured() {
      const featured = await request(buildQuery('featured_anime', {
        select: 'anime_series(*)',
        is_active: 'eq.true',
        order: 'display_order.asc',
      }));
      return featured.map(f => f.anime_series).filter(Boolean);
    },

    async getLatestEpisodes(limit = 20) {
      return request(buildQuery('episodes', {
        select: '*,anime_series!inner(title,slug,cover_image)',
        order: 'created_at.desc',
        limit,
      }));
    },

    // Genres
    async getGenres() {
      return request(buildQuery('genres', { select: '*', order: 'name.asc' }));
    },

    // Search
    async searchAnime(query, limit = 10) {
      if (!query || query.length < 2) return [];
      return request(buildQuery('anime_series', {
        select: '*',
        title: `ilike.*${query}*`,
        limit,
        order: 'rating.desc',
      }));
    },
  };
})();
