const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, 'frontend');
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp',
};

http.createServer((req, res) => {
  let url = req.url.split('?')[0];
  if (url === '/') url = '/index.html';

  let filePath = path.join(ROOT, url);
  const ext = path.extname(filePath);

  // SPA rewrite: if no extension, serve index.html
  if (!ext || ext === '.htm') {
    filePath = path.join(ROOT, 'index.html');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // Fallback to index.html for SPA routes
      fs.readFile(path.join(ROOT, 'index.html'), (err2, data2) => {
        if (err2) { res.writeHead(500); res.end('Server error'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(data2);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
