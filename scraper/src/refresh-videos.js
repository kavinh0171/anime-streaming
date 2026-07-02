require('dotenv').config();
const supabase = require('../../database/config');
const { chromium } = require('playwright');
const logger = require('./logger');

async function refreshVideoSources() {
  const { data: animeList } = await supabase
    .from('anime_series')
    .select('id, title, slug')
    .order('created_at', { ascending: false });

  logger.info(`Refreshing video sources for ${animeList?.length || 0} anime`);

  for (const anime of animeList || []) {
    logger.info(`Processing: ${anime.title} (${anime.slug})`);

    const { data: seasons } = await supabase
      .from('seasons')
      .select('id, season_number')
      .eq('anime_id', anime.id)
      .order('season_number');

    for (const season of seasons || []) {
      const { data: episodes } = await supabase
        .from('episodes')
        .select('id, episode_number, source_url')
        .eq('season_id', season.id)
        .order('episode_number');

      for (const ep of episodes || []) {
        // Check if already has video source
        const { data: existing } = await supabase
          .from('video_sources')
          .select('id')
          .eq('episode_id', ep.id)
          .limit(1);

        if (existing && existing.length > 0) {
          logger.info(`  S${season.season_number}E${ep.episode_number}: already has video source`);
          continue;
        }

        // Extract episode ID from source_url
        // source_url is like "https://toonplay.in/episode/witch-hat-atelier-1x1"
        const epPath = ep.source_url?.replace('https://toonplay.in/', '');
        if (!epPath) continue;

        const animesaltUrl = `https://animesalt.ac/${epPath.replace('episode/', 'episode/')}`;

        try {
          const browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
          });
          const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          });
          await context.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
          });
          const page = await context.newPage();

          let videoUrl = null;
          page.on('response', async (r) => {
            if (r.url().includes('/api/extract')) {
              try {
                const json = await r.json();
                if (json.success && json.data?.videoPlayerUrl) videoUrl = json.data.videoPlayerUrl;
              } catch (e) {}
            }
          });

          // Navigate to the extract URL via the watch page
          const watchSlug = anime.slug;
          await page.goto(`https://toonplay.in/watch/${watchSlug}`, {
            waitUntil: 'domcontentloaded', timeout: 30000,
          });
          await page.waitForTimeout(4000);

          if (videoUrl) {
            await supabase.from('video_sources').insert({
              episode_id: ep.id,
              source_url: videoUrl,
              source_type: 'embed',
              quality: 'HD',
              language: 'sub',
            });
            logger.info(`  S${season.season_number}E${ep.episode_number}: ✓ ${videoUrl.substring(0, 60)}`);
          } else {
            logger.warn(`  S${season.season_number}E${ep.episode_number}: no video URL found`);
          }

          await browser.close();
        } catch (err) {
          logger.error(`  S${season.season_number}E${ep.episode_number}: ${err.message}`);
        }

        // Small delay between episodes
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  logger.info('Video source refresh complete');
}

refreshVideoSources();
