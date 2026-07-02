const logger = require('./logger');
const db = require('./supabase');
const supabase = require('../../database/config');
const cheerio = require('cheerio');

const BASE = 'https://toonstream.vip';
const PARALLEL_ITEMS = 3;
const PARALLEL_EPISODES = 5;

function normalizeTitle(t) { return t.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim(); }

function fuzzyMatch(a, b) {
  const na = normalizeTitle(a), nb = normalizeTitle(b);
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  const longer = na.length >= nb.length ? na : nb;
  const shorter = na.length < nb.length ? na : nb;
  const maxDist = Math.floor(shorter.length * 0.3);
  for (let i = 0; i <= longer.length - shorter.length; i++) {
    let dist = 0;
    for (let j = 0; j < shorter.length; j++) if (longer[i + j] !== shorter[j]) dist++;
    if (dist <= maxDist) return true;
  }
  return false;
}

function hqImage(url) {
  if (!url) return '';
  return url.replace(/-\d+x\d+(?=\.[a-z]{3,4}$)/i, '').replace(/-scaled(?=\.[a-z]{3,4}$)/i, '');
}

const htmlCache = new Map();
async function fetchText(url) {
  if (htmlCache.has(url)) return htmlCache.get(url);
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'text/html' },
    signal: AbortSignal.timeout(10000)
  });
  const text = await r.text();
  htmlCache.set(url, text);
  return text;
}

// --- Series listing via fetch (no browser) ---
async function fetchSeriesList(pageNum = 1) {
  const url = `${BASE}/series/page/${pageNum}/`;
  logger.info(`Fetching series page ${pageNum}`);
  try {
    const html = await fetchText(url);
    const $ = cheerio.load(html);
    const items = [];
    $('li.series, article.post, .series').each((i, el) => {
      const title = $(el).find('.entry-title').text().trim();
      const rating = parseFloat($(el).find('.vote').text().replace(/[^0-9.]/g, '') || '0');
      const image = hqImage($(el).find('img').attr('src') || '');
      const href = $(el).find('.lnk-blk').attr('href') || $(el).find('a[href*="/series/"]').attr('href') || '';
      const slug = href.split('/').filter(Boolean).pop() || '';
      if (slug) items.push({ title, rating, image, slug, postId: $(el).attr('id')?.replace('post-', '') || '' });
    });
    // Deduplicate
    const seen = new Set();
    const unique = items.filter(i => { if (!i.slug || seen.has(i.slug)) return false; seen.add(i.slug); return true; });
    logger.info(`Page ${pageNum}: ${unique.length} items`);
    // Get total pages from pagination
    let totalPages = 1;
    $('.page-link, .pagination a, .page-numbers, a.page-link').each((i, el) => {
      const n = parseInt($(el).text());
      if (!isNaN(n) && n > totalPages) totalPages = n;
    });
    return { items: unique, totalPages };
  } catch (err) {
    logger.error(`fetchSeriesList page ${pageNum}: ${err.message}`);
    return { items: [], totalPages: 1 };
  }
}

// --- Extract video source from episode using fetch first, browser fallback ---
async function extractFromFetch(slug) {
  try {
    const $ = cheerio.load(await fetchText(`${BASE}/episode/${slug}/`));
    const embedSrc = $('#aa-options iframe[src], .video-player iframe[src], .aa-tb.hdd.on iframe[src], iframe:not([src=""])').first().attr('src')
      || $('iframe[src*="trembed"]').first().attr('src')
      || $('iframe[src*="toonstream"]').first().attr('src');
    if (!embedSrc) return null;
    const $$ = cheerio.load(await fetchText(embedSrc));
    const hashUrl = $$('.Video iframe[src*="as-cdn"], iframe[src*="as-cdn"]').first().attr('src');
    if (!hashUrl) return null;
    const hash = hashUrl.split('/').pop();
    return { embedSrc, hash };
  } catch { return null; }
}

async function extractFromBrowser(slug, context) {
  const page = await context.newPage();
  try {
    await page.goto(`${BASE}/episode/${slug}/`, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => page.waitForTimeout(2000));
    await page.waitForTimeout(800);
    const embedSrc = await page.evaluate(() => {
      const f = document.querySelector('iframe[src*="trembed"], iframe[src*="toonstream"], #aa-options iframe[src], .video-player iframe[src], iframe:not([src=""])');
      return f ? f.getAttribute('src') : null;
    }).catch(() => null);
    if (!embedSrc) return null;
    await page.goto(embedSrc, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => page.waitForTimeout(2000));
    await page.waitForTimeout(800);
    const hashUrl = await page.evaluate(() => {
      const f = document.querySelector('iframe[src*="as-cdn"], .Video iframe');
      return f ? f.getAttribute('src') : null;
    }).catch(() => null);
    if (!hashUrl) return null;
    const hash = hashUrl.split('/').pop();
    return { embedSrc, hash };
  } finally { await page.close().catch(() => {}); }
}

