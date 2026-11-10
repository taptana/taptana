// Copia al paquete lo que el servidor sirve pero no compila él mismo:
// - el bundle del recorder (packages/recorder/dist/recorder.js → public/recorder.js)
// - el panel compilado (packages/web/dist → public/panel)
// - el prototipo de ejemplo (examples/tienda → example/tienda), para "Ver un ejemplo"
// Así, al publicar @taptana/server en npm, ya trae todo adentro.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const publicDir = resolve(root, 'public');
mkdirSync(publicDir, { recursive: true });

const recorder = resolve(root, '../recorder/dist/recorder.js');
if (existsSync(recorder)) {
  cpSync(recorder, resolve(publicDir, 'recorder.js'));
  if (existsSync(`${recorder}.map`)) cpSync(`${recorder}.map`, resolve(publicDir, 'recorder.js.map'));
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
  console.warn('warning: panel build not found; /panel will show a placeholder');
}

// El ejemplo: los archivos del prototipo, sin lo que no es parte de él.
const example = resolve(root, '../../examples/tienda');
const exampleDest = resolve(root, 'example', 'tienda');
const skip = new Set(['study.json', 'README.md']);
if (existsSync(example)) {
  rmSync(exampleDest, { recursive: true, force: true });
  cpSync(example, exampleDest, {
    recursive: true,
    filter: (source) => source === example || !(skip.has(basename(source)) || basename(source).startsWith('.')),
  });
  console.log('copied example');
} else {
  console.warn('warning: examples/tienda not found; "Ver un ejemplo" will not be available');
}
