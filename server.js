const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.argv[2] || 3000;
const DIR = path.join(__dirname, 'frontend');

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function parseVhash(sourceUrl) {
  if (!sourceUrl) return null;
  const m = sourceUrl.match(/[?&]vhash=([a-f0-9]+)/i);
  return m ? m[1] : null;
}

http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  // API endpoint (local dev, same as Vercel serverless function)
  if (url.startsWith('/api/video-source/')) {
    const episodeId = url.replace('/api/video-source/', '');
    if (!episodeId) { res.writeHead(400); res.end('{"error":"Missing ID"}'); return; }

    try {
      const supabase = require('./database/config');
      const { data: ep } = await supabase.from('episodes').select('source_url').eq('id', episodeId).maybeSingle();
      if (!ep || !ep.source_url) { res.writeHead(404); res.end('{"error":"Not found"}'); return; }

      const hash = parseVhash(ep.source_url);
      if (!hash) { res.writeHead(400); res.end('{"error":"No hash"}'); return; }

      const apiRes = await fetch(`https://as-cdn21.top/player/index.php?data=${encodeURIComponent(hash)}&do=getVideo`, {
        method: 'POST',
        headers: { 'Referer': `https://as-cdn21.top/video/${hash}`, 'X-Requested-With': 'XMLHttpRequest' },
        signal: AbortSignal.timeout(10000)
      });
      const json = JSON.parse(await apiRes.text());
      const hlsUrl = json.videoSource || json.securedLink;
      if (hlsUrl) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ source_url: hlsUrl, source_type: 'hls' })); return; }
      res.writeHead(502); res.end('{"error":"No source"}');
    } catch (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); }
    return;
  }

  // Static file serving
  let filePath = path.join(DIR, url);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIR, 'index.html');
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}).listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