async function extractVideoSources(slug, context) {
  let result = await extractFromFetch(slug);
  if (!result && context) result = await extractFromBrowser(slug, context);
  if (!result) {
    logger.warn(`  No source for ${slug}`);
    return null;
  }
  const { embedSrc, hash } = result;
  const cdnUrl = `https://as-cdn21.top/player/index.php?data=${hash}`;
  const treembedUrl = embedSrc + '&vhash=' + hash;
  return { sources: [{ source_url: cdnUrl, source_type: 'embed', quality: 'HD', language: 'sub' }], treembedUrl };
}

// --- Fetch anime detail via fetch, browser fallback ---
async function fetchAnimeDetail(slug, context) {
  logger.info(`Detail: ${slug}`);
  try {
    const html = await fetchText(`${BASE}/series/${slug}/`);
    const $ = cheerio.load(html);
    const title = $('.entry-title').first().text().trim() || slug;
    let image = $('.post-thumbnail img').first().attr('src') || '';
    if (image) image = hqImage(image);
    if (!image) image = hqImage($('.entry-content img').first().attr('src') || '');
    const description = $('.description p').first().text().trim() || '';
    const yearText = $('.year').first().text().trim() || '';
    const year = parseInt(yearText.replace(/[^0-9]/g, '')) || null;
    const genres = [];
    $('.genres a').each((i, el) => { const t = $(el).text().trim(); if (t) genres.push(t); });

    const seasonBtns = $('.choose-season .aa-cnt li a');
    // Multi-season: episodes load dynamically via AJAX, need the browser
    if (seasonBtns.length > 0 && !$('#seasontemp-2').length) {
      return fetchAnimeDetailBrowser(slug, context);
    }
    // Single season or static multi-season: extract via cheerio
    const seasons = [];
    if (seasonBtns.length > 0) {
      seasonBtns.each((i, btn) => {
        const snum = parseInt($(btn).attr('data-season')) || 1;
        const postId = $(btn).attr('data-post') || '';
        const episodes = [];
        $(`#seasontemp-${snum} li`).each((j, li) => {
          const numText = $(li).find('.num-epi').text().trim();
          const parts = numText.split(/[xX]/);
          const href = $(li).find('.lnk-blk').attr('href') || $(li).find('a[href*="/episode/"]').attr('href') || '';
          const slug = href.split('/').filter(Boolean).pop() || '';
          if (!slug) return;
          const eNum = parseInt(parts[1]) || 0;
          episodes.push({ season: parseInt(parts[0]) || snum, number: eNum, title: $(li).find('.entry-title').text().trim() || `Episode ${eNum}`, thumbnail: hqImage($(li).find('img').attr('src') || ''), slug });
        });
        if (episodes.length > 0) { logger.info(`  S${snum}: ${episodes.length} eps`); seasons.push({ season_number: snum, postId, episodes }); }
      });
    } else {
      const episodes = [];
      $('#episode_by_temp li').each((j, li) => {
        const numText = $(li).find('.num-epi').text().trim();
        const parts = numText.split(/[xX]/);
        const href = $(li).find('.lnk-blk').attr('href') || $(li).find('a[href*="/episode/"]').attr('href') || '';
        const slug = href.split('/').filter(Boolean).pop() || '';
        if (!slug) return;
        const eNum = parseInt(parts[1]) || 0;
        episodes.push({ season: parseInt(parts[0]) || 1, number: eNum, title: $(li).find('.entry-title').text().trim() || `Episode ${eNum}`, thumbnail: hqImage($(li).find('img').attr('src') || ''), slug });
      });
      if (episodes.length > 0) { logger.info(`  ${episodes.length} eps`); seasons.push({ season_number: 1, postId: '', episodes }); }
    }
    return { title, slug, image, description, year, genres, seasons };
  } catch (err) {
    logger.warn(`fetchAnimeDetail fail: ${err.message}`);
    if (!context) return null;
    return fetchAnimeDetailBrowser(slug, context);
  }
}

