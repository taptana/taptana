/**
 * El ejemplo: la tienda de plantas como prototipo subido, su estudio y sesiones ya grabadas.
 * Lo carga el botón "Ver un ejemplo" del panel (`POST /api/v1/example`) y `taptana seed`.
 *
 * Los archivos vienen dentro del paquete: `example/tienda` (copia de examples/tienda) y
 * `seed/*.json` (sesiones reales del prototipo). Nada se baja de internet.
 */

import { promises as fs } from 'node:fs';
import { basename, join } from 'node:path';
import {
  EXAMPLE_PROTOTYPE_ID,
  EXAMPLE_PROTOTYPE_NAME,
  EXAMPLE_STUDY_ID,
  validateSessionExport,
  type ExampleResponse,
  type SessionExport,
  type StudyRecord,
} from '@taptana/shared';
import type { Store } from './store/store.js';
import { hasAbsoluteUrls, prototypeDir } from './uploads.js';
import { PACKAGE_ROOT } from './version.js';

export const DEFAULT_EXAMPLE_DIR = join(PACKAGE_ROOT, 'example', 'tienda');
export const DEFAULT_SEED_DIR = join(PACKAGE_ROOT, 'seed');

/** El ejemplo no se puede cargar en esta instalación. El servidor responde 503 con el mensaje. */
export class ExampleError extends Error {}

export interface ExampleOptions {
  store: Store;
  /** Carpeta de datos: el prototipo se copia a <dataDir>/prototypes/pr_ejemplo/. */
  dataDir: string;
  /** Carpeta con los archivos del prototipo de ejemplo. Por defecto, la del paquete. */
  exampleDir?: string;
  /** Carpeta con las sesiones de ejemplo (*.json). Por defecto, la del paquete. */
  seedDir?: string;
}

export interface ExampleResult extends ExampleResponse {
  /** Sesiones importadas en esta llamada (0 si ya estaban todas). */
  imported: number;
}

/** ¿El ejemplo ya está cargado? */
export function exampleLoaded(store: Store): boolean {
  return store.getPrototype(EXAMPLE_PROTOTYPE_ID)?.source === 'upload' && store.getStudy(EXAMPLE_STUDY_ID) !== null;
}

/** Lee los archivos de sesión de una carpeta. Los que no son una sesión válida se saltan. */
export async function readSeedFiles(seedDir: string): Promise<SessionExport[]> {
  let names: string[];
  try {
    names = (await fs.readdir(seedDir)).filter((name) => name.endsWith('.json')).sort();
  } catch {
    return [];
  }
  const out: SessionExport[] = [];
  for (const name of names) {
    try {
      const result = validateSessionExport(JSON.parse(await fs.readFile(join(seedDir, name), 'utf8')));
      if (result.ok) out.push(result.value);
    } catch {
      /* archivo ilegible: se salta */
    }
  }
  return out;
}

const SKIP_FILES = new Set(['study.json', 'README.md']);

/**
 * Deja el ejemplo listo: prototipo `pr_ejemplo`, estudio `st_demo_compra` apuntando a él y las
 * sesiones de `seed/` reescritas a ese prototipo, con sus ids de siempre.
 *
 * Se puede llamar las veces que sea: lo que ya está no se duplica ni se pisa (ni tus marcas en
 * las sesiones ni tus cambios al estudio), y lo que falte (por ejemplo, una sesión que
 * borraste) vuelve a aparecer.
 */
export async function loadExample(opts: ExampleOptions): Promise<ExampleResult> {
  const { store, dataDir } = opts;
  const exampleDir = opts.exampleDir ?? DEFAULT_EXAMPLE_DIR;
  const seeds = await readSeedFiles(opts.seedDir ?? DEFAULT_SEED_DIR);

  // 1. Los archivos del prototipo.
  const dest = prototypeDir(dataDir, EXAMPLE_PROTOTYPE_ID);
  const entry = join(dest, 'index.html');
  if (!(await exists(entry))) {
    if (!(await exists(join(exampleDir, 'index.html')))) {
      throw new ExampleError('El ejemplo no viene en esta instalación. Corre «pnpm build» en la raíz del repositorio y vuelve a intentar.');
    }
    await fs.rm(dest, { recursive: true, force: true });
    await fs.cp(exampleDir, dest, {
      recursive: true,
      filter: (source) => source === exampleDir || !(SKIP_FILES.has(basename(source)) || basename(source).startsWith('.')),
    });
  }
  const existing = store.getPrototype(EXAMPLE_PROTOTYPE_ID);
  store.savePrototype({
    id: EXAMPLE_PROTOTYPE_ID,
    name: existing?.source === 'upload' ? existing.name : EXAMPLE_PROTOTYPE_NAME,
    createdAt: existing?.createdAt ?? Date.now(),
    source: 'upload',
    entryPath: '/index.html',
    absoluteUrls: hasAbsoluteUrls(await fs.readFile(entry, 'utf8')),
  });

  // 2. El estudio: el que traen las sesiones de ejemplo, apuntando al prototipo de ejemplo.
  const embedded = seeds.map((seed) => seed.study).filter((study): study is StudyRecord => study !== undefined);
  const seedStudy = embedded.find((study) => study.id === EXAMPLE_STUDY_ID) ?? embedded[0];
  const studyId = seedStudy?.id ?? EXAMPLE_STUDY_ID;
  const current = store.getStudy(studyId);
  if (!current) {
    if (!seedStudy) throw new ExampleError('El ejemplo no trae su estudio en esta instalación. Vuelve a instalar Taptana.');
    store.saveStudy({ ...seedStudy, prototypeId: EXAMPLE_PROTOTYPE_ID }, studyId);
  } else if (current.prototypeId !== EXAMPLE_PROTOTYPE_ID) {
    store.saveStudy({ ...current, prototypeId: EXAMPLE_PROTOTYPE_ID }, studyId);
  }

  // 3. Las sesiones, ligadas al prototipo de ejemplo. Las que ya están ahí no se tocan.
  let imported = 0;
  for (const seed of seeds) {
    const id = seed.session.id;
    if (store.hasSession(id) && store.getSession(id)?.prototypeId === EXAMPLE_PROTOTYPE_ID) continue;
    const copy: SessionExport = { ...seed, session: { ...seed.session, prototypeId: EXAMPLE_PROTOTYPE_ID } };
    if (seed.study) copy.study = { ...seed.study, prototypeId: EXAMPLE_PROTOTYPE_ID };
    store.importSession(copy);
    imported++;
  }
  return { prototypeId: EXAMPLE_PROTOTYPE_ID, studyId, imported };
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}
