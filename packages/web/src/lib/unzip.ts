/**
 * Lee un .html o .zip en el navegador (modo demo). Mismas reglas que el servidor local:
 * aplana una carpeta única, ignora basura de macOS y ocultos, entrada = index.html o el primer HTML.
 */
import { unzipSync } from 'fflate';

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export interface UnpackedFile {
  path: string; // "/css/app.css"
  data: Uint8Array;
}

export async function unpack(file: File): Promise<{ files: UnpackedFile[]; entryPath: string }> {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('El archivo pesa más de 50 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return { files: [{ path: '/index.html', data: bytes }], entryPath: '/index.html' };
  if (!lower.endsWith('.zip')) throw new Error('Sube un archivo .html o .zip.');

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new Error('No se pudo abrir el zip.');
  }
  const list = Object.entries(entries).filter(
    ([name]) => !name.endsWith('/') && !name.startsWith('__MACOSX/') && !name.split('/').some((p) => p.startsWith('.') || p === '..'),
  );
  if (list.length === 0) throw new Error('El zip está vacío.');
  const tops = new Set(list.map(([n]) => n.split('/')[0]));
  const strip = tops.size === 1 && list.every(([n]) => n.includes('/')) ? `${[...tops][0]}/` : '';
  const files = list.map(([name, data]) => ({ path: `/${strip ? name.slice(strip.length) : name}`, data }));
  const htmls = files
    .map((f) => f.path)
    .filter((p) => /\.html?$/i.test(p))
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  if (htmls.length === 0) throw new Error('El zip no tiene ningún archivo .html.');
  return { files, entryPath: htmls.includes('/index.html') ? '/index.html' : htmls[0]! };
}

/** Título de un HTML, para los desplegables del constructor. */
export function htmlTitle(data: Uint8Array): string {
  const head = new TextDecoder().decode(data.subarray(0, 8192));
  return (head.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? '').trim();
}