async function fetchAnimeDetailBrowser(slug, context) {
  const page = await context.newPage();
  try {
    await page.goto(`${BASE}/series/${slug}/`, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => page.waitForTimeout(2000));
    await page.waitForTimeout(1000);
    const title = await page.$eval('.entry-title', el => el.textContent?.trim() || slug).catch(() => slug);
    let image = await page.$eval('.post-thumbnail img', el => el.getAttribute('src') || '').catch(() => '');
    if (image) image = hqImage(image);
    if (!image) image = await page.$eval('.entry-content img', el => el.getAttribute('src') || '').catch(() => '');
    if (image) image = hqImage(image);
    const description = await page.$eval('.description p', el => el.textContent?.trim() || '').catch(() => '');
    const yearText = await page.$eval('.year', el => el.textContent?.trim() || '').catch(() => '');
    const year = parseInt(yearText.replace(/[^0-9]/g, '')) || null;
    const genres = await page.$$eval('.genres a', els => els.map(e => e.textContent?.trim()).filter(Boolean)).catch(() => []);

    const extractEps = () => page.$$eval('#episode_by_temp li', lis => lis.map(li => {
      const n = li.querySelector('.num-epi')?.textContent?.trim() || '';
      const p = n.split(/[xX]/);
      const link = (li.querySelector('.lnk-blk')?.getAttribute('href') || li.querySelector('a[href*="/episode/"]')?.getAttribute('href') || '').split('/').filter(Boolean).pop() || '';
      const thumb = li.querySelector('img')?.getAttribute('src') || '';
      return { season: parseInt(p[0]) || 1, number: parseInt(p[1]) || 0, title: li.querySelector('.entry-title')?.textContent?.trim() || `Episode ${p[1]}`, thumbnail: hqImage(thumb), slug: link };
    })).catch(() => []);

    const seasonBtns = await page.$$('.choose-season .aa-cnt li a');
    const seasons = [];
    if (seasonBtns.length === 0) {
      const eps = await extractEps();
      if (eps.length > 0) seasons.push({ season_number: 1, postId: '', episodes: eps });
    } else {
      for (const btn of seasonBtns) {
        const snum = parseInt(await btn.getAttribute('data-season')) || 1;
        const postId = await btn.getAttribute('data-post') || '';
        await page.evaluate(n => { document.querySelectorAll('.choose-season .aa-cnt li a').forEach(a => { if (parseInt(a.getAttribute('data-season')) === n) a.click(); }); }, snum);
        await page.waitForTimeout(1000);
        const eps = await extractEps();
        if (eps.length > 0) seasons.push({ season_number: snum, postId, episodes: eps });
      }
    }
    return { title, slug, image, description, year, genres, seasons };
  } finally { await page.close().catch(() => {}); }
}

// --- Add video sources for a batch of episodes (parallel) ---
async function addVideoSourcesForEpisodes(episodeRecords, context) {
  const batch = episodeRecords.filter(e => e.slug);
  if (batch.length === 0) return;
  const ids = batch.map(e => e.id);
  try { await supabase.from('video_sources').delete().in('episode_id', ids); } catch {}

  for (let start = 0; start < batch.length; start += PARALLEL_EPISODES) {
    const subBatch = batch.slice(start, start + PARALLEL_EPISODES);
    const results = await Promise.allSettled(subBatch.map(e => extractVideoSources(e.slug, context)));
    const inserts = [];
    const updates = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status !== 'fulfilled' || !r.value) continue;
      const { sources, treembedUrl } = r.value;
      if (treembedUrl) updates.push({ id: subBatch[i].id, source_url: treembedUrl });
      for (const src of sources) inserts.push({ episode_id: subBatch[i].id, ...src });
    }
    if (updates.length > 0) {
      for (const u of updates) { try { await supabase.from('episodes').update({ source_url: u.source_url }).eq('id', u.id); } catch {} }
    }
    if (inserts.length > 0) {
      try { await supabase.from('video_sources').insert(inserts); } catch {}
    }
  }
}

async function checkExistingComplete(animeId) {
  const { data: eps } = await supabase.from('episodes').select('id').eq('anime_id', animeId).limit(1);
  if (!eps?.length) return false;
  const { data: vs } = await supabase.from('video_sources').select('id').in('episode_id', eps.map(e => e.id)).eq('source_type', 'embed').limit(1);
  return vs?.length > 0;
}

async function findExistingAnime(title) {
  const { data: exact } = await supabase.from('anime_series').select('id, title, slug, total_episodes').eq('title', title).limit(1);
  if (exact?.length) return exact[0];
  // Fetch once and match in memory
  const { data: all } = await supabase.from('anime_series').select('id, title, slug, total_episodes');
  return (all || []).find(a => fuzzyMatch(a.title, title)) || null;
}

