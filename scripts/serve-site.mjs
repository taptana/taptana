// Sirve ./site como lo haría GitHub Pages, para revisar la demo antes de publicarla:
// archivos estáticos bajo la base y 404.html (con estado 404) para todo lo demás.
//
//   TAPTANA_BASE=/taptana/ node scripts/build-site.mjs
//   TAPTANA_BASE=/taptana/ node scripts/serve-site.mjs 8080   →  http://localhost:8080/taptana/
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'site');
const base = `/${(process.env['TAPTANA_BASE'] ?? '/').replace(/^\/+|\/+$/g, '')}/`.replace('//', '/');
const port = Number(process.argv[2] ?? process.env['PORT'] ?? 8080);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.map': 'application/json' };

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  let path = decodeURIComponent(url.pathname);
  if (path === base.slice(0, -1)) {
    res.writeHead(301, { location: base });
    return res.end();
  }
  if (!path.startsWith(base)) {
    res.writeHead(404);
    return res.end('fuera de la base');
  }
  path = normalize(path.slice(base.length - 1));
  if (path.endsWith('/')) path += 'index.html';
  let file = join(site, path);
  let status = 200;
  try {
    if ((await stat(file)).isDirectory()) {
      res.writeHead(301, { location: `${url.pathname}/${url.search}` });
      return res.end();
    }
  } catch {
    file = join(site, '404.html');
    status = 404;
  }
  try {
    const body = await readFile(file);
    res.writeHead(status, { 'content-type': mime[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('no encontrado');
  }
}).listen(port, () => console.log(`demo en http://localhost:${port}${base}`));
