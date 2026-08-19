import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = __dirname;
const SHARED_ASSETS_DIR = path.resolve(PROJECT_ROOT, 'shared-assets');

const MIME = {
  '.css':  'text/css',
  '.js':   'text/javascript',
  '.mjs':  'text/javascript',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf':  'font/ttf',
  '.json': 'application/json',
};

export default defineConfig({
  root: 'Ichtus_SPA',
  server: {
    fs: {
      // Allow the project root (where vite.config.js sits) so Vite's
      // server is permitted to read files outside the Ichtus_SPA root.
      allow: [PROJECT_ROOT],
    },
  },
  plugins: [
    // Belt-and-suspenders for /shared-assets/*. The HTML references them
    // with ../shared-assets/... which Vite would otherwise SPA-fallback
    // to index.html. This middleware serves the real file directly.
    {
      name: 'serve-shared-assets',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = req.url || '';
          if (!url.startsWith('/shared-assets/')) return next();

          // Strip the URL prefix and any query string
          const relPath = decodeURIComponent(url.replace(/^\/shared-assets\//, '').split('?')[0]);
          const filePath = path.join(SHARED_ASSETS_DIR, relPath);

          // Prevent path traversal outside shared-assets
          if (!filePath.startsWith(SHARED_ASSETS_DIR)) {
            res.statusCode = 403;
            return res.end('Forbidden');
          }

          fs.stat(filePath, (err, stat) => {
            if (err || !stat.isFile()) return next();
            const ext = path.extname(filePath).toLowerCase();
            res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
            res.setHeader('Cache-Control', 'no-cache');
            fs.createReadStream(filePath).pipe(res);
          });
        });
      },
    },
  ],
});