async function processAnimeItem(item, context) {
  const existing = await findExistingAnime(item.title);
  if (existing) {
    if (!existing.slug?.startsWith('ts-')) { logger.info(`Skipping ${item.title} (toonplay)`); return null; }
    if (await checkExistingComplete(existing.id)) { return null; }
    logger.info(`Incomplete: ${item.title}`);
    const detail = await fetchAnimeDetail(item.slug, context);
    if (!detail?.title) return null;
    const totalFromStream = detail.seasons.reduce((s, sea) => s + sea.episodes.length, 0);
    if (totalFromStream <= (existing.total_episodes || 0)) {
      // Fill missing video sources
      for (const season of detail.seasons) {
        const { data: existingSeason } = await supabase.from('seasons').select('*').eq('anime_id', existing.id).eq('season_number', season.season_number).maybeSingle();
        if (!existingSeason) continue;
        const epRecords = [];
        for (const ep of season.episodes) {
          const { data: existingEp } = await supabase.from('episodes').select('id').eq('anime_id', existing.id).eq('season_id', existingSeason.id).eq('episode_number', ep.number).maybeSingle();
          if (!existingEp) continue;
          const { data: hasVs } = await supabase.from('video_sources').select('id').eq('episode_id', existingEp.id).limit(1);
          if (!hasVs?.length) epRecords.push({ id: existingEp.id, slug: ep.slug, number: ep.number });
        }
        if (epRecords.length > 0) { logger.info(`  Adding ${epRecords.length} missing sources for S${season.season_number}`); await addVideoSourcesForEpisodes(epRecords, context); }
      }
      return { id: existing.id, title: item.title, added: 'videos' };
    }
    logger.info(`Updating ${item.title}: ${existing.total_episodes} → ${totalFromStream} eps`);
    for (const season of detail.seasons) {
      let sr = await supabase.from('seasons').select('*').eq('anime_id', existing.id).eq('season_number', season.season_number).maybeSingle().then(r => r.data);
      if (!sr) sr = await db.upsertSeason({ anime_id: existing.id, season_number: season.season_number, title: `Season ${season.season_number}`, episode_count: season.episodes.length });
      if (!sr) continue;
      const newEpRecords = [];
      for (const ep of season.episodes) {
        const { data: existingEp } = await supabase.from('episodes').select('id').eq('anime_id', existing.id).eq('season_id', sr.id).eq('episode_number', ep.number).maybeSingle();
        if (existingEp) continue;
        const epRecord = await db.upsertEpisode({ anime_id: existing.id, season_id: sr.id, episode_number: ep.number, title: ep.title, thumbnail: ep.thumbnail, source_url: `${BASE}/episode/${ep.slug}/` });
        if (epRecord) newEpRecords.push({ ...epRecord, slug: ep.slug });
      }
      await supabase.from('seasons').update({ episode_count: season.episodes.length }).eq('id', sr.id);
      if (newEpRecords.length > 0) { logger.info(`  Fetching sources for ${newEpRecords.length} new eps`); await addVideoSourcesForEpisodes(newEpRecords, context); }
    }
    const newTotal = detail.seasons.reduce((s, sea) => s + sea.episodes.length, 0);
    await supabase.from('anime_series').update({ total_episodes: newTotal }).eq('id', existing.id);
    return { id: existing.id, title: item.title, added: 'episodes' };
  }

  logger.info(`New: ${item.title}`);
  const detail = await fetchAnimeDetail(item.slug, context);
  if (!detail?.title) return null;
  const totalEps = detail.seasons.reduce((s, sea) => s + sea.episodes.length, 0);
  const anime = await db.upsertAnime({
    title: detail.title, slug: `ts-${item.slug}`, description: detail.description || '',
    cover_image: detail.image || item.image || '', thumbnail: detail.image || item.image || '',
    rating: item.rating || 0, release_year: detail.year, status: 'ongoing', studio: '', type: 'series',
    total_episodes: totalEps, duration: '', source_url: `${BASE}/series/${item.slug}`,
  });
  if (!anime) return null;
  for (const g of detail.genres) {
    const genre = await db.upsertGenre(g);
    if (genre) try { await supabase.from('anime_genres').upsert({ anime_id: anime.id, genre_id: genre.id }, { onConflict: 'anime_id,genre_id' }); } catch {}
  }
  for (const season of detail.seasons) {
    const sr = await db.upsertSeason({ anime_id: anime.id, season_number: season.season_number, title: `Season ${season.season_number}`, episode_count: season.episodes.length });
    if (!sr) continue;
    const epRecords = [];
    for (const ep of season.episodes) {
      const epRecord = await db.upsertEpisode({ anime_id: anime.id, season_id: sr.id, episode_number: ep.number, title: ep.title, thumbnail: ep.thumbnail, source_url: `${BASE}/episode/${ep.slug}/` });
      if (epRecord) epRecords.push({ ...epRecord, slug: ep.slug });
    }
    if (epRecords.length > 0) await addVideoSourcesForEpisodes(epRecords, context);
  }
  return { id: anime.id, title: detail.title, added: 'new' };
}

