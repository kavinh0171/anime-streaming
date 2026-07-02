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

http.createServer((req, res) => {
  let filePath = path.join(DIR, req.url.split('?')[0]);
  
  // SPA: if file doesn't exist, serve index.html
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIR, 'index.html');
  }
  
  const ext = path.extname(filePath);
  const contentType = MIME[ext] || 'application/octet-stream';
  
  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(filePath).pipe(res);
}).listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
