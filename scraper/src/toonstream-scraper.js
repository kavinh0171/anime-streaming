const logger = require('./logger');
const db = require('./supabase');
const supabaseClient = require('../../database/config');

const BASE = 'https://toonstream.vip';

function normalizeTitle(title) {
  return title.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function fuzzyMatch(a, b) {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const longer = na.length >= nb.length ? na : nb;
  const shorter = na.length < nb.length ? na : nb;
  const maxDist = Math.floor(shorter.length * 0.3);
  for (let i = 0; i <= longer.length - shorter.length; i++) {
    let dist = 0;
    for (let j = 0; j < shorter.length; j++) {
      if (longer[i + j] !== shorter[j]) dist++;
    }
    if (dist <= maxDist) return true;
  }
  return false;
}

async function findExistingAnime(title) {
  const { data: exact } = await supabaseClient.from('anime_series').select('id, title, slug, total_episodes').eq('title', title).limit(1);
  if (exact && exact.length > 0) return exact[0];
  const words = title.toLowerCase().match(/[a-z0-9]+/g) || [];
  for (let len = 4; len >= 2; len--) {
    for (let i = 0; i <= words.length - len; i++) {
      const phrase = words.slice(i, i + len).join(' ');
      const { data } = await supabaseClient.from('anime_series').select('id, title, slug, total_episodes').ilike('title', `%${phrase}%`).limit(5);
      if (data) {
        for (const a of data) {
          if (fuzzyMatch(a.title, title)) return a;
        }
      }
    }
  }
  const { data: all } = await supabaseClient.from('anime_series').select('id, title, slug, total_episodes');
  if (all) {
    for (const a of all) {
      if (fuzzyMatch(a.title, title)) return a;
    }
  }
  return null;
}

async function newPage(browser) {
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  return ctx.newPage();
}

async function fetchSeriesList(pageNum = 1, browser) {
  const url = `${BASE}/series/page/${pageNum}/`;
  logger.info(`ToonStream: Fetching series page ${pageNum}`);
  const page = await newPage(browser);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => page.waitForTimeout(3000));
    await page.waitForSelector('li.series, article.post, .series', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1000);
    const items = await page.$$eval('li.series, article.post, .series', (els) => els.map(el => ({
      title: el.querySelector('.entry-title')?.textContent?.trim() || '',
      rating: parseFloat(el.querySelector('.vote')?.textContent?.replace(/[^0-9.]/g, '') || '0'),
      image: el.querySelector('img')?.getAttribute('src') || '',
      slug: (el.querySelector('.lnk-blk')?.getAttribute('href') || el.querySelector('a[href*="/series/"]')?.getAttribute('href') || '').split('/').filter(Boolean).pop() || '',
      postId: el.id?.replace('post-', '') || '',
    }))).catch(() => []);
    // Deduplicate by slug
    const seen = new Set();
    const unique = items.filter(i => { if (!i.slug || seen.has(i.slug)) return false; seen.add(i.slug); return true; });
    logger.info(`ToonStream: Page ${pageNum} — found ${unique.length} unique items (${items.length} raw)`);
    for (const item of unique) {
      logger.info(`  - ${item.title} (rating: ${item.rating}) [${item.slug}]`);
    }
    const totalPages = await page.evaluate(() => {
      const links = document.querySelectorAll('.page-link, .pagination a, .page-numbers, a.page-link');
      const nums = Array.from(links).map(e => parseInt(e.textContent)).filter(n => !isNaN(n));
      return nums.length > 0 ? Math.max(...nums) : 1;
    }).catch(() => 1);
    logger.info(`ToonStream: Page ${pageNum}/${totalPages}`);
    return { items: unique, totalPages };
  } catch (err) {
    logger.error(`ToonStream: fetchSeriesList page ${pageNum} error: ${err.message}`);
    return { items: [], totalPages: 1 };
  } finally {
    await page.close();
  }
}

