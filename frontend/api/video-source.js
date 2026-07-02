const { createClient } = require('@supabase/supabase-js');

function parseVhash(sourceUrl) {
  if (!sourceUrl) return null;
  const m = sourceUrl.match(/[?&]vhash=([a-f0-9]+)/i);
  return m ? m[1] : null;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const episodeId = req.url.replace('/api/video-source/', '').split('?')[0];
  if (!episodeId) {
    return res.status(400).json({ error: 'Missing episode ID' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
    const { data: ep } = await supabase.from('episodes').select('source_url').eq('id', episodeId).maybeSingle();

    if (!ep || !ep.source_url) {
      return res.status(404).json({ error: 'Episode not found' });
    }

    const hash = parseVhash(ep.source_url);
    if (!hash) {
      return res.status(400).json({ error: 'No video hash. Re-run the scraper.' });
    }

    const apiUrl = `https://as-cdn21.top/player/index.php?data=${encodeURIComponent(hash)}&do=getVideo`;
    const apiRes = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Referer': `https://as-cdn21.top/video/${hash}`,
        'X-Requested-With': 'XMLHttpRequest',
      },
      signal: AbortSignal.timeout(10000)
    });
    const apiText = await apiRes.text();
    const apiJson = JSON.parse(apiText);
    const hlsUrl = apiJson.videoSource || apiJson.securedLink;

    if (hlsUrl) {
      return res.status(200).json({ source_url: hlsUrl, source_type: 'hls' });
    }
    return res.status(502).json({ error: 'No video source from CDN' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
