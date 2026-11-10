/**
 * Prototipos subidos desde el panel: un .html suelto o un .zip con una carpeta.
 * Se guardan en <dataDir>/prototypes/<id>/ en la laptop. Nada sale de la máquina.
 */

import { promises as fs } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve, sep } from 'node:path';
import { listZip, readZipEntry, ZipError, type ZipEntry } from './zip.js';

/** Límite del archivo subido. Un prototipo con imágenes pesa unos pocos MB. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
/** Límite de lo descomprimido, para que un zip malicioso no llene el disco ni la memoria. */
export const MAX_UNZIPPED_BYTES = 200 * 1024 * 1024;
export const MAX_FILES = 2000;

export function prototypesRoot(dataDir: string): string {
  return join(dataDir, 'prototypes');
}

export function prototypeDir(dataDir: string, id: string): string {
  return join(prototypesRoot(dataDir), id);
}

/** Un problema con el archivo subido, dicho para quien lo subió. El servidor responde 400. */
export class UploadError extends Error {}

export interface UploadResult {
  /** Página de entrada ("/index.html"). */
  entryPath: string;
  files: number;
  /** El HTML de entrada usa rutas absolutas ("/css/app.css"): conviene abrirlo en la raíz. */
  absoluteUrls: boolean;
}

interface PlannedFile {
  /** Ruta relativa dentro del prototipo, con "/". */
  path: string;
  read(): Uint8Array;
}

/** ¿El HTML carga o enlaza cosas con rutas que empiezan en "/" (y no en "//")? */
export function hasAbsoluteUrls(html: string): boolean {
  return /\b(?:src|href|action|poster)\s*=\s*["']?\/(?!\/)/i.test(html) || /url\(\s*["']?\/(?!\/)/i.test(html);
}

/** Basura que traen los zips y que no es parte del prototipo. */
function isJunk(parts: string[]): boolean {
  const last = parts[parts.length - 1] ?? '';
  return (
    parts[0] === '__MACOSX' ||
    parts.includes('node_modules') ||
    parts.some((part) => part.startsWith('.')) ||
    last === 'Thumbs.db' ||
    last === 'desktop.ini'
  );
}

function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) if (value.charCodeAt(i) < 32) return true;
  return false;
}

/**
 * Revisa el índice del zip y decide qué archivos se van a escribir, sin descomprimir nada
 * todavía: los límites se comprueban con los tamaños declarados.
 */
function planZip(bytes: Uint8Array): PlannedFile[] {
  let entries: ZipEntry[];
  try {
    entries = listZip(bytes);
  } catch {
    throw new UploadError('No se pudo abrir el zip.');
  }

  const wanted: Array<{ parts: string[]; entry: ZipEntry }> = [];
  for (const entry of entries) {
    if (entry.directory) continue;
    const name = entry.name;
    if (name.startsWith('/') || /^[A-Za-z]:/.test(name) || hasControlChars(name)) throw new UploadError(`Ruta no permitida en el zip: ${name}`);
    const parts = name.split('/').filter((part) => part !== '');
    // Un nombre como "../../etc/x" no puede escribir fuera de la carpeta.
    if (parts.includes('..')) throw new UploadError(`Ruta no permitida en el zip: ${name}`);
    if (parts.length === 0 || isJunk(parts)) continue;
    if (entry.symlink) throw new UploadError(`El zip trae un enlace simbólico (${name}). Cámbialo por el archivo real y vuelve a comprimir.`);
    if (entry.encrypted) throw new UploadError('El zip tiene contraseña. Comprímelo sin contraseña y súbelo de nuevo.');
    if (entry.method !== 0 && entry.method !== 8) {
      throw new UploadError('El zip usa un tipo de compresión que Taptana no entiende. Comprímelo de nuevo con la opción normal de tu sistema.');
    }
    wanted.push({ parts, entry });
  }
  if (wanted.length === 0) throw new UploadError('El zip está vacío.');
  if (wanted.length > MAX_FILES) throw new UploadError(`El zip tiene más de ${MAX_FILES} archivos.`);
  const total = wanted.reduce((sum, w) => sum + w.entry.size, 0);
  if (total > MAX_UNZIPPED_BYTES) throw new UploadError('El zip descomprimido pesa más de 200 MB.');

  // ¿Todo vive dentro de una sola carpeta? Entonces esa carpeta es la raíz.
  const tops = new Set(wanted.map((w) => w.parts[0]));
  const strip = tops.size === 1 && wanted.every((w) => w.parts.length > 1) ? 1 : 0;

  // Algunos zips traen un archivo y una carpeta con el mismo nombre: gana la carpeta. Se compara
  // sin distinguir mayúsculas porque así lo hacen los discos de macOS y Windows.
  const folders = new Set<string>();
  const files = new Map<string, PlannedFile>();
  for (const w of wanted) {
    const parts = w.parts.slice(strip);
    for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join('/').toLowerCase());
    const path = parts.join('/');
    files.set(path, {
      path,
      read: () => {
        try {
          return readZipEntry(bytes, w.entry);
        } catch (err) {
          if (err instanceof ZipError) throw new UploadError(`No se pudo abrir el zip: «${w.entry.name}» está dañado.`);
          throw err;
        }
      },
    });
  }
  return [...files.values()].filter((file) => !folders.has(file.path.toLowerCase()));
}

