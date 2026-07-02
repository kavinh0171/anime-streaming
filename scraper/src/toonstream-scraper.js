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
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  return ctx.newPage();
}

async function fetchSeriesList(pageNum = 1, browser) {
  const url = `${BASE}/series/page/${pageNum}/`;
  logger.info(`ToonStream: Fetching series page ${pageNum}`);
  const page = await newPage(browser);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => page.waitForTimeout(3000));
    await page.waitForTimeout(2000);
    const items = await page.$$eval('li.series', (lis) => lis.map(li => ({
      title: li.querySelector('.entry-title')?.textContent?.trim() || '',
      rating: parseFloat(li.querySelector('.vote')?.textContent?.replace(/[^0-9.]/g, '') || '0'),
      image: li.querySelector('img')?.getAttribute('src') || '',
      slug: li.querySelector('.lnk-blk')?.getAttribute('href')?.split('/').filter(Boolean).pop() || '',
      postId: li.id?.replace('post-', '') || '',
    })));
    logger.info(`ToonStream: Page ${pageNum} — found ${items.length} items`);
    for (const item of items) {
      logger.info(`  - ${item.title} (rating: ${item.rating}) [${item.slug}]`);
    }
    const totalPages = await page.$$eval('.page-link', els => {
      const nums = els.map(e => parseInt(e.textContent)).filter(n => !isNaN(n));
      return nums.length > 0 ? Math.max(...nums) : 1;
    }).catch(() => 1);
    logger.info(`ToonStream: Page ${pageNum}/${totalPages}`);
    return { items, totalPages };
  } finally {
    await page.close();
  }
}

async function extractVideoSources(episodeSlug, browser) {
  const url = `${BASE}/episode/${episodeSlug}/`;
  logger.info(`ToonStream: Extracting video sources from ${episodeSlug}`);
  const sources = [];

  const page1 = await newPage(browser);
  try {
    await page1.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    await page1.waitForTimeout(2000);
    const embedSrc = await page1.$eval('iframe', el => el.getAttribute('src')).catch(() => null);
    if (!embedSrc) {
      logger.warn(`ToonStream: No iframe found on episode page ${episodeSlug}`);
      return [];
    }
    logger.info(`ToonStream: Embed iframe: ${embedSrc}`);

    // Try to extract direct video stream from within the embed
    const ctx2 = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page2 = await ctx2.newPage();
    const streamUrls = [];
    page2.on('response', async (response) => {
      const u = response.url();
      const headers = response.headers();
      const contentType = headers['content-type'] || '';
      
      const isVideo = u.includes('.m3u8') || u.includes('.mp4') || u.includes('.mkv') || u.includes('.webm') ||
                      contentType.includes('application/vnd.apple.mpegurl') ||
                      contentType.includes('application/x-mpegURL') ||
                      contentType.includes('video/');
                      
      if (isVideo) {
        if (!u.includes('google-analytics') && !u.includes('analytics') && !u.includes('doubleclick')) {
          if (!streamUrls.includes(u)) {
            streamUrls.push(u);
            logger.info(`ToonStream:   Captured stream: ${u} (Type: ${contentType})`);
          }
        }
      }
    });
    
    await page2.goto(embedSrc, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    await page2.waitForTimeout(8000);
    
    if (streamUrls.length === 0) {
      const html = await page2.content();
      const matches = html.match(/https?:[^"' \t\r\n]+\.(?:m3u8|mp4|mkv|webm)[^"' \t\r\n]*/gi) || [];
      for (const m of matches) {
        if (!streamUrls.includes(m)) streamUrls.push(m);
      }
    }
    await ctx2.close();
    
    // Add captured direct stream URLs to sources
    for (const m of streamUrls) {
      const isM3U8 = m.includes('.m3u8') || m.includes('mpegurl');
      sources.push({
        source_url: m,
        source_type: isM3U8 ? 'hls' : 'mp4',
        quality: 'HD',
        language: 'sub',
        order: sources.length
      });
    }
  } catch (err) {
    logger.warn(`ToonStream: Failed to extract video for ${episodeSlug}: ${err.message}`);
  } finally {
    await page1.close();
  }

  logger.info(`ToonStream: Got ${sources.length} direct source(s) for ${episodeSlug}`);
  return sources;
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
      const epLink = li.querySelector('.lnk-blk')?.getAttribute('href') || '';
      return {
        season: sNum,
        number: eNum,
        title: li.querySelector('.entry-title')?.textContent?.trim() || `Episode ${eNum}`,
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
  const batch = episodeRecords.filter(e => e.slug).slice(0, 5);
  if (batch.length === 0) return;
  // Remove old sources so player picks the fresh ones
  const ids = batch.map(e => e.id);
  try { await supabaseClient.from('video_sources').delete().in('episode_id', ids); } catch (e) {}
  const results = await Promise.allSettled(batch.map(e => extractVideoSources(e.slug, browser)));
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled' && r.value.length > 0) {
      for (const source of r.value) {
        try {
          await supabaseClient.from('video_sources').insert({
            episode_id: batch[i].id,
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
        const epRecord = await db.upsertEpisode({ anime_id: existing.id, season_id: seasonRecord.id, episode_number: ep.number, title: ep.title, thumbnail: ep.thumbnail });
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
      const epRecord = await db.upsertEpisode({ anime_id: anime.id, season_id: seasonRecord.id, episode_number: ep.number, title: ep.title, thumbnail: ep.thumbnail });
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
