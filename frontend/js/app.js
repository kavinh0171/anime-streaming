const I = (id) => `<svg class="icon" aria-hidden="true"><use href="#${id}"/></svg>`;

const WatchHistory = {
  STORAGE_KEY: 'as_history',
  MAX_ITEMS: 50,

  getAll() {
    try {
      return JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '[]');
    } catch { return []; }
  },

  saveAll(items) {
    try { localStorage.setItem(this.STORAGE_KEY, JSON.stringify(items)); } catch {}
  },

  add({ slug, animeTitle, episodeId, episodeNumber, episodeTitle, seasonTitle, thumbnail, coverImage }) {
    let items = this.getAll();
    items = items.filter(i => i.episodeId !== episodeId);
    items.unshift({
      slug, animeTitle, episodeId, episodeNumber, episodeTitle, seasonTitle,
      thumbnail, coverImage, watchedAt: new Date().toISOString(),
    });
    if (items.length > this.MAX_ITEMS) items = items.slice(0, this.MAX_ITEMS);
    this.saveAll(items);
  },

  getRecent(limit = 10) {
    return this.getAll().slice(0, limit);
  },

  isWatched(episodeId) {
    return this.getAll().some(i => i.episodeId === episodeId);
  },

  getBySlug(slug) {
    return this.getAll().filter(i => i.slug === slug);
  },

  clear() {
    localStorage.removeItem(this.STORAGE_KEY);
  },
};

