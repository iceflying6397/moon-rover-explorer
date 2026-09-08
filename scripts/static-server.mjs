import http from 'node:http';
import path from 'node:path';
import { stat, realpath } from 'node:fs/promises';
import { createReadStream } from 'node:fs';

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2',
  '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.rsc': 'text/x-component',
};

export function createStaticServer(directory) {
  const root = path.resolve(directory);
  const rootReal = realpath(root);
  return http.createServer(async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end();
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(
        new URL(request.url, 'http://localhost').pathname,
      );
    } catch {
      response.writeHead(400);
      response.end();
      return;
    }
    let file = path.resolve(root, '.' + pathname);
    if (file !== root && !file.startsWith(root + path.sep)) {
      response.writeHead(403);
      response.end();
      return;
    }
    try {
      let info = await stat(file);
      if (info.isDirectory()) {
        file = path.join(file, 'index.html');
        info = await stat(file);
      }
      const resolved = await realpath(file),
        allowedRoot = await rootReal;
      if (!resolved.startsWith(allowedRoot + path.sep) || !info.isFile()) {
        response.writeHead(403);
        response.end();
        return;
      }
      const etag = `W/"${info.size.toString(16)}-${info.mtimeMs.toString(16)}"`;
      const headers = {
        'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': pathname.startsWith('/_next/static/')
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
        ETag: etag,
        'Last-Modified': info.mtime.toUTCString(),
        'X-Content-Type-Options': 'nosniff',
      };
      const match = request.headers['if-none-match'];
      const since = Date.parse(request.headers['if-modified-since'] || '');
      const unchanged =
        match !== undefined
          ? match
              .split(',')
              .some(
                (value) =>
                  value.trim() === '*' ||
                  value.trim().replace(/^W\//, '') === etag.replace(/^W\//, ''),
              )
          : Number.isFinite(since) &&
            Math.floor(info.mtimeMs / 1000) * 1000 <= since;
      if (unchanged) {
        response.writeHead(304, headers);
        response.end();
        return;
      }
      response.writeHead(200, { ...headers, 'Content-Length': info.size });
      if (request.method === 'HEAD') {
        response.end();
        return;
      }
      const stream = createReadStream(file);
      stream.on('error', () => response.destroy());
      response.on('close', () => stream.destroy());
      stream.pipe(response);
    } catch (error) {
      response.writeHead(
        error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 404 : 500,
      );
      response.end('Resource unavailable');
    }
  });
}
