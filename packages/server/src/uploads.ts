/**
 * Prototipos subidos desde el panel: un .html suelto o un .zip con una carpeta.
 * Se guardan en <dataDir>/prototypes/<id>/ en la laptop. Nada sale de la máquina.
 */

import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { unzipSync } from 'fflate';

/** Límite del archivo subido. Un prototipo con imágenes pesa unos pocos MB. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
/** Límite de lo descomprimido, para que un zip malicioso no llene el disco. */
const MAX_UNZIPPED_BYTES = 200 * 1024 * 1024;
const MAX_FILES = 2000;

export function prototypesRoot(dataDir: string): string {
  return join(dataDir, 'prototypes');
}

export function prototypeDir(dataDir: string, id: string): string {
  return join(prototypesRoot(dataDir), id);
}

export class UploadError extends Error {}

/**
 * Escribe el archivo subido en `dest`. Devuelve la ruta de entrada ("/index.html").
 * Con un zip que trae una sola carpeta arriba, la "aplana": /mi-proto/index.html → /index.html.
 */
export function extractUpload(fileName: string, bytes: Uint8Array, dest: string): { entryPath: string; files: number } {
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new UploadError('El archivo pesa más de 50 MB.');
  const lower = fileName.toLowerCase();
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });

  if (lower.endsWith('.html') || lower.endsWith('.htm')) {
    writeFileSync(join(dest, 'index.html'), bytes);
    return { entryPath: '/index.html', files: 1 };
  }
  if (!lower.endsWith('.zip')) throw new UploadError('Sube un archivo .html o .zip.');

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new UploadError('No se pudo abrir el zip.');
  }
  // Fuera carpetas, basura de macOS y archivos ocultos.
  const files = Object.entries(entries).filter(
    ([name, data]) => !name.endsWith('/') && data.byteLength >= 0 && !name.startsWith('__MACOSX/') && !name.split('/').some((part) => part.startsWith('.')),
  );
  if (files.length === 0) throw new UploadError('El zip está vacío.');
  if (files.length > MAX_FILES) throw new UploadError(`El zip tiene más de ${MAX_FILES} archivos.`);
  const total = files.reduce((n, [, d]) => n + d.byteLength, 0);
  if (total > MAX_UNZIPPED_BYTES) throw new UploadError('El zip descomprimido pesa más de 200 MB.');

  // ¿Todo vive dentro de una sola carpeta? Entonces esa carpeta es la raíz.
  const tops = new Set(files.map(([name]) => name.split('/')[0]));
  const strip = tops.size === 1 && files.every(([name]) => name.includes('/')) ? `${[...tops][0]}/` : '';

  const root = resolve(dest);
  for (const [name, data] of files) {
    const rel = strip ? name.slice(strip.length) : name;
    const target = normalize(join(root, rel));
    // Un nombre como "../../etc/x" no puede escribir fuera de la carpeta.
    if (!target.startsWith(root + sep)) throw new UploadError(`Ruta no permitida en el zip: ${name}`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
  }

  const htmls = listHtml(root);
  if (htmls.length === 0) throw new UploadError('El zip no tiene ningún archivo .html.');
  const entryPath = htmls.includes('/index.html') ? '/index.html' : htmls[0]!;
  return { entryPath, files: files.length };
}

function listHtml(root: string, dir = root, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) listHtml(root, full, out);
    else if (/\.html?$/i.test(name)) out.push('/' + full.slice(root.length + 1).split(sep).join('/'));
  }
  return out.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
}

export function removePrototypeFiles(dataDir: string, id: string): void {
  const dir = prototypeDir(dataDir, id);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}
