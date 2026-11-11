/**
 * Limpia el HTML de una pantalla para mostrárselo a un modelo: deja la estructura, los textos,
 * los links y los atributos (ids, clases) y quita lo que solo ocupa espacio.
 */

import { RECORDER_PATH } from '@taptana/shared';

/** Lo más que se le entrega a un modelo de una sola página. */
export const SCREEN_HTML_MAX_CHARS = 40_000;

export interface CleanHtml {
  html: string;
  truncated: boolean;
  /** Scripts con código adentro que se vaciaron: si son muchos, la página se arma con JavaScript. */
  scriptsEmptied: number;
  originalChars: number;
}

const kb = (chars: number): string => `${Math.max(1, Math.round(chars / 1024))} KB`;

/** El `<script>` que carga el recorder de Taptana (inyectado o pegado a mano). */
function isRecorderTag(open: string): boolean {
  return open.includes(RECORDER_PATH) || open.includes('data-taptana-recorder') || (/recorder(\.min)?\.js/.test(open) && open.includes('data-prototype'));
}

export function cleanHtml(raw: string, max = SCREEN_HTML_MAX_CHARS): CleanHtml {
  let scriptsEmptied = 0;
  const cleaned = raw
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)\s*/gi, (whole, open: string, body: string, close: string) => {
      // La etiqueta del recorder no es parte del diseño.
      if (isRecorderTag(open)) return '';
      const space = /\s+$/.exec(whole)?.[0] ?? '';
      if (!body.trim()) return `${open}${close}${space}`;
      scriptsEmptied++;
      return `${open}/* código quitado (${kb(body.length)}) */${close}${space}`;
    })
    .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, (_m, open: string, body: string, close: string) =>
      body.trim() ? `${open}/* estilos quitados (${kb(body.length)}) */${close}` : `${open}${close}`,
    )
    // Imágenes y fuentes incrustadas: una línea de base64 puede pesar más que toda la página.
    .replace(/data:[a-z0-9.+-]+\/[a-z0-9.+-]+(?:;[a-z0-9=.+-]+)*,[^"')\s>]{64,}/gi, 'data:…')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const truncated = cleaned.length > max;
  const html = truncated ? cleaned.slice(0, max) : cleaned;
  return { html, truncated, scriptsEmptied, originalChars: raw.length };
}
