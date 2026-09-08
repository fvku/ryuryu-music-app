import http from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp',
  '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
http.createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405); response.end(); return; }
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = await realpath(resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`));
    if (!file.startsWith(root + sep) || !mime[extname(file)] || file.endsWith(`${sep}serve.mjs`)) {
      response.writeHead(404); response.end(); return;
    }
    const body = await readFile(file);
    response.writeHead(200, { 'Content-Type': mime[extname(file)], 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch { response.writeHead(404); response.end('Not found'); }
}).listen(8778, '127.0.0.1', () => console.log('Generator lab: http://localhost:8778'));
