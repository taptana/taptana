/**
 * Inserta la etiqueta del recorder en un HTML. Antes de </body> si existe; si no, al final.
 */

import { RECORDER_PATH } from '@taptana/shared';

export interface InjectOptions {
  prototypeId: string;
  transport?: 'http' | 'local';
  /** Ruta del script. Por defecto RECORDER_PATH (mismo origen). */
  src?: string;
  /** Prefijo donde se sirve el prototipo ("/p/pr_abc"). */
  base?: string;
}

export function recorderTag(opts: InjectOptions): string {
  const attrs = [`src="${opts.src ?? RECORDER_PATH}"`, `data-prototype="${escapeAttr(opts.prototypeId)}"`];
  if (opts.transport) attrs.push(`data-transport="${opts.transport}"`);
  if (opts.base) attrs.push(`data-base="${escapeAttr(opts.base)}"`);
  return `<script ${attrs.join(' ')}></script>`;
}

export function injectRecorder(html: string, opts: InjectOptions): string {
  if (html.includes(RECORDER_PATH) || html.includes('data-taptana-recorder')) return html;
  const tag = `\n${recorderTag(opts)}\n`;
  const bodyClose = html.search(/<\/body\s*>/i);
  if (bodyClose !== -1) return html.slice(0, bodyClose) + tag + html.slice(bodyClose);
  const htmlClose = html.search(/<\/html\s*>/i);
  if (htmlClose !== -1) return html.slice(0, htmlClose) + tag + html.slice(htmlClose);
  return html + tag;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
