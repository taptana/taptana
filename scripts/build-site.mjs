// Arma el sitio estático de la demo (GitHub Pages) en ./site:
//
//   <base>                      panel en modo demo (entra por Inicio)
//   <base>404.html              copia del index: así los enlaces profundos (<base>recordings/<id>)
//                               cargan el panel. Pages responde 404 igual, pero la página se ve bien.
//   <base>demo/sessions.json    resumen de cada sesión de ejemplo (SessionSummary[])
//   <base>demo/<id>.json        cada sesión completa (SessionExport), para el reproductor
//   <base>demo/events.json      { [sessionId]: eventos propios }, para calcular el reporte sin
//                               bajar todas las grabaciones
//   <base>demo/studies.json     el estudio de ejemplo (st_demo_compra)
//   <base>demo/pages.json       [{ path, title }] de los HTML del prototipo de ejemplo
//   <base>prototipo/            examples/tienda con el recorder en modo local
//   <base>__local/api/v1/studies/<id>   el estudio de ejemplo como archivo, para que el link de
//                               participante funcione aunque el service worker aún no esté activo
//   <base>recorder.js           el recorder
//
// Uso (después de `pnpm build`):  TAPTANA_BASE=/taptana/ node scripts/build-site.mjs
// No necesita navegador ni red.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = `/${(process.env['TAPTANA_BASE'] ?? '/').replace(/^\/+|\/+$/g, '')}/`.replace('//', '/');
const site = join(root, 'site');
const PROTOTYPE_ID = 'pr_ejemplo';
const STUDY_ID = 'st_demo_compra';

const recorder = join(root, 'packages/recorder/dist/recorder.js');
if (!existsSync(recorder)) {
  console.error('Falta compilar: corre «pnpm build» antes de armar el sitio.');
  process.exit(1);
}

console.log(`armando el sitio con base ${base}`);
rmSync(site, { recursive: true, force: true });

// 1. Panel en modo demo
execSync('pnpm --filter @taptana/web build:pages', { cwd: root, stdio: 'inherit', env: { ...process.env, TAPTANA_BASE: base } });
cpSync(join(root, 'packages/web/dist-pages'), site, { recursive: true });
cpSync(join(site, 'index.html'), join(site, '404.html'));
writeFileSync(join(site, '.nojekyll'), '');

// 2. Sesiones de ejemplo y su estudio
const seedDir = join(root, 'packages/server/seed');
const demoDir = join(site, 'demo');
mkdirSync(demoDir, { recursive: true });
const summaries = [];
const ownEvents = {};
let study = null;
for (const file of readdirSync(seedDir).filter((f) => f.endsWith('.json')).sort()) {
  const data = JSON.parse(readFileSync(join(seedDir, file), 'utf8'));
  data.session.prototypeId = PROTOTYPE_ID;
  if (data.study) {
    data.study.prototypeId = PROTOTYPE_ID;
    if (data.study.id === STUDY_ID) study = data.study;
  }
  writeFileSync(join(demoDir, `${data.session.id}.json`), JSON.stringify(data));
  summaries.push(data.session);
  ownEvents[data.session.id] = data.events.filter((e) => e.kind === 'taptana');
}
if (!study) {
  // Sin sesiones del estudio: al menos el estudio de examples/tienda, para poder probarlo.
  const now = Date.now();
  study = { ...JSON.parse(readFileSync(join(root, 'examples/tienda/study.json'), 'utf8')), id: STUDY_ID, prototypeId: PROTOTYPE_ID, createdAt: now, updatedAt: now };
}
writeFileSync(join(demoDir, 'sessions.json'), JSON.stringify(summaries));
writeFileSync(join(demoDir, 'events.json'), JSON.stringify(ownEvents));
writeFileSync(join(demoDir, 'studies.json'), JSON.stringify([study]));
const studyApi = join(site, '__local/api/v1/studies');
mkdirSync(studyApi, { recursive: true });
writeFileSync(join(studyApi, STUDY_ID), JSON.stringify(study));

// 3. Prototipo de ejemplo con el recorder en modo local
const protoSrc = join(root, 'examples/tienda');
const protoDst = join(site, 'prototipo');
const skip = new Set(['study.json', 'study-v1.json', 'README.md']);
cpSync(protoSrc, protoDst, { recursive: true, filter: (src) => !skip.has(src.slice(protoSrc.length + 1)) });
cpSync(recorder, join(site, 'recorder.js'));
// data-endpoint relativo: el recorder pide <base>__local/api/v1/studies/<id> en este mismo sitio.
const tag = `\n<script src="${base}recorder.js" data-prototype="${PROTOTYPE_ID}" data-transport="local" data-base="${base}prototipo" data-endpoint="${base}__local"></script>\n`;
const pages = [];
for (const file of readdirSync(protoDst).filter((f) => f.endsWith('.html'))) {
  const path = join(protoDst, file);
  const html = readFileSync(path, 'utf8');
  const i = html.search(/<\/body\s*>/i);
  writeFileSync(path, i === -1 ? html + tag : html.slice(0, i) + tag + html.slice(i));
  pages.push({ path: `/${file}`, title: (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? '').trim() });
}
pages.sort((a, b) => (a.path === '/index.html' ? -1 : b.path === '/index.html' ? 1 : a.path.localeCompare(b.path)));
writeFileSync(join(demoDir, 'pages.json'), JSON.stringify(pages));

console.log(`${summaries.length} sesiones de ejemplo, estudio «${study.name}»`);
console.log(`sitio listo en ${site}`);