// --- Progress display ---
let _progressState = { done: 0, total: 0, skipped: 0, addedCount: 0, startTime: 0 };
function clearLine() { process.stdout.write('\r\x1b[K'); }
function renderProgress() {
  const s = _progressState;
  const elapsed = Math.floor((Date.now() - s.startTime) / 1000);
  const m = Math.floor(elapsed / 60), sec = elapsed % 60;
  const timeStr = m > 0 ? `${m}m ${sec.toString().padStart(2, '0')}s` : `${sec}s`;
  const pct = s.total > 0 ? Math.min(100, Math.round((s.done / s.total) * 100)) : 0;
  const bar1 = '\u2588'.repeat(Math.floor(pct / 5));
  const bar2 = '\u2591'.repeat(20 - Math.floor(pct / 5));
  process.stdout.write(`\r  Items: [${s.done}/${s.total}]  ${bar1}${bar2}  ${pct}%  |  +${s.addedCount} new  |  ~${s.skipped} skip  |  ${timeStr}`);
}

function clearAndLog(msg) {
  clearLine();
  logger.info(msg);
  if (_progressState.total > 0) renderProgress();
}

async function fetchAllPages() {
  const first = await fetchSeriesList(1);
  const totalPages = first.totalPages || 1;
  let allItems = [...first.items];
  for (let p = 2; p <= totalPages; p++) {
    const { items } = await fetchSeriesList(p);
    allItems = allItems.concat(items);
    const pct = Math.round((p / totalPages) * 100);
    const bar1 = '\u2588'.repeat(Math.floor(pct / 5));
    const bar2 = '\u2591'.repeat(20 - Math.floor(pct / 5));
    process.stdout.write(`\r  Pages: [${p}/${totalPages}]  ${bar1}${bar2}  ${pct}%`);
  }
  clearLine();
  logger.info(`Fetched ${allItems.length} items from ${totalPages} pages`);
  return { items: allItems, totalPages };
}

async function processPool(items, processor, poolSize) {
  let idx = 0;
  const results = [];
  const state = _progressState;
  state.done = 0;
  state.total = items.length;
  state.skipped = 0;
  state.addedCount = 0;
  state.startTime = Date.now();

  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      const item = items[i];
      try {
        const r = await processor(item);
        if (r) { results.push(r); state.addedCount++; }
        else state.skipped++;
      } catch (err) { /* error logged by processor */ }
      state.done++;
      renderProgress();
    }
  }
  const workers = Array.from({ length: Math.min(poolSize, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function scrapeIncremental(context) {
  logger.info('=== Incremental (all pages) ===');
  const { items } = await fetchAllPages();
  const added = await processPool(items, item => processAnimeItem(item, context), PARALLEL_ITEMS);
  clearLine();
  const elapsed = Math.floor((Date.now() - _progressState.startTime) / 1000);
  const m = Math.floor(elapsed / 60), sec = elapsed % 60;
  logger.info(`Done: ${added.length} added, ${_progressState.skipped} skipped in ${m > 0 ? m + 'm ' : ''}${sec}s`);
  return added.length;
}

async function scrapeFull(context) {
  logger.info('=== Full scan (all pages) ===');
  const { items } = await fetchAllPages();
  const added = await processPool(items, item => processAnimeItem(item, context), PARALLEL_ITEMS);
  clearLine();
  const elapsed = Math.floor((Date.now() - _progressState.startTime) / 1000);
  const m = Math.floor(elapsed / 60), sec = elapsed % 60;
  logger.info(`Done: ${added.length} added, ${_progressState.skipped} skipped in ${m > 0 ? m + 'm ' : ''}${sec}s`);
  return added.length;
}

module.exports = { fetchSeriesList, fetchAnimeDetail, processAnimeItem, scrapeIncremental, scrapeFull };
