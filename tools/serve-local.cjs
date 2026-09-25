const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', 'web');
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.otf': 'font/otf',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

http.createServer((request, response) => {
  let pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/healthz') {
    response.end('ok');
    return;
  }
  // In Docker this file is generated at container startup from MAPBOX_TOKEN.
  // The local preview intentionally uses the OpenStreetMap fallback instead.
  if (pathname === '/data/scoring/map-config.json') {
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end('{"mapboxTilesUrl":null}\n');
    return;
  }
  if (pathname === '/') pathname = '/index.html';

  const filePath = path.resolve(root, `.${decodeURIComponent(pathname)}`);
  if (!filePath.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403).end();
    return;
  }
  fs.readFile(filePath, (error, file) => {
    if (error) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream' });
    response.end(file);
  });
}).listen(8082, '127.0.0.1', () => console.log('KRT site: http://127.0.0.1:8082'));
