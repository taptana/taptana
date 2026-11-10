/**
 * Sirve archivos de una carpeta, con cuidado de no salir de ella.
 * Para los HTML, deja que quien llama transforme el contenido (inyectar el recorder).
 */

import { promises as fs } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
};

export function mimeFor(path: string): string {
  return MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

export interface ResolvedFile {
  absolute: string;
  isHtml: boolean;
  size: number;
  mtimeMs: number;
  /** La URL nombra una carpeta sin la barra final: conviene redirigir a "<ruta>/" para que sus rutas relativas funcionen. */
  needsSlash?: boolean;
}

const startsWithDot = (segment: string): boolean => segment.startsWith('.');

/**
 * Convierte una ruta de URL en un archivo dentro de `root`, o null si no existe o no se debe
 * servir. `/` y `/carpeta/` buscan index.html. `/pagina` prueba `pagina.html`.
 *
 * Nunca sirve:
 * - segmentos que empiezan con "." (`.env`, `.git/config`, y de paso `..`);
 * - enlaces simbólicos que apuntan fuera de la carpeta (se compara la ruta real).
 */
export async function resolveFile(root: string, urlPath: string): Promise<ResolvedFile | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const segments = decoded.split(/[\\/]+/).filter((s) => s !== '');
  if (segments.some(startsWithDot)) return null;

  let rootReal: string;
  try {
    rootReal = await fs.realpath(resolve(root));
  } catch {
    return null;
  }
  const candidate = join(rootReal, ...segments);
  const isDirUrl = segments.length === 0 || /[\\/]$/.test(decoded);
  const tries: Array<{ path: string; needsSlash?: boolean }> = isDirUrl
    ? [{ path: join(candidate, 'index.html') }]
    : [{ path: candidate }, { path: join(candidate, 'index.html'), needsSlash: true }, { path: `${candidate}.html` }];

  for (const attempt of tries) {
    try {
      const real = await fs.realpath(attempt.path);
      const inside = relative(rootReal, real);
      if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) continue;
      if (inside.split(sep).some(startsWithDot)) continue;
      const stat = await fs.stat(real);
      if (!stat.isFile()) continue;
      const file: ResolvedFile = { absolute: real, isHtml: /\.html?$/i.test(real), size: stat.size, mtimeMs: stat.mtimeMs };
      if (attempt.needsSlash) file.needsSlash = true;
      return file;
    } catch {
      /* siguiente */
    }
  }
  return null;
}

/** Lee un archivo como ArrayBuffer, que es lo que Response y Hono aceptan sin dudas de tipos. */
export async function readFile(path: string): Promise<ArrayBuffer> {
  const buf = await fs.readFile(path);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/** Lee solo los bytes [start, end] de un archivo (ambos incluidos). */
export async function readRange(path: string, start: number, end: number): Promise<ArrayBuffer> {
  const length = end - start + 1;
  const buf = Buffer.alloc(length);
  const handle = await fs.open(path, 'r');
  try {
    const { bytesRead } = await handle.read(buf, 0, length, start);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + bytesRead) as ArrayBuffer;
  } finally {
    await handle.close();
  }
}

/**
 * Interpreta una cabecera `Range: bytes=a-b` (un solo tramo). Devuelve null si no hay o no se
 * entiende (se responde el archivo entero) y 'invalid' si pide algo fuera del archivo (416).
 * Los celulares la mandan para reproducir video y audio.
 */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | 'invalid' | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start: number;
  let end: number;
  if (m[1] === '') {
    // "bytes=-500": los últimos 500 bytes
    const suffix = Number(m[2]);
    if (suffix === 0) return 'invalid';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return 'invalid';
  return { start, end };
}