/** Errores del disco que en realidad son culpa del nombre del archivo, no del servidor. */
const NAME_ERRORS = new Set(['EINVAL', 'ENAMETOOLONG', 'ENOENT', 'ENOTDIR', 'EISDIR', 'EEXIST']);

/**
 * Escribe el archivo subido en `dest`. Devuelve la ruta de entrada ("/index.html").
 * Con un zip que trae una sola carpeta arriba, la "aplana": /mi-proto/index.html → /index.html.
 *
 * Primero escribe en una carpeta temporal y solo al final reemplaza `dest`: si el archivo
 * nuevo no sirve, la versión anterior del prototipo queda intacta.
 */
export async function extractUpload(fileName: string, bytes: Uint8Array, dest: string): Promise<UploadResult> {
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new UploadError('El archivo pesa más de 50 MB.');
  const lower = fileName.toLowerCase();

  let files: PlannedFile[];
  if (lower.endsWith('.html') || lower.endsWith('.htm')) {
    files = [{ path: 'index.html', read: () => bytes }];
  } else if (lower.endsWith('.zip')) {
    files = planZip(bytes);
  } else {
    throw new UploadError('Sube un archivo .html o .zip.');
  }

  const htmls = files
    .map((f) => `/${f.path}`)
    .filter((p) => /\.html?$/i.test(p))
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  if (htmls.length === 0) throw new UploadError('El zip no tiene ningún archivo .html.');
  const entryPath = htmls.includes('/index.html') ? '/index.html' : (htmls[0] as string);

  const tmp = `${resolve(dest)}.tmp-${randomBytes(4).toString('hex')}`;
  let absoluteUrls = false;
  try {
    await fs.mkdir(tmp, { recursive: true });
    const made = new Set<string>([tmp]);
    for (const file of files) {
      const target = join(tmp, ...file.path.split('/'));
      if (!target.startsWith(tmp + sep)) throw new UploadError(`Ruta no permitida en el zip: ${file.path}`);
      const data = file.read();
      try {
        const folder = dirname(target);
        if (!made.has(folder)) {
          await fs.mkdir(folder, { recursive: true });
          made.add(folder);
        }
        await fs.writeFile(target, data);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code ?? '';
        if (NAME_ERRORS.has(code)) throw new UploadError(`No se pudo guardar «${file.path}»: su nombre no es válido en esta computadora.`);
        throw err;
      }
      if (`/${file.path}` === entryPath) absoluteUrls = hasAbsoluteUrls(Buffer.from(data).toString('utf8'));
    }
    await fs.rm(dest, { recursive: true, force: true });
    await fs.mkdir(dirname(resolve(dest)), { recursive: true });
    await fs.rename(tmp, dest);
  } catch (err) {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }
  return { entryPath, files: files.length, absoluteUrls };
}

export async function removePrototypeFiles(dataDir: string, id: string): Promise<void> {
  await fs.rm(prototypeDir(dataDir, id), { recursive: true, force: true });
}
