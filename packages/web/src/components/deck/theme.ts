/**
 * El tema de la presentación: colores y medidas que comparten la vista en pantalla (y su PDF)
 * y el archivo de PowerPoint, para que se vean igual. Las diapositivas son siempre claras, aunque
 * el panel esté en modo oscuro. Los colores de resultados son los mismos del reporte.
 */

import type { ScoreTone, TaskOutcomeCounts } from '@taptana/shared';

/* Tinta, papel y reglas finas: los mismos de `index.css`, en hexadecimal para PowerPoint. */
export const INK = '151411';
export const MUTED = '51504B';
export const FAINT = '6F6E69';
export const LINE = 'DAD9D5';
/** El hoyo vacío del tablero y las barras que no son la más alta. */
export const HOLE = 'B8B7B3';
export const SOFT = 'F1F0ED';
export const PAPER = 'FFFFFF';

/** El único acento: el resaltador, detrás de la cifra clave de una diapositiva y en el punto «tocado». */
export const MARK = 'F9E03F';

/** Puntaje (los mismos tonos que el reporte: emerald, lime, amber, red). */
export const TONE: Record<ScoreTone, string> = {
  good: '059669',
  ok: '65A30D',
  warn: 'D97706',
  bad: 'DC2626',
  none: FAINT,
};

/** Resultados de una tarea, como en la barra del reporte. */
export const OUTCOME: Record<keyof TaskOutcomeCounts, string> = {
  direct: '059669',
  indirect: '6EE7B7',
  review: '38BDF8',
  reported: 'FBBF24',
  failed: 'EF4444',
  incomplete: 'D4D4D8',
};

/** Tramos claros: el número va en oscuro encima. */
export const OUTCOME_DARK_TEXT: ReadonlySet<keyof TaskOutcomeCounts> = new Set(['indirect', 'review', 'reported', 'incomplete']);

export const PROBLEM = 'D97706';
export const GOOD = '059669';
/** La barra más alta, en tinta; las demás, en gris. */
export const BAR = INK;
export const BAR_MID = HOLE;

/**
 * Fuentes: en pantalla y en el PDF, las del panel (títulos en Bricolage Grotesque, texto en IBM
 * Plex Sans, datos en IBM Plex Mono). En PowerPoint, Arial y Courier New, que están en todas las
 * computadoras: quien abra el archivo no tiene las del panel.
 */
export const DISPLAY_STACK = "'Bricolage Grotesque Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
export const FONT_STACK = "'IBM Plex Sans Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
export const MONO_STACK = "'IBM Plex Mono', ui-monospace, 'SFMono-Regular', Menlo, Consolas, 'Courier New', monospace";
export const PPTX_FONT = 'Arial';
export const PPTX_MONO = 'Courier New';

export const hex = (c: string): string => `#${c}`;

/** Geometría común (px de una diapositiva de 1280×720). */
export const G = {
  x: 72,
  w: 1136,
  eyebrowY: 60,
  titleY: 92,
  titleH: 112,
  footerY: 676,
} as const;
