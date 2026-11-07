/**
 * Sirve archivos de una carpeta, con cuidado de no salir de ella.
 * Para los HTML, deja que quien llama transforme el contenido (inyectar el recorder).
 */

import { promises as fs } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';

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
  '.mp3': 'audio/mpeg',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
};

export function mimeFor(path: string): string {
  return MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

export interface ResolvedFile {
  absolute: string;
  isHtml: boolean;
}

/**
 * Convierte una ruta de URL en un archivo dentro de `root`, o null si no existe o se sale.
 * `/` y `/carpeta/` buscan index.html. `/pagina` prueba `pagina.html`.
 */
export async function resolveFile(root: string, urlPath: string): Promise<ResolvedFile | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const rootAbs = resolve(root);
  const candidate = normalize(join(rootAbs, decoded));
  if (candidate !== rootAbs && !candidate.startsWith(rootAbs + sep)) return null;

  const tries = [candidate, join(candidate, 'index.html'), `${candidate}.html`];
  for (const path of tries) {
    try {
      const stat = await fs.stat(path);
      if (stat.isFile()) {
        return { absolute: path, isHtml: /\.html?$/i.test(path) };
      }
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
