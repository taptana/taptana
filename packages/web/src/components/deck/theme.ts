/**
 * El tema de la presentación: colores y medidas que comparten la vista en pantalla (y su PDF)
 * y el archivo de PowerPoint, para que se vean igual. Las diapositivas son siempre claras, aunque
 * el panel esté en modo oscuro. Los colores de resultados son los mismos del reporte.
 */

import type { ScoreTone, TaskOutcomeCounts } from '@taptana/shared';

/* Tinta casi negra, grises neutros y blanco: los mismos de `index.css`, en hexadecimal para PowerPoint. */
export const INK = '18181F';
export const MUTED = '52525C';
export const FAINT = '71717B';
export const LINE = 'E4E4E8';
export const SOFT = 'F4F4F6';
export const PAPER = 'FFFFFF';

/** El único acento: el violeta de la acción principal. */
export const VIOLET = '5F3ED8';
export const VIOLET_SOFT = 'EEEBFF';

/** Los colores del logo (solo para dibujar la marca). */
export const LOGO_TAP = 'FB794A';
export const LOGO_DOT = 'F8D14F';

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
export const BAR_MID = 'A1A1AA';

/**
 * Fuente: la del sistema en pantalla y Arial en PowerPoint (está en todas las computadoras). Los
 * títulos van con la tipografía de marca en pantalla y en el PDF; en PowerPoint, también Arial,
 * porque quien abra el archivo no la tiene instalada.
 */
export const DISPLAY_STACK = "'Bricolage Grotesque Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
export const FONT_STACK = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
export const PPTX_FONT = 'Arial';

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
