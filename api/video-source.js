const { createClient } = require('@supabase/supabase-js');

let supabase = null;
function getDb() {
  if (!supabase) {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  }
  return supabase;
}

function parseVhash(src) {
  if (!src) return null;
  const m = src.match(/[?&]vhash=([a-f0-9]+)/i);
  return m ? m[1] : null;
}

async function getHlsUrl(hash) {
  const r = await fetch(`https://as-cdn21.top/player/index.php?data=${encodeURIComponent(hash)}&do=getVideo`, {
    method: 'POST',
    headers: { 'Referer': `https://as-cdn21.top/video/${hash}`, 'X-Requested-With': 'XMLHttpRequest' },
    signal: AbortSignal.timeout(10000)
  });
  const j = JSON.parse(await r.text());
  return j.videoSource || j.securedLink || null;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const path = req.url.split('?')[0];

  // /api/video-source/:id — returns fresh HLS URL as JSON
  if (path.startsWith('/api/video-source/')) {
    const id = path.replace('/api/video-source/', '');
    if (!id) return res.status(400).json({ error: 'Missing ID' });
    try {
      const db = getDb();
      const { data: ep } = await db.from('episodes').select('source_url').eq('id', id).maybeSingle();
      if (!ep?.source_url) return res.status(404).json({ error: 'Not found' });
      const hash = parseVhash(ep.source_url);
      if (!hash) return res.status(400).json({ error: 'No hash' });
      const url = await getHlsUrl(hash);
      if (url) return res.json({ source_url: url, source_type: 'hls' });
      return res.status(502).json({ error: 'No source' });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  // /api/hls-proxy/:id/* — proxies HLS manifest + segments (avoids CORS)
  const m = path.match(/^\/api\/hls-proxy\/([^/]+)\/(.+)$/);
  if (m) {
    const id = m[1], resource = m[2];
    try {
      const db = getDb();
      const { data: ep } = await db.from('episodes').select('source_url').eq('id', id).maybeSingle();
      if (!ep?.source_url) return res.status(404).json({ error: 'Not found' });
      const hash = parseVhash(ep.source_url);
      if (!hash) return res.status(400).json({ error: 'No hash' });

      const freshUrl = await getHlsUrl(hash);
      if (!freshUrl) return res.status(502).json({ error: 'No source' });

      const base = freshUrl.substring(0, freshUrl.lastIndexOf('/') + 1);
      const qs = freshUrl.includes('?') ? freshUrl.split('?')[1] : '';
      const target = base + resource + (qs ? '?' + qs : '');

      const proxy = await fetch(target, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://as-cdn21.top/' },
        signal: AbortSignal.timeout(15000)
      });
      if (!proxy.ok) return res.status(proxy.status).send('Proxy error');

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=30');
      const ct = proxy.headers.get('content-type') || '';

      if (ct.includes('mpegurl') || ct.includes('m3u8') || resource.endsWith('.m3u8')) {
        let body = await proxy.text();
        body = body.replace(/^([a-zA-Z0-9_][^/\s]*\.(?:ts|m3u8|aac|mp3|vtt|webvtt)(?:\?[^\s]*)?)$/gm, (match) => `/api/hls-proxy/${id}/${match}`);
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        return res.send(body);
      }

      const buf = await proxy.arrayBuffer();
      res.setHeader('Content-Type', ct || 'video/mp2t');
      res.send(Buffer.from(buf));
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  res.status(404).json({ error: 'Not found' });
};
