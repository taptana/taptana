/**
 * Que el texto nunca se salga de una diapositiva: elige el tamaño de letra más grande que cabe
 * en una caja y, si ni con el mínimo cabe, recorta con "…". Es una estimación (ancho medio de una
 * letra), la misma para la vista en pantalla y para PowerPoint. Sin React ni navegador, con pruebas.
 */

/** Medidas de una diapositiva en píxeles CSS (16:9). PowerPoint usa las mismas, a 96 por pulgada. */
export const SLIDE_W = 1280;
export const SLIDE_H = 720;
export const SLIDE_PAD = 72;

/** Ancho medio de una letra, en "em", para fuentes sans como Arial o la del sistema. */
const CHAR_EM = 0.5;

/** Cuántas líneas ocupa un texto con ese tamaño de letra y ese ancho (corte por palabras). */
export function countLines(text: string, width: number, size: number, charEm = CHAR_EM): number {
  const perLine = Math.max(1, Math.floor(width / (size * charEm)));
  let lines = 0;
  for (const paragraph of text.split('\n')) {
    let used = 0;
    lines++;
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      let len = word.length;
      if (used > 0 && used + 1 + len <= perLine) {
        used += 1 + len;
        continue;
      }
      if (used > 0) lines++;
      // Una palabra más larga que la línea se parte.
      while (len > perLine) {
        lines++;
        len -= perLine;
      }
      used = len;
    }
  }
  return lines;
}

export interface Fit {
  /** Tamaño de letra en píxeles. */
  size: number;
  /** El texto, recortado con "…" si ni con `min` cabía. */
  text: string;
  /** Líneas que caben en la caja con ese tamaño (para `line-clamp`). */
  lines: number;
}

/**
 * El tamaño más grande, entre `max` y `min`, con el que `text` cabe en `width`×`height`.
 * `lineHeight` es el alto de línea relativo (1,25 = 125 %).
 */
export function fitText(text: string, box: { width: number; height: number }, max: number, min: number, lineHeight = 1.25): Fit {
  const clean = text.trim();
  for (let size = max; size >= min; size--) {
    const lines = countLines(clean, box.width, size);
    if (lines * size * lineHeight <= box.height) return { size, text: clean, lines: Math.max(1, Math.floor(box.height / (size * lineHeight))) };
  }
  const lines = Math.max(1, Math.floor(box.height / (min * lineHeight)));
  let cut = clean;
  while (cut.length > 1 && countLines(`${cut}…`, box.width, min) > lines) {
    const space = cut.lastIndexOf(' ');
    cut = (space > cut.length * 0.5 ? cut.slice(0, space) : cut.slice(0, -1)).replace(/[\s,.;:]+$/, '');
  }
  return { size: min, text: cut === clean ? clean : `${cut}…`, lines };
}

/** Varios textos que comparten una caja (una lista): el mismo tamaño para todos. */
export function fitList(texts: readonly string[], box: { width: number; height: number }, max: number, min: number, opts: { lineHeight?: number; gap?: number } = {}): number {
  const lh = opts.lineHeight ?? 1.3;
  const gap = opts.gap ?? 0.9;
  for (let size = max; size >= min; size--) {
    const total = texts.reduce((a, t) => a + countLines(t, box.width, size) * size * lh, 0) + Math.max(0, texts.length - 1) * size * gap;
    if (total <= box.height) return size;
  }
  return min;
}