async function extractVideoSources(episodeSlug, browser) {
  const url = `${BASE}/episode/${episodeSlug}/`;
  logger.info(`ToonStream: Extracting video sources from ${episodeSlug}`);
  const sources = [];
  let treembedUrl = null;

  const page = await newPage(browser);
  try {
    // Step 1: Get treembed URL from episode page
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const embedSrc = await page.evaluate(() => {
      const iframe = document.querySelector('#aa-options iframe[src], .video-player iframe[src], .aa-tb.hdd.on iframe[src], iframe:not([src=""])');
      return iframe ? iframe.getAttribute('src') : null;
    }).catch(() => null);

    if (!embedSrc) {
      logger.warn(`ToonStream: No iframe found on episode page ${episodeSlug}`);
      return { sources: [], treembedUrl: null };
    }
    logger.info(`ToonStream: Treembed URL: ${embedSrc}`);
    treembedUrl = embedSrc;

    // Step 2: Navigate to treembed page to extract video hash from its iframe
    await page.goto(embedSrc, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const videoHashUrl = await page.evaluate(() => {
      const iframe = document.querySelector('.Video iframe, iframe[src*="as-cdn"]');
      return iframe ? iframe.getAttribute('src') : null;
    }).catch(() => null);

    if (!videoHashUrl) {
      logger.warn(`ToonStream: No video iframe in treembed page for ${episodeSlug}`);
      return { sources: [], treembedUrl };
    }

    const videoHash = videoHashUrl.split('/').pop();
    logger.info(`ToonStream: Video hash: ${videoHash}`);

    // Append video hash to treembed URL for instant future refresh (no navigation needed)
    treembedUrl = embedSrc + '&vhash=' + videoHash;

    // Step 3: Call do=getVideo API directly (instant, no JWPlayer wait)
    const apiUrl = `https://as-cdn21.top/player/index.php?data=${videoHash}&do=getVideo`;
    const apiResponse = await page.request.fetch(apiUrl, {
      method: 'POST',
      headers: { 'Referer': videoHashUrl, 'X-Requested-With': 'XMLHttpRequest' }
    });
    const apiText = await apiResponse.text();
    let hlsUrl = null;

    try {
      const apiJson = JSON.parse(apiText);
      hlsUrl = apiJson.videoSource || apiJson.securedLink || null;
    } catch (e) {
      logger.warn(`ToonStream: Failed to parse API response for ${episodeSlug}: ${apiText.substring(0, 100)}`);
    }

    if (hlsUrl) {
      sources.push({
        source_url: hlsUrl,
        source_type: 'hls',
        quality: 'HD',
        language: 'sub',
        order: 0
      });
      logger.info(`ToonStream:   HLS: ${hlsUrl.substring(0, 120)}`);
    } else {
      logger.warn(`ToonStream: No HLS URL in API response for ${episodeSlug}`);
    }
  } catch (err) {
    logger.warn(`ToonStream: Failed to extract video for ${episodeSlug}: ${err.message}`);
  } finally {
    await page.close();
  }

  logger.info(`ToonStream: Got ${sources.length} HLS source(s) for ${episodeSlug}`);
  return { sources, treembedUrl };
}

async function fetchAnimeDetail(slug, browser) {
  const url = `${BASE}/series/${slug}/`;
  logger.info(`ToonStream: Fetching detail for ${slug}`);
  const page = await newPage(browser);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => page.waitForTimeout(3000));
    await page.waitForTimeout(2000);
    const title = await page.$eval('.entry-title', el => el.textContent?.trim() || '').catch(() => slug);
    const image = await page.$eval('.post-thumbnail img', el => el.getAttribute('src') || '').catch(() => '');
    const description = await page.$eval('.description p', el => el.textContent?.trim() || '').catch(() => '');
    const yearText = await page.$eval('.year', el => el.textContent?.trim() || '').catch(() => '');
    const year = parseInt(yearText.replace(/[^0-9]/g, '')) || null;
    const genres = await page.$$eval('.genres a', els => els.map(e => e.textContent?.trim()).filter(Boolean)).catch(() => []);
    logger.info(`ToonStream: Detail — "${title}" (${year}), ${genres.join(', ')}`);

    const extractEpisodes = () => page.$$eval('#episode_by_temp li', (lis) => lis.map(li => {
      const numText = li.querySelector('.num-epi')?.textContent?.trim() || '';
      const parts = numText.split(/[xX]/);
      const sNum = parseInt(parts[0]) || 1;
      const eNum = parseInt(parts[1]) || 0;
      const epLink = li.querySelector('.lnk-blk')?.getAttribute('href') ||
                     li.querySelector('a[href*="/episode/"]')?.getAttribute('href') ||
                     li.querySelector('a')?.getAttribute('href') || '';
      const epTitle = li.querySelector('.entry-title')?.textContent?.trim() || '';
      return {
        season: sNum,
        number: eNum,
        title: epTitle || `Episode ${eNum}`,
        thumbnail: li.querySelector('img')?.getAttribute('src') || '',
        slug: epLink.split('/').filter(Boolean).pop() || '',
      };
    })).catch(() => []);

    // Open season dropdown if present
    await page.evaluate(() => {
      const trigger = document.querySelector('.choose-season .dropdown-toggle, .choose-season button, .choose-season .current');
      if (trigger) trigger.click();
    }).catch(() => {});
    await page.waitForTimeout(500);

    const seasonButtons = await page.$$('.choose-season .aa-cnt li a');
    logger.info(`ToonStream: Found ${seasonButtons.length} season button(s)`);

    const seasons = [];

    if (seasonButtons.length === 0) {
      const episodes = await extractEpisodes();
      logger.info(`ToonStream: ${episodes.length} episodes found (no season selector)`);
      if (episodes.length > 0) {
        for (const ep of episodes) logger.info(`  S${ep.season}E${ep.number}: ${ep.title}`);
        seasons.push({ season_number: 1, postId: '', episodes });
      }
    } else {
      for (const btn of seasonButtons) {
        const seasonNum = parseInt(await btn.getAttribute('data-season')) || 1;
        const postId = await btn.getAttribute('data-post') || '';
        logger.info(`ToonStream: Clicking season ${seasonNum} (postId: ${postId})`);

        // Use evaluate to click programmatically (bypasses visibility checks)
        await page.evaluate((num) => {
          const links = document.querySelectorAll('.choose-season .aa-cnt li a');
          for (const link of links) {
            if (parseInt(link.getAttribute('data-season')) === num) {
              link.click();
              return;
            }
          }
        }, seasonNum);
        await page.waitForTimeout(2000);

        const episodes = await extractEpisodes();
        logger.info(`ToonStream: Season ${seasonNum} — ${episodes.length} episodes`);
        for (const ep of episodes) logger.info(`  S${ep.season}E${ep.number}: ${ep.title}`);
        seasons.push({ season_number: seasonNum, postId, episodes });
      }
    }
    return { title, slug, image, description, year, genres, seasons };
  } finally {
    await page.close();
  }
}