const App = {
  currentPage: 1,
  currentGenre: '',
  currentType: '',
  currentStatus: '',
  currentSort: 'updated_at.desc',
  searchTimeout: null,

  async init() {
    this.setupHeaderNav();
    this.setupSearch();
    this.setupRouter();
    this.renderPage();
  },

  setupHeaderNav() {
    const btn = document.querySelector('.mobile-menu-btn');
    const drawer = document.getElementById('nav-drawer');
    const overlay = document.getElementById('nav-overlay');
    const close = document.querySelector('.drawer-close');

    const closeDrawer = () => { drawer?.classList.remove('open'); overlay?.classList.remove('active'); document.body.style.overflow = ''; };
    const open = () => { drawer?.classList.add('open'); overlay?.classList.add('active'); document.body.style.overflow = 'hidden'; };

    if (btn) btn.addEventListener('click', open);
    if (close) close.addEventListener('click', closeDrawer);
    if (overlay) overlay.addEventListener('click', closeDrawer);

    // Close drawer on nav - drawer links already handle navigation via onclick
    document.querySelectorAll('.drawer-nav a').forEach(a => {
      a.addEventListener('click', (e) => {
        closeDrawer();
      });
    });
  },

  setupSearch() {
    const bar = document.getElementById('search-bar');
    const input = bar?.querySelector('input');
    const toggle = bar?.querySelector('.search-toggle');
    const close = bar?.querySelector('.search-close');
    const results = bar?.querySelector('.search-results');
    if (!bar || !input) return;

    const open = () => {
      bar.classList.remove('collapsed');
      bar.classList.add('expanded');
      document.querySelector('.header')?.classList.add('search-active');
      setTimeout(() => input.focus(), 200);
    };

    const header = document.querySelector('.header');

    const closeSearch = () => {
      const q = input.value.trim();
      input.value = '';
      results.classList.remove('active');
      // Collapse immediately after clearing results
      bar.classList.remove('expanded');
      bar.classList.add('collapsed');
      header?.classList.remove('search-active');
      input.blur();
      // Delay clearing HTML so transition isn't jarring
      setTimeout(() => { results.innerHTML = ''; }, 200);
      return q;
    };

    if (toggle) toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      open();
      results.innerHTML = '<div class="search-result-item" style="justify-content:center;color:var(--text-muted);font-size:0.85rem">Type to search anime...</div>';
      results.classList.add('active');
    });

    if (close) close.addEventListener('click', closeSearch);

    input.addEventListener('input', (e) => {
      clearTimeout(this.searchTimeout);
      if (bar.classList.contains('collapsed')) return;
      const q = e.target.value.trim();
      if (q.length < 2) { results.classList.remove('active'); results.innerHTML = ''; return; }
      this.searchTimeout = setTimeout(async () => {
        try {
          const data = await API.searchAnime(q);
          if (data.length === 0) {
            // No results — try fuzzy suggestions
            let html = `<div class="search-result-item" style="justify-content:center;color:var(--text-muted)">No results for "<strong>${q}</strong>"</div>`;
            // Try removing last word as a suggestion
            const words = q.split(' ');
            if (words.length > 1) {
              const shorter = words.slice(0, -1).join(' ');
              const fuzzy = await API.searchAnime(shorter);
              if (fuzzy.length > 0) {
                html += `<div class="search-result-item" style="justify-content:center;color:var(--text-muted);border-top:1px solid var(--border);font-size:0.8rem;padding:8px 16px">Did you mean "<strong>${shorter}</strong>"?</div>`;
                html += fuzzy.slice(0, 3).map(item => `
                  <a href="/watch/${item.slug}" class="search-result-item" onclick="event.preventDefault();App.navigate('/watch/${item.slug}')">
                    <img src="${item.thumbnail || ''}" alt="${item.title}" loading="lazy" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2256%22 fill=%22%232a2a3e%22><rect width=%2240%22 height=%2256%22/></svg>'">
                    <div class="info"><div class="title">${item.title}</div><div class="meta">${item.type || ''}</div></div>
                  </a>
                `).join('');
              }
            }
            results.innerHTML = html;
          } else {
            results.innerHTML = data.map(item => `
              <a href="/watch/${item.slug}" class="search-result-item" onclick="event.preventDefault();App.navigate('/watch/${item.slug}')">
                <img src="${item.thumbnail || ''}" alt="${item.title}" loading="lazy" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2256%22 fill=%22%232a2a3e%22><rect width=%2240%22 height=%2256%22/></svg>'">
                <div class="info">
                  <div class="title">${item.title}</div>
                  <div class="meta">${item.type} ${item.rating ? '· ' + item.rating : ''}</div>
                </div>
              </a>
            `).join('');
          }
          results.classList.add('active');
        } catch (err) { console.error('Search error:', err); }
      }, 300);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const q = input.value.trim();
        if (q) {
          const saved = closeSearch();
          this.navigate(`/browse?search=${encodeURIComponent(saved || q)}`);
        }
      }
      if (e.key === 'Escape') closeSearch();
    });
  },

  setupRouter() {
    window.addEventListener('popstate', () => this.renderPage());
    document.addEventListener('click', (e) => {
      const link = e.target.closest('a[href^="/"]');
      if (link && !link.getAttribute('target')) {
        e.preventDefault();
        this.navigate(link.getAttribute('href'));
      }
    });
  },

  navigate(path) {
    window.history.pushState({}, '', path);
    this.renderPage();
    window.scrollTo({ top: 0 });
  },

  async renderPage() {
    const path = window.location.pathname;
    const main = document.querySelector('main');
    if (!main) return;

    this.updateActiveNav(path);
    this.showLoading(main);

    try {
      if (path === '/' || path === '') {
        await this.renderHome(main);
      } else if (path === '/history') {
        await this.renderHistory(main);
      } else if (path.startsWith('/browse')) {
        await this.renderBrowse(main);
      } else if (path.startsWith('/watch/')) {
        const slug = path.replace('/watch/', '');
        await this.renderDetail(main, slug);
      } else if (path.startsWith('/player/')) {
        const parts = path.split('/');
        const animeSlug = parts[2];
        const epId = parts[3];
        if (animeSlug && epId) {
          await this.renderPlayer(main, animeSlug, epId);
        } else {
          this.renderNotFound(main);
        }
      } else {
        this.renderNotFound(main);
      }
    } catch (err) {
      console.error('Render error:', err);
      main.innerHTML = `<div class="empty-state"><span class="icon-lg">${I('icon-alert')}</span><h3>Something went wrong</h3><p>${err.message}</p></div>`;
    }

  },

  updateActiveNav(path) {
    const params = new URLSearchParams(window.location.search);
    const typeFilter = params.get('type') || '';
    document.querySelectorAll('.nav a, .drawer-nav a, .bottom-nav a').forEach(a => {
      const href = a.getAttribute('href');
      const isBottom = a.closest('.bottom-nav');
      if (isBottom) {
        const navType = a.dataset.nav;
        let active = false;
        if (navType === 'home') active = path === '/';
        else if (navType === 'history') active = path === '/history';
        else if (navType === 'browse') active = path.startsWith('/browse') && !typeFilter;
        else if (navType === 'series') active = typeFilter === 'series';
        else if (navType === 'movie') active = typeFilter === 'movie';
        a.classList.toggle('active', active);
      } else {
        a.classList.toggle('active', href === path || (href !== '/' && path.startsWith(href)));
      }
    });
  },

  showLoading(container) {
    container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  },

  async renderHome(main) {
    const [newAnime, trending, featured, latestEps, genres] = await Promise.all([
      API.getAnimeList({ limit: 12, sort: 'created_at.desc' }),
      API.getAnimeList({ limit: 12, sort: 'rating.desc' }),
      API.getFeatured(),
      API.getLatestEpisodes(12),
      API.getGenres(),
    ]);

    const heroItems = featured.length > 0 ? featured : trending.data.slice(0, 5);
    const continueWatching = WatchHistory.getRecent(8);

    const kidsGenre = genres.find(g => /kids|children|cartoon/i.test(g.name));
    let cartoonsData = [];
    if (kidsGenre) {
      cartoonsData = (await API.getAnimeList({ limit: 12, genre: kidsGenre.id, sort: 'updated_at.desc' })).data || [];
    }

    main.innerHTML = `
      <section class="hero" id="hero">
        ${heroItems.map((item, i) => `
          <div class="hero-slide ${i === 0 ? 'active' : ''}" data-index="${i}">
            <div class="bg" style="background-image: url('${item.cover_image || ''}')"></div>
            <div class="container">
              <div class="hero-content">
                <div class="hero-text">
                  <span class="tag">${item.type || 'Series'}</span>
                  <h1>${item.title}</h1>
                  <p class="synopsis">${item.description || 'No description available.'}</p>
                  <div class="meta">
                    ${item.rating ? `<span class="rating">${I('icon-star')} ${item.rating}</span>` : ''}
                    ${item.release_year ? `<span>${item.release_year}</span>` : ''}
                    ${item.status ? `<span>${item.status}</span>` : ''}
                    ${item.total_episodes ? `<span>${item.total_episodes} eps</span>` : ''}
                  </div>
                  <div class="actions">
                    <a href="/watch/${item.slug}" class="btn btn-primary" onclick="event.preventDefault();App.navigate('/watch/${item.slug}')">${I('icon-play')} Watch Now</a>
                    <a href="/watch/${item.slug}" class="btn btn-outline" onclick="event.preventDefault();App.navigate('/watch/${item.slug}')">${I('icon-chevron-right')} More Info</a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        `).join('')}
        <div class="container" style="position:relative;height:0">
          <div class="hero-dots">
            ${heroItems.map((_, i) => `<div class="dot ${i === 0 ? 'active' : ''}" data-index="${i}"></div>`).join('')}
          </div>
          <div class="hero-nav">
            <button class="hero-prev">${I('icon-chevron-left')}</button>
            <button class="hero-next">${I('icon-chevron-right')}</button>
          </div>
        </div>
      </section>

      <div class="container">
        ${continueWatching.length > 0 ? `
          <section class="section">
            <div class="section-header">
              <h2>${I('icon-history')} <span class="highlight">Continue</span> Watching</h2>
            </div>
            <div class="scroll-row">
              ${continueWatching.map(item => `
                <div class="history-card" onclick="event.preventDefault();App.navigate('/player/${item.slug}/${item.episodeId}')">
                  <div class="thumb">
                    <img src="${item.thumbnail || item.coverImage || ''}" alt="${item.animeTitle}" loading="lazy" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22120%22 fill=%22%232a2a3e%22><rect width=%22200%22 height=%22120%22/></svg>'">
                    <div class="play-overlay">${I('icon-play')}</div>
                    <div class="progress-bar"><div class="progress-fill" style="width:50%"></div></div>
                  </div>
                  <div class="info">
                    <div class="title">${item.animeTitle}</div>
                    <div class="meta">${item.seasonTitle || ''} ${item.episodeNumber ? 'Ep ' + item.episodeNumber : ''}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          </section>
        ` : ''}

        <section class="section">
          <div class="section-header">
            <h2>${I('icon-flame')} <span class="highlight">Trending</span> Now</h2>
            <a href="/browse?sort=rating.desc" class="view-all" onclick="event.preventDefault();App.navigate('/browse?sort=rating.desc')">View All ${I('icon-arrow-right')}</a>
          </div>
          <div class="anime-grid">
            ${trending.data.map(item => this.animeCardHTML(item)).join('')}
          </div>
        </section>

        <section class="section">
          <div class="section-header">
            <h2>${I('icon-clock')} <span class="highlight">New</span> Releases</h2>
            <a href="/browse" class="view-all" onclick="event.preventDefault();App.navigate('/browse')">View All ${I('icon-arrow-right')}</a>
          </div>
          <div class="anime-grid">
            ${newAnime.data.map(item => this.animeCardHTML(item)).join('')}
          </div>
        </section>

        ${cartoonsData.length > 0 ? `
        <section class="section">
          <div class="section-header">
            <h2>${I('icon-tv')} <span class="highlight">Cartoons</h2>
            <a href="/browse?genre=${kidsGenre.id}" class="view-all" onclick="event.preventDefault();App.navigate('/browse?genre=${kidsGenre.id}')">View All ${I('icon-arrow-right')}</a>
          </div>
          <div class="anime-grid">
            ${cartoonsData.map(item => this.animeCardHTML(item)).join('')}
          </div>
        </section>
        ` : ''}

        <section class="section">
          <div class="section-header">
            <h2>${I('icon-tv')} <span class="highlight">Latest</span> Episodes</h2>
          </div>
          <div class="episode-list">
            ${latestEps.slice(0, 10).map(ep => `
              <div class="episode-item" onclick="event.preventDefault();App.navigate('/player/${ep.anime_series?.slug || ''}/${ep.id}')">
                <div class="num">${ep.episode_number}</div>
                <div class="info">
                  <div class="title">${ep.anime_series?.title || 'Unknown'} - ${ep.title || `Episode ${ep.episode_number}`}</div>
                  <div class="meta">${ep.air_date ? new Date(ep.air_date).toLocaleDateString() : 'Recently added'}</div>
                </div>
                <div class="play-btn">${I('icon-play')}</div>
              </div>
            `).join('')}
          </div>
        </section>

        <section class="section">
          <div class="section-header">
            <h2>${I('icon-tag')} <span class="highlight">Browse</span> by Genre</h2>
          </div>
          <div class="genre-pills">
            ${genres.map(g => `<a href="/browse?genre=${g.id}" class="genre-pill" onclick="event.preventDefault();App.navigate('/browse?genre=${g.id}')">${g.name}</a>`).join('')}
          </div>
        </section>
      </div>

      <footer class="footer">
        <div class="container">
          <div class="footer-grid">
            <div class="footer-col">
              <div class="logo">Anime<span>Stream</span></div>
              <p style="margin-top:12px">Your ultimate destination for streaming anime. Watch the latest episodes and discover new series.</p>
            </div>
            <div class="footer-col">
              <h4>Browse</h4>
              <a href="/browse" onclick="event.preventDefault();App.navigate('/browse')">All Anime</a>
              <a href="/browse?type=series" onclick="event.preventDefault();App.navigate('/browse?type=series')">Series</a>
              <a href="/browse?type=movie" onclick="event.preventDefault();App.navigate('/browse?type=movie')">Movies</a>
            </div>
            <div class="footer-col">
              <h4>Genres</h4>
              ${genres.slice(0, 6).map(g => `<a href="/browse?genre=${g.id}" onclick="event.preventDefault();App.navigate('/browse?genre=${g.id}')">${g.name}</a>`).join('')}
            </div>
            <div class="footer-col">
              <h4>Support</h4>
              <a href="#">Contact</a>
              <a href="#">FAQ</a>
              <a href="#">Terms of Service</a>
            </div>
          </div>
          <div class="footer-bottom">&copy; ${new Date().getFullYear()} AnimeStream. All rights reserved.</div>
        </div>
      </footer>
    `;

    this.initHero();
  },

  async renderHistory(main) {
    const history = WatchHistory.getAll();

    main.innerHTML = `
      <div class="listing-header">
        <div class="container">
          <h1>${I('icon-history')} Watch History</h1>
          <p>${history.length} episodes watched</p>
          ${history.length > 0 ? '<button class="btn btn-outline" id="clear-history" style="margin-top:12px">' + I('icon-trash') + ' Clear History</button>' : ''}
        </div>
      </div>
      <div class="container">
        <section class="section">
          ${history.length === 0 ? `
            <div class="empty-state">
              ${I('icon-history')}
              <h3>No watch history</h3>
              <p>Start watching anime to build your history</p>
              <a href="/browse" class="btn btn-primary" style="margin-top:16px;display:inline-flex" onclick="event.preventDefault();App.navigate('/browse')">${I('icon-film')} Browse Anime</a>
            </div>
          ` : `
            <div class="history-list">
              ${history.map(item => `
                <div class="history-item" onclick="event.preventDefault();App.navigate('/player/${item.slug}/${item.episodeId}')">
                  <img src="${item.thumbnail || item.coverImage || ''}" alt="${item.animeTitle}" loading="lazy" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2290%22 height=%22126%22 fill=%22%232a2a3e%22><rect width=%2290%22 height=%22126%22/></svg>'">
                  <div class="info">
                    <div class="title">${item.animeTitle}</div>
                    <div class="sub">${item.seasonTitle ? item.seasonTitle + ' · ' : ''}Episode ${item.episodeNumber}${item.episodeTitle ? ' · ' + item.episodeTitle : ''}</div>
                    <div class="date">${new Date(item.watchedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                  </div>
                  <div class="play-btn">${I('icon-play')}</div>
                </div>
              `).join('')}
            </div>
          `}
        </section>
      </div>
    `;

    const clearBtn = document.getElementById('clear-history');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (confirm('Clear all watch history?')) {
          WatchHistory.clear();
          this.renderPage();
        }
      });
    }
  },

  initHero() {
    const slides = document.querySelectorAll('.hero-slide');
    const dots = document.querySelectorAll('.hero-dots .dot');
    const prevBtn = document.querySelector('.hero-prev');
    const nextBtn = document.querySelector('.hero-next');
    if (!slides.length) return;

    let current = 0;
    let interval = setInterval(() => this.showSlide(current + 1, slides, dots), 6000);

    const show = (idx) => {
      clearInterval(interval);
      this.showSlide(idx, slides, dots);
      current = idx;
      interval = setInterval(() => this.showSlide(current + 1, slides, dots), 6000);
    };

    if (prevBtn) prevBtn.addEventListener('click', () => show((current - 1 + slides.length) % slides.length));
    if (nextBtn) nextBtn.addEventListener('click', () => show((current + 1) % slides.length));
    dots.forEach(d => d.addEventListener('click', () => show(parseInt(d.dataset.index))));
  },

  showSlide(index, slides, dots) {
    const len = slides.length;
    const idx = ((index % len) + len) % len;
    slides.forEach((s, i) => s.classList.toggle('active', i === idx));
    dots.forEach((d, i) => d.classList.toggle('active', i === idx));
  },

  async renderBrowse(main) {
    const params = new URLSearchParams(window.location.search);
    this.currentGenre = params.get('genre') || '';
    this.currentType = params.get('type') || '';
    this.currentStatus = params.get('status') || '';
    this.currentSort = params.get('sort') || 'updated_at.desc';
    const search = params.get('search') || '';

    const [genres, result] = await Promise.all([
      API.getGenres(),
      API.getAnimeList({
        page: 1, limit: 30, type: this.currentType,
        status: this.currentStatus, genre: this.currentGenre, sort: this.currentSort, search,
      }),
    ]);

    const totalPages = Math.ceil((result.count || 0) / 30);
    const items = result.data || [];

    this.browsePage = 1;
    this.browseLoading = false;
    this.browseDone = false;

    const activeFilterCount = [this.currentType, this.currentGenre, this.currentStatus, this.currentSort !== 'updated_at.desc' ? this.currentSort : ''].filter(Boolean).length;

    const titleText = search ? `Search: "${search}"` : 'Browse Anime';

    main.innerHTML = `
      <div class="listing-header">
        <div class="container">
          <div style="display:flex;align-items:center;flex-wrap:wrap;gap:10px">
            <h1 style="margin-bottom:0">${titleText}</h1>
            <span style="color:var(--text-muted);font-size:0.9rem">${result.count || 0} titles</span>
            <button class="filter-btn" id="filter-toggle">
              ${I('icon-filter')}
              ${activeFilterCount > 0 ? `<span class="filter-badge">${activeFilterCount}</span>` : ''}
            </button>
          </div>
        </div>
      </div>
      <div class="filter-overlay" id="filter-overlay"></div>
      <div class="filter-panel" id="filter-panel">
        <div class="filter-panel-header">
          <h3>Filters</h3>
          <button class="filter-panel-close" id="filter-panel-close">${I('icon-x')}</button>
        </div>
        <div class="filter-panel-body">
          <div class="filter-group">
            <label>Type</label>
            ${this.customSelectHTML('filter-type', [
              { value: '', label: 'All' },
              { value: 'series', label: 'Series' },
              { value: 'movie', label: 'Movies' },
            ], this.currentType)}
          </div>
          <div class="filter-group">
            <label>Genre</label>
            ${this.customSelectHTML('filter-genre', [
              { value: '', label: 'All' },
              ...genres.map(g => ({ value: g.id, label: g.name })),
            ], this.currentGenre)}
          </div>
          <div class="filter-group">
            <label>Status</label>
            ${this.customSelectHTML('filter-status', [
              { value: '', label: 'All' },
              { value: 'ongoing', label: 'Ongoing' },
              { value: 'completed', label: 'Completed' },
            ], this.currentStatus)}
          </div>
          <div class="filter-group">
            <label>Sort</label>
            ${this.customSelectHTML('filter-sort', [
              { value: 'updated_at.desc', label: 'Latest' },
              { value: 'rating.desc', label: 'Highest Rated' },
              { value: 'title.asc', label: 'Title A-Z' },
              { value: 'release_year.desc', label: 'Newest' },
            ], this.currentSort)}
          </div>
        </div>
        <div class="filter-panel-footer">
          <button class="btn btn-outline" id="filter-reset">Reset</button>
          <button class="btn btn-primary" id="filter-apply">Apply</button>
        </div>
      </div>
      <div class="container">
        <section class="section">
          ${items.length === 0 ? `
            <div class="empty-state">
              ${I('icon-search')}
              <h3>No anime found</h3>
              <p>Try adjusting your filters or search terms</p>
            </div>
          ` : `
            <div class="anime-grid" id="browse-grid">
              ${items.map(item => this.animeCardHTML(item)).join('')}
            </div>
            <div id="browse-sentinel" style="height:1px"></div>
            <div id="browse-loader" class="loading" style="display:${totalPages > 1 ? 'flex' : 'none'}"><div class="spinner"></div></div>
          `}
        </section>
      </div>
    `;

    this.initCustomSelects();

    // Filter toggle
    const filterToggle = document.getElementById('filter-toggle');
    const filterPanel = document.getElementById('filter-panel');
    const filterOverlay = document.getElementById('filter-overlay');
    const filterClose = document.getElementById('filter-panel-close');

    const openFilter = () => {
      filterPanel?.classList.add('open');
      filterOverlay?.classList.add('active');
    };
    const closeFilter = () => {
      filterPanel?.classList.remove('open');
      filterOverlay?.classList.remove('active');
    };

    if (filterToggle) filterToggle.addEventListener('click', openFilter);
    if (filterClose) filterClose.addEventListener('click', closeFilter);
    if (filterOverlay) filterOverlay.addEventListener('click', closeFilter);

    document.getElementById('filter-apply')?.addEventListener('click', () => { closeFilter(); this.applyFilters(); });
    document.getElementById('filter-reset')?.addEventListener('click', () => {
      // Reset all custom selects to first option (All)
      document.querySelectorAll('.custom-select').forEach(c => {
        const first = c.querySelector('.custom-select-option');
        if (first) {
          c.querySelectorAll('.custom-select-option').forEach(o => o.classList.remove('selected'));
          first.classList.add('selected');
          c.querySelector('.custom-select-value').textContent = first.textContent;
          c.querySelector('.custom-select-value').classList.toggle('placeholder', first.dataset.value === '');
        }
      });
      this.applyFilters();
    });

    this.setupInfiniteScroll();
  },

  applyFilters() {
    const current = new URLSearchParams(window.location.search);
    const params = new URLSearchParams();
    const type = this.getCustomSelectValue('filter-type');
    const genre = this.getCustomSelectValue('filter-genre');
    const status = this.getCustomSelectValue('filter-status');
    const sort = this.getCustomSelectValue('filter-sort');
    const search = current.get('search');
    if (type) params.set('type', type);
    if (genre) params.set('genre', genre);
    if (status) params.set('status', status);
    if (sort) params.set('sort', sort);
    if (search) params.set('search', search);
    this.navigate(`/browse?${params.toString()}`);
  },

  initCustomSelects() {
    document.querySelectorAll('.custom-select').forEach(container => {
      const trigger = container.querySelector('.custom-select-trigger');
      const options = container.querySelector('.custom-select-options');
      const valueEl = container.querySelector('.custom-select-value');

      const closeOthers = () => {
        document.querySelectorAll('.custom-select-options.open').forEach(el => {
          if (el !== options) el.classList.remove('open');
        });
        document.querySelectorAll('.custom-select-trigger.open').forEach(el => {
          if (el !== trigger) el.classList.remove('open');
        });
      };

      trigger?.addEventListener('click', (e) => {
        e.stopPropagation();
        closeOthers();
        options?.classList.toggle('open');
        trigger?.classList.toggle('open');
      });

      options?.querySelectorAll('.custom-select-option').forEach(opt => {
        opt.addEventListener('click', () => {
          options.querySelectorAll('.custom-select-option').forEach(o => o.classList.remove('selected'));
          opt.classList.add('selected');
          valueEl.textContent = opt.textContent;
          valueEl.classList.toggle('placeholder', opt.dataset.value === '');
          options.classList.remove('open');
          trigger?.classList.remove('open');
        });
      });
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.custom-select')) {
        document.querySelectorAll('.custom-select-options.open').forEach(el => el.classList.remove('open'));
        document.querySelectorAll('.custom-select-trigger.open').forEach(el => el.classList.remove('open'));
      }
    });
  },

  getCustomSelectValue(id) {
    const container = document.querySelector(`[data-select-id="${id}"]`);
    if (!container) return '';
    const selected = container.querySelector('.custom-select-option.selected');
    return selected ? selected.dataset.value : '';
  },

  setupInfiniteScroll() {
    const sentinel = document.getElementById('browse-sentinel');
    if (!sentinel) return;
    this.browseDone = false;
    if (this._browseObserver) this._browseObserver.disconnect();
    this._browseObserver = new IntersectionObserver(async (entries) => {
      const entry = entries[0];
      if (entry.isIntersecting && !this.browseLoading && !this.browseDone) {
        this.browseLoading = true;
        document.getElementById('browse-loader').style.display = 'flex';
        this.browsePage++;
        const params = new URLSearchParams(window.location.search);
        const result = await API.getAnimeList({
          page: this.browsePage, limit: 30,
          type: this.currentType || undefined,
          status: this.currentStatus || undefined,
          genre: this.currentGenre || undefined,
          sort: this.currentSort || undefined,
          search: params.get('search') || undefined,
        });
        const items = result.data || [];
        const totalPages = Math.ceil((result.count || 0) / 30);
        const grid = document.getElementById('browse-grid');
        if (grid) grid.insertAdjacentHTML('beforeend', items.map(item => this.animeCardHTML(item)).join(''));
        this.browseLoading = false;
        document.getElementById('browse-loader').style.display = 'none';
        if (this.browsePage >= totalPages) {
          this.browseDone = true;
          sentinel.style.display = 'none';
        }
      }
    }, { rootMargin: '300px' });
    this._browseObserver.observe(sentinel);
  },

  goToPage(page) {
    const params = new URLSearchParams(window.location.search);
    params.set('page', page);
    this.navigate(`/browse?${params.toString()}`);
  },

  async renderDetail(main, slug) {
    const anime = await API.getAnimeBySlug(slug);
    if (!anime) { this.renderNotFound(main); return; }

    const seasons = anime.seasons || [];
    const allEpisodes = anime.episodes || [];
    const currentSeason = seasons.length > 0 ? seasons[0] : null;
    const seasonEpisodes = currentSeason
      ? allEpisodes.filter(e => e.season_id === currentSeason.id).sort((a, b) => a.episode_number - b.episode_number)
      : allEpisodes.sort((a, b) => a.episode_number - b.episode_number);

    const videoSource = seasonEpisodes[0]?.video_sources?.[0]?.source_url || seasonEpisodes[0]?.source_url || '';

    main.innerHTML = `
      <div class="detail-header">
        <div class="bg" style="background-image: url('${anime.cover_image || ''}')"></div>
        <div class="container">
          <div class="detail-content">
            <div class="poster">
              <img src="${anime.thumbnail || anime.cover_image || ''}" alt="${anime.title}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22220%22 height=%22330%22 fill=%22%232a2a3e%22><rect width=%22220%22 height=%22330%22/></svg>'">
            </div>
            <div class="info">
              <h1>${anime.title}</h1>
              <div class="meta-row">
                ${anime.rating ? `<span class="rating" style="color:var(--accent);font-weight:700">${I('icon-star')} ${anime.rating}</span>` : ''}
                <span class="tag ${anime.status}">${anime.status}</span>
                ${anime.type === 'movie' ? '<span class="tag movie">Movie</span>' : ''}
                ${anime.release_year ? `<span>${anime.release_year}</span>` : ''}
                ${anime.total_episodes ? `<span>${anime.total_episodes} Episodes</span>` : ''}
                ${anime.duration ? `<span>${anime.duration}</span>` : ''}
              </div>
              ${anime.genres?.length ? `
                <div class="genres">
                  ${anime.genres.map(g => `<a href="/browse?genre=${g.genre_id || g}" onclick="event.preventDefault();App.navigate('/browse?genre=${g.genre_id || g}')">${g.name || g}</a>`).join('')}
                </div>
              ` : ''}
              ${anime.description ? `<p class="description">${anime.description}</p>` : ''}
              <div class="actions" style="margin-top:16px">
                ${seasonEpisodes.length > 0 ? `<a href="/player/${slug}/${seasonEpisodes[0].id}" class="btn btn-primary" onclick="event.preventDefault();App.navigate('/player/${slug}/${seasonEpisodes[0].id}')">${I('icon-play')} Start Watching</a>` : ''}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="container">
        <div class="detail-body">
          <div class="main-content">
            ${seasons.length > 1 ? `
              <div class="season-tabs" id="season-tabs">
                ${seasons.sort((a, b) => a.season_number - b.season_number).map(s => `
                  <button class="season-tab ${s.id === currentSeason?.id ? 'active' : ''}" data-season-id="${s.id}">${s.title || `Season ${s.season_number}`}</button>
                `).join('')}
              </div>
              <div class="season-select">
                ${this.customSelectHTML('season-select', seasons.sort((a, b) => a.season_number - b.season_number).map(s => ({
                  value: s.id,
                  label: s.title || `Season ${s.season_number}`,
                })), currentSeason?.id)}
              </div>
            ` : ''}
            <div class="episode-list" id="episode-list">
              ${seasonEpisodes.map(ep => {
                const watched = WatchHistory.isWatched(ep.id);
                return `
                  <div class="episode-item ${ep.id === seasonEpisodes[0]?.id ? 'active' : ''} ${watched ? 'watched' : ''}" onclick="event.preventDefault();App.navigate('/player/${slug}/${ep.id}')">
                    <div class="num">${I('icon-play')}</div>
                    <div class="info">
                      <div class="title">${ep.title || `Episode ${ep.episode_number}`}</div>
                      <div class="meta">${ep.air_date ? new Date(ep.air_date).toLocaleDateString() : ''} ${ep.duration ? '· ' + ep.duration : ''}</div>
                    </div>
                    ${watched ? `<span class="watched-badge">${I('icon-check')}</span>` : ''}
                    <div class="play-btn">${I('icon-play')}</div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
          <div class="sidebar">
            <div class="sidebar-card">
              <h3>Information</h3>
              <div class="info-row"><span class="label">Type</span><span class="value">${anime.type || 'Series'}</span></div>
              <div class="info-row"><span class="label">Status</span><span class="value">${anime.status || 'Unknown'}</span></div>
              ${anime.release_year ? `<div class="info-row"><span class="label">Released</span><span class="value">${anime.release_year}</span></div>` : ''}
              ${anime.studio ? `<div class="info-row"><span class="label">Studio</span><span class="value">${anime.studio}</span></div>` : ''}
              <div class="info-row"><span class="label">Episodes</span><span class="value">${allEpisodes.length}</span></div>
              ${anime.duration ? `<div class="info-row"><span class="label">Duration</span><span class="value">${anime.duration}</span></div>` : ''}
              ${anime.rating ? `<div class="info-row"><span class="label">Rating</span><span class="value" style="color:var(--accent)">${I('icon-star')} ${anime.rating}</span></div>` : ''}
            </div>
          </div>
        </div>
      </div>
    `;

    this.initCustomSelects();
    const seasonTabs = document.querySelectorAll('.season-tab');
    const seasonCS = document.querySelector('[data-select-id="season-select"]');

    const updateSeasonCS = (seasonId) => {
      if (!seasonCS) return;
      seasonCS.querySelectorAll('.custom-select-option').forEach(o => o.classList.toggle('selected', o.dataset.value === seasonId));
      const valueEl = seasonCS.querySelector('.custom-select-value');
      const sel = seasonCS.querySelector('.custom-select-option.selected');
      if (valueEl && sel) valueEl.textContent = sel.textContent;
    };

    const switchSeason = (seasonId) => {
      seasonTabs.forEach(t => t.classList.toggle('active', t.dataset.seasonId === seasonId));
      updateSeasonCS(seasonId);
      const eps = allEpisodes.filter(e => e.season_id === seasonId).sort((a, b) => a.episode_number - b.episode_number);
      const list = document.getElementById('episode-list');
      if (list) {
        list.innerHTML = eps.map(ep => {
          const watched = WatchHistory.isWatched(ep.id);
          return `
            <div class="episode-item ${watched ? 'watched' : ''}" onclick="event.preventDefault();App.navigate('/player/${slug}/${ep.id}')">
              <div class="num">${I('icon-play')}</div>
              <div class="info">
                <div class="title">${ep.title || `Episode ${ep.episode_number}`}</div>
                <div class="meta">${ep.air_date ? new Date(ep.air_date).toLocaleDateString() : ''}</div>
              </div>
              ${watched ? `<span class="watched-badge">${I('icon-check')}</span>` : ''}
              <div class="play-btn">${I('icon-play')}</div>
            </div>
          `;
        }).join('');
      }
    };

    seasonTabs.forEach(tab => {
      tab.addEventListener('click', () => switchSeason(tab.dataset.seasonId));
    });
    if (seasonCS) {
      seasonCS.querySelectorAll('.custom-select-option').forEach(opt => {
        opt.addEventListener('click', () => switchSeason(opt.dataset.value));
      });
    }
  },

  async renderPlayer(main, slug, epId) {
    const anime = await API.getAnimeBySlug(slug);
    if (!anime) { this.renderNotFound(main); return; }

    const seasons = anime.seasons || [];
    const allEps = anime.episodes || [];

    const episode = allEps.find(e => e.id === epId);
    if (!episode) { this.renderNotFound(main); return; }

    // Find which season this episode belongs to
    const currentSeason = seasons.find(s => s.id === episode.season_id) || seasons[0] || null;
    const currentSeasonId = currentSeason?.id || episode.season_id;

    // Filter episodes to current season only
    const seasonEps = allEps
      .filter(e => e.season_id === currentSeasonId)
      .sort((a, b) => a.episode_number - b.episode_number);

    const currentIdx = seasonEps.findIndex(e => e.id === epId);
    const prevEp = currentIdx > 0 ? seasonEps[currentIdx - 1] : null;
    const nextEp = currentIdx < seasonEps.length - 1 ? seasonEps[currentIdx + 1] : null;

    let videoUrl = episode.video_sources?.[0]?.source_url || episode.source_url || '';

    WatchHistory.add({
      slug, animeTitle: anime.title, episodeId: epId,
      episodeNumber: episode.episode_number, episodeTitle: episode.title,
      seasonTitle: currentSeason?.title || '',
      thumbnail: anime.thumbnail || '',
      coverImage: anime.cover_image || '',
    });

    main.innerHTML = `
      <div class="player-page container">
        <div class="player-wrapper">
          ${videoUrl ? `
            <iframe src="${videoUrl}" allowfullscreen allow="autoplay; fullscreen" loading="lazy"></iframe>
          ` : `
            <div class="placeholder">
              ${I('icon-film')}
              <h3>No video source available</h3>
              <p>The video for this episode has not been loaded yet</p>
            </div>
          `}
        </div>
        <div class="player-info">
          <div class="left">
            <h1>${episode.title || `Episode ${episode.episode_number}`}</h1>
            <div class="meta">
              <a href="/watch/${slug}" onclick="event.preventDefault();App.navigate('/watch/${slug}')">${anime.title}</a>
              ${currentSeason ? `· ${currentSeason.title || `Season ${currentSeason.season_number}`}` : ''}
              ${episode.air_date ? `· ${new Date(episode.air_date).toLocaleDateString()}` : ''}
              ${episode.duration ? `· ${episode.duration}` : ''}
            </div>
          </div>
          <div class="right">
            ${prevEp ? `<button class="btn btn-outline" onclick="App.navigate('/player/${slug}/${prevEp.id}')">${I('icon-chevron-left')} Prev</button>` : ''}
            ${nextEp ? `<button class="btn btn-primary" onclick="App.navigate('/player/${slug}/${nextEp.id}')" style="margin-left:8px">Next ${I('icon-chevron-right')}</button>` : ''}
          </div>
        </div>
        <section class="section">
          <div class="section-header">
            <h2>${I('icon-tv')} <span class="highlight">Episodes</span></h2>
          </div>
          ${seasons.length > 1 ? `
            <div class="season-tabs" id="player-season-tabs">
              ${seasons.sort((a, b) => a.season_number - b.season_number).map(s => `
                <button class="season-tab ${s.id === currentSeasonId ? 'active' : ''}" data-season-id="${s.id}">${s.title || `Season ${s.season_number}`}</button>
              `).join('')}
            </div>
            <div class="season-select">
              ${this.customSelectHTML('player-season-select', seasons.sort((a, b) => a.season_number - b.season_number).map(s => ({
                value: s.id,
                label: s.title || `Season ${s.season_number}`,
              })), currentSeasonId)}
            </div>
          ` : ''}
          <div class="episode-list" id="player-episode-list">
            ${seasonEps.map(ep => {
              const watched = WatchHistory.isWatched(ep.id);
              return `
                <div class="episode-item ${ep.id === epId ? 'active' : ''} ${watched ? 'watched' : ''}" onclick="App.navigate('/player/${slug}/${ep.id}')">
                  <div class="num">${I('icon-play')}</div>
                  <div class="info">
                    <div class="title">${ep.title || `Episode ${ep.episode_number}`}</div>
                    <div class="meta">${ep.air_date ? new Date(ep.air_date).toLocaleDateString() : ''}</div>
                  </div>
                  ${watched ? `<span class="watched-badge">${I('icon-check')}</span>` : ''}
                  <div class="play-btn">${I('icon-play')}</div>
                </div>
              `;
            }).join('')}
          </div>
        </section>
      </div>
    `;

    // Season tab switching
    this.initCustomSelects();
    const seasonTabs = document.querySelectorAll('#player-season-tabs .season-tab');
    const playerSeasonCS = document.querySelector('[data-select-id="player-season-select"]');

    const updatePlayerSeasonCS = (sid) => {
      if (!playerSeasonCS) return;
      playerSeasonCS.querySelectorAll('.custom-select-option').forEach(o => o.classList.toggle('selected', o.dataset.value === sid));
      const valueEl = playerSeasonCS.querySelector('.custom-select-value');
      const sel = playerSeasonCS.querySelector('.custom-select-option.selected');
      if (valueEl && sel) valueEl.textContent = sel.textContent;
    };

    const switchPlayerSeason = (sid) => {
      seasonTabs.forEach(t => t.classList.toggle('active', t.dataset.seasonId === sid));
      updatePlayerSeasonCS(sid);
      const eps = allEps.filter(e => e.season_id === sid).sort((a, b) => a.episode_number - b.episode_number);
      const list = document.getElementById('player-episode-list');
      if (list) {
        list.innerHTML = eps.map(ep => {
          const watched = WatchHistory.isWatched(ep.id);
          return `
            <div class="episode-item ${watched ? 'watched' : ''}" onclick="App.navigate('/player/${slug}/${ep.id}')">
              <div class="num">${I('icon-play')}</div>
              <div class="info">
                <div class="title">${ep.title || `Episode ${ep.episode_number}`}</div>
                <div class="meta">${ep.air_date ? new Date(ep.air_date).toLocaleDateString() : ''}</div>
              </div>
              ${watched ? `<span class="watched-badge">${I('icon-check')}</span>` : ''}
              <div class="play-btn">${I('icon-play')}</div>
            </div>
          `;
        }).join('');
      }
    };

    seasonTabs.forEach(tab => {
      tab.addEventListener('click', () => switchPlayerSeason(tab.dataset.seasonId));
    });
    if (playerSeasonCS) {
      playerSeasonCS.querySelectorAll('.custom-select-option').forEach(opt => {
        opt.addEventListener('click', () => switchPlayerSeason(opt.dataset.value));
      });
    }
  },

  renderNotFound(main) {
    main.innerHTML = `
      <div class="container" style="padding-top:120px;text-align:center">
        <div class="empty-state">
          ${I('icon-search')}
          <h3>Page Not Found</h3>
          <p>The page you're looking for doesn't exist.</p>
          <a href="/" class="btn btn-primary" style="margin-top:16px;display:inline-flex" onclick="event.preventDefault();App.navigate('/')">${I('icon-tv')} Go Home</a>
        </div>
      </div>
    `;
  },

  customSelectHTML(id, options, currentValue) {
    const selected = options.find(o => o.value === currentValue) || options[0];
    return `
      <div class="custom-select" data-select-id="${id}">
        <button class="custom-select-trigger" type="button">
          <span class="custom-select-value ${selected.value === '' ? 'placeholder' : ''}">${selected.label}</span>
          <svg class="icon" aria-hidden="true"><use href="#icon-chevron-down"/></svg>
        </button>
        <div class="custom-select-options">
          ${options.map(o => `
            <div class="custom-select-option ${o.value === currentValue ? 'selected' : ''}" data-value="${o.value}">${o.label}</div>
          `).join('')}
        </div>
      </div>
    `;
  },

  animeCardHTML(item) {
    return `
      <div class="anime-card" onclick="event.preventDefault();App.navigate('/watch/${item.slug}')">
        <div class="thumb">
          <img src="${item.thumbnail || item.cover_image || ''}" alt="${item.title}" loading="lazy" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22300%22 height=%22400%22 fill=%22%232a2a3e%22><rect width=%22300%22 height=%22400%22/></svg>'">
          ${item.total_episodes ? `<span class="ep-count">${item.total_episodes} eps</span>` : ''}
          ${item.rating ? `<span class="rating-badge">${I('icon-star')} ${item.rating}</span>` : ''}
          <div class="overlay">${I('icon-play')} Play</div>
        </div>
        <div class="info">
          <h3>${item.title}</h3>
          <div class="meta-row">
            ${item.release_year ? `<span>${item.release_year}</span>` : ''}
            ${item.type ? `<span>${item.type}</span>` : ''}
          </div>
        </div>
      </div>
    `;
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
