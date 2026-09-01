/* A ~40-line static file server over dist/. Used by the Playwright config so the e2e run
   needs no extra dependency and serves the exact bytes `npm run build` produced. */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '../../dist');
const port = Number(process.argv[2] ?? 5174);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

createServer(async (req, res) => {
  const rel = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  const file = join(dist, rel === '' ? 'index.html' : rel);
  if (!file.startsWith(dist)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    // A directory serves its index.html, the way every static host does — the site links to
    // `folio/`, `privacy/` and `design/`, not to the file inside them.
    const target = (await stat(file)).isDirectory() ? join(file, 'index.html') : file;
    res.writeHead(200, { 'content-type': TYPES[extname(target)] ?? 'application/octet-stream' });
    res.end(await readFile(target));
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`serving dist/ on http://127.0.0.1:${port}`));