async function addVideoSourcesForEpisodes(episodeRecords, browser) {
  const batch = episodeRecords.filter(e => e.slug);
  if (batch.length === 0) return;
  // Remove old sources so player picks the fresh ones
  const ids = batch.map(e => e.id);
  try { await supabaseClient.from('video_sources').delete().in('episode_id', ids); } catch (e) {}
  // Process in batches of 3 to avoid overwhelming the browser
  for (let start = 0; start < batch.length; start += 3) {
    const subBatch = batch.slice(start, start + 3);
    const results = await Promise.allSettled(subBatch.map(e => extractVideoSources(e.slug, browser)));
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'fulfilled') {
        const { sources, treembedUrl } = r.value;
        // Store the treembed URL on the episode for future refresh capability
        if (treembedUrl) {
          try {
            await supabaseClient.from('episodes').update({ source_url: treembedUrl }).eq('id', subBatch[i].id);
          } catch (e) {}
        }
        // Insert HLS video sources
        for (const source of sources) {
          try {
            await supabaseClient.from('video_sources').insert({
              episode_id: subBatch[i].id,
              source_url: source.source_url,
              source_type: source.source_type,
              quality: 'HD',
              language: 'sub',
            });
          } catch {}
        }
      }
    }
  }
}

async function checkExistingComplete(animeId) {
  const { data: eps } = await supabaseClient.from('episodes').select('id').eq('anime_id', animeId).limit(1);
  if (!eps || eps.length === 0) return false;
  const epIds = eps.map(e => e.id);
  const { data: vs, error } = await supabaseClient.from('video_sources').select('id').in('episode_id', epIds).eq('source_type', 'hls').limit(1);
  if (error) return false;
  return vs && vs.length > 0;
}

