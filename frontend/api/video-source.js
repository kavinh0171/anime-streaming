const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_KEY || '', { auth: { persistSession: false } });

function parseVhash(src) {
  if (!src) return null;
  const m = src.match(/[?&]vhash=([a-f0-9]+)/i);
  return m ? m[1] : null;
}

async function establishSession(hash) {
  // Visit the CDN player page to get session cookies
  const visitRes = await fetch(`https://as-cdn21.top/player/index.php?data=${hash}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    redirect: 'manual'
  });
  const cookies = (visitRes.headers.get('set-cookie') || '').split(',').map(c => c.split(';')[0]).join('; ');
  return cookies;
}

async function getHlsUrl(hash, cookies) {
  const r = await fetch(`https://as-cdn21.top/player/index.php?data=${encodeURIComponent(hash)}&do=getVideo`, {
    method: 'POST',
    headers: {
      'Referer': `https://as-cdn21.top/video/${hash}`,
      'X-Requested-With': 'XMLHttpRequest',
      'Cookie': cookies,
      'User-Agent': 'Mozilla/5.0'
    },
    signal: AbortSignal.timeout(10000)
  });
  const text = await r.text();
  try {
    const j = JSON.parse(text);
    return j.videoSource || j.securedLink || null;
  } catch {
    return null;
  }
}

async function fetchWithSession(url, hash, cookies) {
  return fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Referer': 'https://as-cdn21.top/',
      'Cookie': cookies
    },
    signal: AbortSignal.timeout(15000)
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const path = req.url.split('?')[0];

  // /api/video-source/:id — returns fresh HLS URL as JSON
  if (path.startsWith('/api/video-source/')) {
    const id = path.replace('/api/video-source/', '');
    if (!id) return res.status(400).json({ error: 'Missing ID' });
    try {
      const { data: ep } = await supabase.from('episodes').select('source_url').eq('id', id).maybeSingle();
      if (!ep?.source_url) return res.status(404).json({ error: 'Not found' });
      const hash = parseVhash(ep.source_url);
      if (!hash) return res.status(400).json({ error: 'No hash' });
      const cookies = await establishSession(hash);
      const url = await getHlsUrl(hash, cookies);
      if (url) return res.json({ source_url: url, source_type: 'hls' });
      return res.status(502).json({ error: 'No source from CDN' });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  // /api/hls-proxy/:id/* — proxies manifest + segments with session cookies
  const m = path.match(/^\/api\/hls-proxy\/([^/]+)\/(.+)$/);
  if (m) {
    const id = m[1], resource = m[2];
    try {
      const { data: ep } = await supabase.from('episodes').select('source_url').eq('id', id).maybeSingle();
      if (!ep?.source_url) return res.status(404).json({ error: 'Not found' });
      const hash = parseVhash(ep.source_url);
      if (!hash) return res.status(400).json({ error: 'No hash' });

      const cookies = await establishSession(hash);
      const freshUrl = await getHlsUrl(hash, cookies);
      if (!freshUrl) return res.status(502).json({ error: 'No source from CDN' });

      const base = freshUrl.substring(0, freshUrl.lastIndexOf('/') + 1);
      const qs = freshUrl.includes('?') ? freshUrl.split('?')[1] : '';
      const target = base + resource + (qs ? '?' + qs : '');

      const proxy = await fetchWithSession(target, hash, cookies);
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
