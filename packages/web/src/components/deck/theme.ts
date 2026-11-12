/**
 * El tema de la presentación: colores y medidas que comparten la vista en pantalla (y su PDF)
 * y el archivo de PowerPoint, para que se vean igual. Las diapositivas son siempre claras, aunque
 * el panel esté en modo oscuro. Los colores de resultados son los mismos del reporte.
 */

import type { BrandTone, ScoreTone, TaskOutcomeCounts } from '@taptana/shared';

/* Tinta índigo, grises cálidos y papel: los mismos de `index.css`, en hexadecimal para PowerPoint. */
export const INK = '16152C';
export const MUTED = '616174';
export const FAINT = '767486';
export const LINE = 'E7E2DA';
export const SOFT = 'F5F2EC';
export const PAPER = 'FFFFFF';

/** La marca: violeta de la acción principal y su versión clara (sobre el campo violeta). */
export const VIOLET = '5F3ED8';
export const VIOLET_LIGHT = '8571E3';
export const VIOLET_SOFT = 'EEEBFF';

/** Color pleno de cada tono de marca (puntos y marcas, nunca texto). */
export const BRAND: Record<BrandTone, string> = {
  violet: VIOLET,
  coral: 'FB794A',
  maize: 'F8D14F',
  sky: '25C2C2',
  pink: 'ED458A',
  indigo: '426BCE',
  stone: 'A8A096',
};

/** La tinta de cada tono: texto pequeño sobre blanco con contraste AA. */
export const BRAND_INK: Record<BrandTone, string> = {
  violet: '502CBE',
  coral: 'AA3606',
  maize: '785300',
  sky: '00626C',
  pink: 'B4065F',
  indigo: '23459D',
  stone: '6B6459',
};

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
export const BAR = VIOLET;
/** Las barras que no son la más alta: el mismo tono, más claro. */
export const BAR_MID = 'B9AEEF';
export const BAR_SOFT = 'E7E2DA';

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