async function processAnimeItem(item, browser) {
  const existing = await findExistingAnime(item.title);
  if (existing) {
    // Never touch toonplay items — they have their own embed sources
    if (!existing.slug || !existing.slug.startsWith('ts-')) {
      logger.info(`ToonStream: "${item.title}" — belongs to toonplay (slug="${existing.slug}"), skipping`);
      return null;
    }
    const complete = await checkExistingComplete(existing.id);
    if (complete) {
      logger.info(`ToonStream: "${item.title}" — already complete (${existing.total_episodes} eps w/ HLS), skipping`);
      return null;
    }
    logger.info(`ToonStream: "${item.title}" — exists but incomplete, checking detail page`);
    const detail = await fetchAnimeDetail(item.slug, browser);
    if (!detail || !detail.title) {
      logger.warn(`ToonStream: Failed to get detail for ${item.title}`);
      return null;
    }
    const totalFromStream = detail.seasons.reduce((s, sea) => s + sea.episodes.length, 0);
    if (totalFromStream <= (existing.total_episodes || 0)) {
      logger.info(`ToonStream: "${item.title}" — episode count same (${existing.total_episodes}), scraping missing video sources`);
      for (const season of detail.seasons) {
        const { data: existingSeason } = await supabaseClient.from('seasons').select('*').eq('anime_id', existing.id).eq('season_number', season.season_number).maybeSingle();
        if (!existingSeason) continue;
        const epRecords = [];
        for (const ep of season.episodes) {
          const { data: existingEp } = await supabaseClient.from('episodes').select('id').eq('anime_id', existing.id).eq('season_id', existingSeason.id).eq('episode_number', ep.number).maybeSingle();
          if (!existingEp) continue;
          const { data: hasVs } = await supabaseClient.from('video_sources').select('id').eq('episode_id', existingEp.id).limit(1);
          if (!hasVs || hasVs.length === 0) {
            epRecords.push({ id: existingEp.id, slug: ep.slug, number: ep.number });
          }
        }
        if (epRecords.length > 0) {
          logger.info(`ToonStream:  Adding ${epRecords.length} missing video source(s) for season ${season.season_number}`);
          await addVideoSourcesForEpisodes(epRecords, browser);
        }
      }
      return { id: existing.id, title: item.title, added: 'videos' };
    }
    logger.info(`ToonStream: "${item.title}" — ${existing.total_episodes} → ${totalFromStream} episodes, adding new ones`);
    for (const season of detail.seasons) {
      let seasonRecord = null;
      const { data: existingSeason } = await supabaseClient.from('seasons').select('*').eq('anime_id', existing.id).eq('season_number', season.season_number).maybeSingle();
      if (existingSeason) {
        seasonRecord = existingSeason;
      } else {
        seasonRecord = await db.upsertSeason({ anime_id: existing.id, season_number: season.season_number, title: `Season ${season.season_number}`, episode_count: season.episodes.length });
        if (seasonRecord) logger.info(`ToonStream: Created season ${season.season_number} (ID: ${seasonRecord.id})`);
      }
      if (!seasonRecord) continue;
      const newEpisodeRecords = [];
      for (const ep of season.episodes) {
        const { data: existingEp } = await supabaseClient.from('episodes').select('id').eq('anime_id', existing.id).eq('season_id', seasonRecord.id).eq('episode_number', ep.number).maybeSingle();
        if (existingEp) continue;
        const epRecord = await db.upsertEpisode({ anime_id: existing.id, season_id: seasonRecord.id, episode_number: ep.number, title: ep.title, thumbnail: ep.thumbnail, source_url: `${BASE}/episode/${ep.slug}/` });
        if (epRecord) {
          logger.info(`ToonStream:  + Added episode S${ep.season}E${ep.number}: ${ep.title}`);
          newEpisodeRecords.push({ ...epRecord, slug: ep.slug });
        }
      }
      await supabaseClient.from('seasons').update({ episode_count: season.episodes.length }).eq('id', seasonRecord.id);
      if (newEpisodeRecords.length > 0) {
        logger.info(`ToonStream: Fetching video sources for ${newEpisodeRecords.length} new episode(s)`);
        await addVideoSourcesForEpisodes(newEpisodeRecords, browser);
      }
    }
    const newTotal = detail.seasons.reduce((s, sea) => s + sea.episodes.length, 0);
    await supabaseClient.from('anime_series').update({ total_episodes: newTotal }).eq('id', existing.id);
    logger.info(`ToonStream: "${item.title}" — updated to ${newTotal} episodes`);
    return { id: existing.id, title: item.title, added: 'episodes' };
  }

  logger.info(`ToonStream: "${item.title}" — NOT found in DB, scraping fully`);
  const detail = await fetchAnimeDetail(item.slug, browser);
  if (!detail || !detail.title) {
    logger.warn(`ToonStream: Failed to get detail for ${item.title}`);
    return null;
  }
  const totalEps = detail.seasons.reduce((s, sea) => s + sea.episodes.length, 0);
  const id = `ts-${item.slug}`;
  const animeRecord = {
    title: detail.title, slug: id, description: detail.description || '',
    cover_image: detail.image || item.image || '',
    thumbnail: detail.image || item.image || '',
    rating: item.rating || 0, release_year: detail.year,
    status: 'ongoing', studio: '', type: 'series',
    total_episodes: totalEps, duration: '',
    source_url: `${BASE}/series/${item.slug}`,
  };
  logger.info(`ToonStream: Inserting new anime "${detail.title}" (${totalEps} eps, ${detail.year})`);
  const anime = await db.upsertAnime(animeRecord);
  if (!anime) { logger.warn(`ToonStream: Failed to insert "${detail.title}"`); return null; }
  logger.info(`ToonStream: Created anime ID=${anime.id} with slug="${id}"`);
  for (const genreName of detail.genres) {
    const genre = await db.upsertGenre(genreName);
    if (genre) {
      try { await supabaseClient.from('anime_genres').upsert({ anime_id: anime.id, genre_id: genre.id }, { onConflict: 'anime_id,genre_id' }); } catch {}
    }
  }
  for (const season of detail.seasons) {
    const seasonRecord = await db.upsertSeason({ anime_id: anime.id, season_number: season.season_number, title: `Season ${season.season_number}`, episode_count: season.episodes.length });
    if (!seasonRecord) continue;
    logger.info(`ToonStream:  Season ${season.season_number} (ID: ${seasonRecord.id})`);
    const episodeRecords = [];
    for (const ep of season.episodes) {
      const epRecord = await db.upsertEpisode({ anime_id: anime.id, season_id: seasonRecord.id, episode_number: ep.number, title: ep.title, thumbnail: ep.thumbnail, source_url: `${BASE}/episode/${ep.slug}/` });
      if (epRecord) {
        logger.info(`ToonStream:    E${ep.number}: ${ep.title}`);
        episodeRecords.push({ ...epRecord, slug: ep.slug });
      }
    }
    if (episodeRecords.length > 0) {
      logger.info(`ToonStream:  Fetching video sources for ${episodeRecords.length} episode(s)`);
      await addVideoSourcesForEpisodes(episodeRecords, browser);
    }
  }
  logger.info(`ToonStream: Finished scraping "${detail.title}"`);
  return { id: anime.id, title: detail.title, added: 'new' };
}

