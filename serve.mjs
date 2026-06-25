import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3001;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
};

// B6: Cache-Control per asset type
// HTML: always revalidate (app is a single-file SPA — any deploy changes it)
// Fonts/images: long-lived immutable (content-addressed in practice)
// JS/CSS: 1-day cache (reasonable for dev server; production CDN adds fingerprinting)
const CACHE_CONTROL = {
  '.html': 'no-cache, must-revalidate',
  '.css':  'public, max-age=86400',
  '.js':   'public, max-age=86400',
  '.mjs':  'public, max-age=86400',
  '.json': 'no-cache, must-revalidate',
  '.png':  'public, max-age=2592000, immutable',
  '.jpg':  'public, max-age=2592000, immutable',
  '.jpeg': 'public, max-age=2592000, immutable',
  '.gif':  'public, max-age=2592000, immutable',
  '.svg':  'public, max-age=2592000, immutable',
  '.ico':  'public, max-age=2592000, immutable',
  '.woff': 'public, max-age=31536000, immutable',
  '.woff2':'public, max-age=31536000, immutable',
  '.ttf':  'public, max-age=31536000, immutable',
};

// B2: Security headers applied to every response
// frame-ancestors: must be HTTP header (meta CSP cannot set this directive)
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://cdnjs.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https://placehold.co",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const SECURITY_HEADERS = {
  'X-Content-Type-Options':  'nosniff',
  'X-Frame-Options':         'DENY',
  'Referrer-Policy':         'strict-origin-when-cross-origin',
  'X-XSS-Protection':        '1; mode=block',
  'Permissions-Policy':      'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': CSP,
};

const _ROOT = path.resolve(__dirname);

http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0]);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS });
    res.end('Bad Request');
    return;
  }
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.resolve(__dirname, '.' + urlPath);
  // Prevent path traversal: resolved path must stay inside the project root
  if (!filePath.startsWith(_ROOT + path.sep) && filePath !== _ROOT) {
    res.writeHead(400, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS });
    res.end('Bad Request');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const contentType  = MIME[ext]          || 'application/octet-stream';
  const cacheControl = CACHE_CONTROL[ext] || 'no-cache, must-revalidate';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, {
        'Content-Type': 'text/plain',
        ...SECURITY_HEADERS,
      });
      res.end('404 Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type':  contentType,
      'Cache-Control': cacheControl,
      ...SECURITY_HEADERS,
    });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`\n  Etcher Task Hub — dev server`);
  console.log(`  http://localhost:${PORT}\n`);
});
