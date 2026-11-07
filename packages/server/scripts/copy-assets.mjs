// Copia a public/ lo que el servidor sirve pero no compila él mismo:
// - el bundle del recorder (packages/recorder/dist/recorder.js)
// - el panel compilado (packages/web/dist → public/panel)
// Así, al publicar @taptana/server en npm, ya trae todo adentro.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const publicDir = resolve(root, 'public');
mkdirSync(publicDir, { recursive: true });

const recorder = resolve(root, '../recorder/dist/recorder.js');
if (existsSync(recorder)) {
  cpSync(recorder, resolve(publicDir, 'recorder.js'));
  console.log('copied recorder.js');
} else {
  console.warn('warning: recorder bundle not found; run `pnpm --filter @taptana/recorder build` first');
}

const web = resolve(root, '../web/dist');
const panel = resolve(publicDir, 'panel');
if (existsSync(web)) {
  rmSync(panel, { recursive: true, force: true });
  cpSync(web, panel, { recursive: true });
  console.log('copied panel');
} else {
  console.warn('warning: panel build not found; /sessions will show a placeholder');
}
