/**
 * Cálculos del reporte que no dependen de React ni del navegador: dónde cae cada toque sobre la
 * foto de la pantalla, cómo se lee el puntaje y cómo se explica el embudo. Con pruebas.
 */

import { similarWidth, type HeatPoint, type SuccessRule, type TaskOutcomeCounts, type TaskReport } from '@taptana/shared';

export type ScoreTone = 'good' | 'ok' | 'warn' | 'bad' | 'none';

/** Cómo se lee un puntaje de usabilidad (0 a 100). */
export function scoreBand(score: number | null | undefined): { tone: ScoreTone; label: string } {
  if (score === null || score === undefined || Number.isNaN(score)) return { tone: 'none', label: 'Sin datos todavía' };
  if (score >= 80) return { tone: 'good', label: 'Muy bien' };
  if (score >= 60) return { tone: 'ok', label: 'Bien, con detalles por pulir' };
  if (score >= 40) return { tone: 'warn', label: 'Necesita trabajo' };
  return { tone: 'bad', label: 'Con problemas serios' };
}

export interface PlacedPoint {
  /** Posición sobre la foto, en píxeles CSS de la pantalla de muestra. */
  x: number;
  y: number;
  misclick: boolean;
  sessionId: string;
}

/**
 * Coloca los toques sobre la foto de la pantalla (de ancho `sampleWidth` y alto `docHeight`).
 *
 * - Solo entran los toques hechos en pantallas de ancho parecido al de la foto (±20 %); los
 *   demás se cuentan en `left` para avisar cuántos quedaron fuera.
 * - X se escala por el ancho. Y no: en un diseño adaptable el contenido ocupa el ancho
 *   disponible pero conserva su alto.
 * - Un toque en un elemento fijo (barra inferior, botón flotante) se dibuja respecto al borde
 *   de pantalla al que pertenece: mitad de abajo → pegado al final de la foto; mitad de arriba
 *   → pegado al inicio.
 */
export function placePoints(points: readonly HeatPoint[], sampleWidth: number, docHeight: number): { shown: PlacedPoint[]; left: number } {
  const shown: PlacedPoint[] = [];
  let left = 0;
  for (const p of points) {
    const vw = p.vw > 0 ? p.vw : sampleWidth;
    if (!similarWidth(vw, sampleWidth)) {
      left++;
      continue;
    }
    let y = p.y;
    if (p.fixed && typeof p.vy === 'number') {
      const vh = typeof p.vh === 'number' && p.vh > 0 ? p.vh : docHeight;
      y = p.vy > vh / 2 ? docHeight - (vh - p.vy) : p.vy;
    }
    shown.push({
      x: Math.min(sampleWidth, Math.max(0, (p.x * sampleWidth) / vw)),
      y: Math.min(docHeight, Math.max(0, y)),
      misclick: p.misclick,
      sessionId: p.sessionId,
    });
  }
  return { shown, left };
}

/** Alto a usar cuando no hay foto de la pantalla: que quepan todos los toques. */
export function fallbackHeight(points: readonly HeatPoint[], viewportWidth: number): number {
  let h = Math.round(viewportWidth * 1.9);
  for (const p of points) {
    if (p.fixed) {
      if (typeof p.vh === 'number') h = Math.max(h, p.vh);
    } else h = Math.max(h, p.y + 40);
  }
  return Math.min(h, 6000);
}

const people = (n: number, one: string, many: string): string => (n === 1 ? `1 persona ${one}` : `${n} personas ${many}`);

export interface FunnelStep {
  path: string;
  reached: number;
  /** Sobre quienes empezaron la tarea, 0 a 1. */
  rate: number;
  /** Cuántos se quedaron entre el paso anterior y este. */
  lost: number;
  /** La caída en palabras ("2 personas no llegaron a «carrito»"), o '' si nadie se quedó. */
  note: string;
}

/** El embudo del camino esperado, con la caída de cada paso explicada en palabras. */
export function funnelSteps(funnel: TaskReport['funnel'], participants: number, nameOf: (path: string) => string): FunnelStep[] {
  return funnel.map((step, i) => {
    const before = i === 0 ? participants : (funnel[i - 1]?.reached ?? participants);
    const lost = Math.max(0, before - step.reached);
    const name = nameOf(step.path);
    let note = '';
    if (lost > 0) {
      note =
        i === 0
          ? `${people(lost, 'no pasó', 'no pasaron')} por «${name}»`
          : `${people(lost, 'no llegó', 'no llegaron')} a «${name}» desde «${nameOf(funnel[i - 1]!.path)}»`;
    }
    return { path: step.path, reached: step.reached, rate: participants > 0 ? step.reached / participants : 0, lost, note };
  });
}

/** Paso con la caída más grande, para resaltarlo. -1 si nadie se quedó en el camino. */
export function biggestDrop(steps: readonly FunnelStep[]): number {
  let at = -1;
  let max = 0;
  steps.forEach((s, i) => {
    if (s.lost > max) {
      max = s.lost;
      at = i;
    }
  });
  return at;
}

/** La regla de éxito de una tarea, en palabras. */
export function ruleText(rule: SuccessRule | undefined, nameOf: (path: string) => string): string {
  if (!rule) return '';
  switch (rule.type) {
    case 'reached':
      return `Se logra al llegar a «${nameOf(rule.path)}»`;
    case 'tapped':
      return `Se logra al tocar ${rule.selector}`;
    case 'visible':
      return rule.text ? `Se logra cuando aparece el texto «${rule.text}»` : `Se logra cuando aparece ${rule.selector ?? 'un elemento'}`;
    case 'manual':
      return 'El resultado lo decides tú al ver la grabación';
  }
}

export const OUTCOME_ORDER: ReadonlyArray<keyof TaskOutcomeCounts> = ['direct', 'indirect', 'review', 'reported', 'failed', 'incomplete'];

/** ¿Dos caminos (listas de pantallas) son el mismo? */
export function samePages(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((p, i) => p === b[i]);
}

/** Milisegundos desde el inicio de la sesión para abrir la grabación en ese instante. */
export function recordingOffset(sessionStartedAt: number | undefined, at: number | undefined, leadMs = 0): number | undefined {
  if (sessionStartedAt === undefined || at === undefined) return undefined;
  return Math.max(0, Math.round(at - sessionStartedAt - leadMs));
}
