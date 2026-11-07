/**
 * Lista los HTML de la carpeta del prototipo, con su <title>, para los desplegables del
 * constructor de estudios y para el prompt que se copia a la IA.
 */

import { promises as fs } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.git', '.taptana', 'dist']);
const MAX_PAGES = 200;

export interface PrototypePage {
  path: string;
  title: string;
}

export async function listPrototypePages(root: string): Promise<PrototypePage[]> {
  const out: PrototypePage[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= MAX_PAGES) return;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) await walk(full);
      } else if (/\.html?$/i.test(entry.name)) {
        const rel = '/' + relative(root, full).split(sep).join('/');
        let title = '';
        try {
          const html = await fs.readFile(full, 'utf8');
          title = (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? '').trim();
        } catch {
          /* sin título */
        }
        out.push({ path: rel, title });
      }
    }
  }
  await walk(root);
  return out.sort((a, b) => (a.path === '/index.html' ? -1 : b.path === '/index.html' ? 1 : a.path.localeCompare(b.path)));
}