async function scrapeIncremental(browser) {
  logger.info('=== ToonStream incremental check (page 1 only) ===');
  const page1 = await fetchSeriesList(1, browser);
  const items = page1.items || [];
  logger.info(`ToonStream: Found ${items.length} items on page 1`);
  let added = 0;
  for (const item of items) {
    try {
      const result = await processAnimeItem(item, browser);
      if (result) added++;
    } catch (err) {
      logger.error(`ToonStream: Failed ${item.title}: ${err.message}`);
    }
  }
  logger.info(`ToonStream: Added/updated ${added} items`);
  return added;
}

async function scrapeFull(browser) {
  logger.info('=== ToonStream full scan (all pages) ===');
  const firstPage = await fetchSeriesList(1, browser);
  const totalPages = firstPage.totalPages || 1;
  let allItems = firstPage.items || [];
  logger.info(`ToonStream: ${totalPages} total pages, ${allItems.length} items on page 1`);

  for (let p = 2; p <= totalPages; p++) {
    try {
      const page = await fetchSeriesList(p, browser);
      if (!page.items || page.items.length === 0) break;
      allItems = allItems.concat(page.items);
      logger.info(`ToonStream: Page ${p}/${totalPages} done — ${allItems.length} total items so far`);
    } catch (err) {
      logger.error(`ToonStream: Page ${p} failed: ${err.message}`);
    }
  }

  logger.info(`=== Processing ${allItems.length} items against database ===`);
  let added = 0;
  let idx = 0;
  for (const item of allItems) {
    idx++;
    logger.info(`\n[${idx}/${allItems.length}] ${item.title}`);
    try {
      const result = await processAnimeItem(item, browser);
      if (result) added++;
    } catch (err) {
      logger.error(`[${idx}] Failed: ${item.title} — ${err.message}`);
    }
  }
  logger.info(`\n=== ToonStream full scan complete: ${added} added/updated ===`);
  return added;
}

module.exports = { fetchSeriesList, fetchAnimeDetail, processAnimeItem, scrapeIncremental, scrapeFull };
