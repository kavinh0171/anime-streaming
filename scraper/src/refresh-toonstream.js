// Refreshes expired toonstream HLS URLs using the stored video hash
// For episodes with vhash in source_url: direct API call (no browser needed)
// For legacy episodes: falls back to Playwright navigation to extract hash

const supabase = require('../../database/config');
const logger = require('./logger');

const BASE = 'https://toonstream.vip';

function parseVhash(sourceUrl) {
  if (!sourceUrl) return null;
  const m = sourceUrl.match(/[?&]vhash=([a-f0-9]+)/i);
  return m ? m[1] : null;
}

function parseTreembedUrl(sourceUrl) {
  if (!sourceUrl) return null;
  // If it already has treembed param, it's a treembed URL
  if (sourceUrl.includes('?trembed=')) return sourceUrl;
  return null;
}

async function refreshViaApi(hash) {
  const apiUrl = `https://as-cdn21.top/player/index.php?data=${encodeURIComponent(hash)}&do=getVideo`;
  try {
    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Referer': `https://as-cdn21.top/video/${hash}`,
        'X-Requested-With': 'XMLHttpRequest',
        'User-Agent': 'Mozilla/5.0'
      },
      signal: AbortSignal.timeout(10000)
    });
    const text = await resp.text();
    const json = JSON.parse(text);
    return json.videoSource || json.securedLink || null;
  } catch (e) {
    logger.warn(`Refresh:   API error: ${e.message}`);
    return null;
  }
}

async function extractHashFromTreembed(treembedUrl, browser) {
  const page = await browser.newPage();
  try {
    await page.goto(treembedUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    const html = await page.content();
    const m = html.match(/<iframe[^>]*src="([^"]*as-cdn[^"]*)"[^>]*>/i);
    const hashUrl = m ? m[1] : null;
    if (!hashUrl) return null;
    const hash = hashUrl.split('/').pop();
    if (hash) return hash;
  } catch (e) {
    logger.warn(`Refresh:   Extract hash error: ${e.message}`);
  } finally {
    await page.close().catch(() => {});
  }
  return null;
}

async function refreshEpisode(episode, browser) {
  const { id, source_url, episode_number } = episode;
  logger.info(`Refresh: Ep ${episode_number} (${id.substring(0, 8)}...)`);

  // Try to get video hash from source_url first (new format with vhash param)
  let hash = parseVhash(source_url);

  // If no vhash, try extracting it from the treembed URL using browser
  if (!hash && browser) {
    const treembedUrl = parseTreembedUrl(source_url);
    if (treembedUrl) {
      logger.info(`Refresh:   Extracting hash from treembed page`);
      hash = await extractHashFromTreembed(treembedUrl, browser);
      // If we got the hash, update source_url to include it for next time
      if (hash) {
        const updatedUrl = treembedUrl + '&vhash=' + hash;
        try { await supabase.from('episodes').update({ source_url: updatedUrl }).eq('id', id); } catch (e) {}
      }
    }
  }

  if (!hash) {
    logger.warn(`Refresh:   No video hash found`);
    return null;
  }

  // Call API to get fresh HLS URL
  const hlsUrl = await refreshViaApi(hash);

  if (!hlsUrl) {
    logger.warn(`Refresh:   API returned no HLS URL`);
    return 0;
  }

  // Update DB
  try { await supabase.from('video_sources').delete().eq('episode_id', id).eq('source_type', 'hls'); } catch (e) {}
  try {
    await supabase.from('video_sources').insert({
      episode_id: id, source_url: hlsUrl, source_type: 'hls', quality: 'HD', language: 'sub',
    });
  } catch (e) {}
  logger.info(`Refresh:   OK`);
  return 1;
}

async function refreshAll(browser) {
  logger.info('=== ToonStream HLS URL Refresh ===');

  const { data: series } = await supabase
    .from('anime_series')
    .select('id, slug, title')
    .like('slug', 'ts-%');

  if (!series || series.length === 0) {
    logger.info('No toonstream series found');
    return 0;
  }

  logger.info(`Found ${series.length} series`);

  let total = 0;
  for (const s of series) {
    const { data: eps } = await supabase
      .from('episodes')
      .select('id, source_url, episode_number')
      .eq('anime_id', s.id)
      .order('episode_number');

    if (!eps || eps.length === 0) continue;

    logger.info(`\n${s.title} (${eps.length} eps)`);
    let ok = 0;

    for (const ep of eps) {
      const r = await refreshEpisode(ep, browser);
      if (r !== null) ok++;
      total += r || 0;
    }

    logger.info(`  ${ok}/${eps.length} done`);
  }

  logger.info(`\n=== Done: ${total} URLs refreshed ===`);
  return total;
}

module.exports = { refreshAll, refreshEpisode };

// Allow running standalone (with browser) or via API (browser = null for hash-only refresh)
async function main() {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  try {
    await refreshAll(browser);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  main().catch(err => {
    logger.error('Refresh failed:', err);
    process.exit(1);
  });
}