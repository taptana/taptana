// Arma el sitio estático para GitHub Pages en ./site:
//   /                   panel en modo demo (lee JSON de /demo)
//   /demo/sessions.json índice de sesiones de ejemplo
//   /demo/<id>.json     cada sesión (copiadas de packages/server/seed)
//   /prototipo/         examples/tienda con el recorder en modo local
//   /recorder.js        el recorder, para que el prototipo lo cargue
//
// Uso: TAPTANA_BASE=/taptana/ node scripts/build-site.mjs
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = (process.env['TAPTANA_BASE'] ?? '/').replace(/\/?$/, '/');
const site = join(root, 'site');

console.log(`building site with base ${base}`);
rmSync(site, { recursive: true, force: true });

// 1. Panel en modo demo
execSync('pnpm --filter @taptana/web build:pages', { cwd: root, stdio: 'inherit', env: { ...process.env, TAPTANA_BASE: base } });
cpSync(join(root, 'packages/web/dist-pages'), site, { recursive: true });
// GitHub Pages no sabe de rutas de SPA: 404.html con el mismo index hace que /<id> funcione.
cpSync(join(site, 'index.html'), join(site, '404.html'));

// 2. Sesiones de ejemplo
const seedDir = join(root, 'packages/server/seed');
const demoDir = join(site, 'demo');
mkdirSync(demoDir, { recursive: true });
const summaries = [];
if (existsSync(seedDir)) {
  for (const file of readdirSync(seedDir).filter((f) => f.endsWith('.json'))) {
    const data = JSON.parse(readFileSync(join(seedDir, file), 'utf8'));
    writeFileSync(join(demoDir, `${data.session.id}.json`), JSON.stringify(data));
    summaries.push(data.session);
  }
}
writeFileSync(join(demoDir, 'sessions.json'), JSON.stringify(summaries));
// Estudios de ejemplo: los que vienen dentro de las sesiones de ejemplo.
const studies = new Map();
for (const file of readdirSync(seedDir).filter((f) => f.endsWith('.json'))) {
  const data = JSON.parse(readFileSync(join(seedDir, file), 'utf8'));
  if (data.study) studies.set(data.study.id, { ...data.study, prototypeId: 'demo-tienda' });
}
writeFileSync(join(demoDir, 'studies.json'), JSON.stringify([...studies.values()]));
// Páginas del prototipo de ejemplo, para el constructor de estudios en modo demo.
const pagesList = readdirSync(join(root, 'examples/tienda'))
  .filter((f) => f.endsWith('.html'))
  .map((f) => {
    const html = readFileSync(join(root, 'examples/tienda', f), 'utf8');
    return { path: `/${f}`, title: (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? '').trim() };
  })
  .sort((a, b) => (a.path === '/index.html' ? -1 : b.path === '/index.html' ? 1 : a.path.localeCompare(b.path)));
writeFileSync(join(demoDir, 'pages.json'), JSON.stringify(pagesList));
console.log(`${summaries.length} demo sessions`);

// 3. Prototipo de ejemplo con recorder local
const recorder = join(root, 'packages/recorder/dist/recorder.js');
cpSync(recorder, join(site, 'recorder.js'));
const protoSrc = join(root, 'examples/tienda');
const protoDst = join(site, 'prototipo');
cpSync(protoSrc, protoDst, { recursive: true });
const tag = `\n<script src="${base}recorder.js" data-prototype="demo-tienda" data-transport="local"></script>\n`;
for (const file of readdirSync(protoDst).filter((f) => f.endsWith('.html'))) {
  const path = join(protoDst, file);
  const html = readFileSync(path, 'utf8');
  const i = html.search(/<\/body\s*>/i);
  writeFileSync(path, i === -1 ? html + tag : html.slice(0, i) + tag + html.slice(i));
}
writeFileSync(join(site, '.nojekyll'), '');
console.log(`site ready at ${site}`);
