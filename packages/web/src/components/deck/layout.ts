/**
 * Dónde va cada cosa en una diapositiva. `layoutSlide` convierte una diapositiva (datos de
 * `shared`) en una lista de figuras simples (textos, rectángulos, círculos y el hueco del mapa de
 * calor) con posición en píxeles sobre 1280×720. La vista en pantalla y el PowerPoint dibujan esa
 * misma lista: así se ven igual, y el texto ya viene con un tamaño que cabe en su caja.
 * Sin React ni navegador, con pruebas.
 */

import type { Slide, StudyReport } from '@taptana/shared';
import { countLines, fitList, fitText, SLIDE_H, SLIDE_W } from './fit.ts';
import { BAR, BAR_MID, FAINT, G, GOOD, HOLE, INK, LINE, MARK, MUTED, OUTCOME, OUTCOME_DARK_TEXT, PAPER, PROBLEM, SOFT, TONE } from './theme.ts';

/** Qué texto de la diapositiva edita esta figura: el título, la frase o un punto de la lista. */
export type EditKey = 'title' | 'takeaway' | `item:${number}`;

export interface TextShape {
  type: 'text';
  x: number;
  y: number;
  w: number;
  h: number;
  /** El texto a dibujar (recortado con "…" si no cabía ni con la letra mínima). */
  text: string;
  /** El texto completo, para editarlo. */
  full: string;
  size: number;
  color: string;
  bold?: boolean;
  italic?: boolean;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  lineHeight: number;
  /** Líneas que caben (para recortar en pantalla). */
  lines: number;
  upper?: boolean;
  /** Título: en pantalla y PDF va con la tipografía de marca. */
  display?: boolean;
  /** Voz de datos (antetítulos, etiquetas, contadores): monoespaciada. */
  mono?: boolean;
  edit?: EditKey;
}

export interface RectShape {
  type: 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  radius?: number;
  line?: string;
}

export interface CircleShape {
  type: 'circle';
  x: number;
  y: number;
  d: number;
  fill: string;
}

/** El hueco donde va la foto de la pantalla con sus toques (solo en pantalla y PDF). */
export interface HeatmapShape {
  type: 'heatmap';
  x: number;
  y: number;
  w: number;
  h: number;
  blockId: string;
  screen: string;
  firstClick: boolean;
  screenName: string;
}

export type Shape = TextShape | RectShape | CircleShape | HeatmapShape;

export interface LayoutContext {
  /** Posición (desde 0) entre las diapositivas que se muestran, y cuántas son. */
  index: number;
  total: number;
  deckTitle: string;
  /** Ancho de la pantalla del mapa de calor (px del participante), para elegir el hueco. */
  heatmapViewport?: number;
}

type TextOpts = Partial<Omit<TextShape, 'type' | 'x' | 'y' | 'w' | 'h' | 'text' | 'full' | 'size' | 'lines'>> & { min?: number };

function text(value: string, x: number, y: number, w: number, h: number, max: number, opts: TextOpts = {}): TextShape {
  const lineHeight = opts.lineHeight ?? 1.25;
  // La negrita es un poco más ancha: se mide con una caja algo más angosta.
  // La monoespaciada, también: cada letra ocupa 0,6 em (más el espaciado de las mayúsculas).
  const fit = fitText(opts.upper ? value.toUpperCase() : value, { width: opts.mono ? w * (opts.upper ? 0.74 : 0.82) : opts.bold ? w * 0.93 : w, height: h }, max, opts.min ?? max, lineHeight);
  const { min: _min, ...rest } = opts;
  return { type: 'text', x, y, w, h, text: fit.text, full: value, size: fit.size, lines: fit.lines, color: INK, ...rest, lineHeight };
}

const rect = (x: number, y: number, w: number, h: number, fill: string, extra: Partial<RectShape> = {}): RectShape => ({ type: 'rect', x, y, w, h, fill, ...extra });
const pct = (x: number): string => `${Math.round(x * 100)} %`;

/** La etiqueta de arriba: mono, en mayúsculas, gris. */
function eyebrow(value: string, w: number = G.w, x: number = G.x): Shape[] {
  return [label(value, x, G.eyebrowY, w)];
}

/** Una etiqueta en la voz de datos (mono, mayúsculas). */
function label(value: string, x: number, y: number, w: number, opts: TextOpts = {}): TextShape {
  return text(value, x, y, w, 20, 13, { color: MUTED, mono: true, upper: true, min: 11, ...opts });
}

/** El trazo de resaltador detrás de una cifra (`value` con letra `size`, en negrita). */
function mark(value: string, x: number, y: number, size: number): RectShape {
  return rect(x - size * 0.12, y + size * 0.1, value.length * size * 0.56 + size * 0.24, size * 0.98, MARK, { radius: 3 });
}

/** Un hoyo vacío del tablero: un aro fino (dos círculos). */
function hole(cx: number, cy: number, d: number): Shape[] {
  return [
    { type: 'circle', x: cx - d / 2, y: cy - d / 2, d, fill: HOLE },
    { type: 'circle', x: cx - d / 2 + 1.5, y: cy - d / 2 + 1.5, d: d - 3, fill: PAPER },
  ];
}

/** El tablero de 100 puntos: tantos llenos como puntos tiene el puntaje, en el color de su tramo. */
function dotBoard(score: number | null, x: number, y: number, size: number, color: string): Shape[] {
  const step = size / 10;
  const d = step * 0.66;
  const filled = score === null ? 0 : Math.max(0, Math.min(100, Math.round(score)));
  const out: Shape[] = [];
  for (let i = 0; i < 100; i++) {
    const cx = x + step / 2 + (i % 10) * step;
    const cy = y + step / 2 + Math.floor(i / 10) * step;
    if (i < filled) out.push({ type: 'circle', x: cx - d / 2, y: cy - d / 2, d, fill: color });
    else out.push(...hole(cx, cy, d * 0.88));
  }
  return out;
}

/** La fila de diez puntos (uno por cada diez del puntaje), alineada a la derecha en `right`. */
function dotRow(score: number | null, right: number, y: number, color: string): Shape[] {
  const d = 10;
  const step = 15;
  const filled = score === null ? 0 : Math.max(0, Math.min(10, Math.round(score / 10)));
  const x0 = right - 9 * step - d;
  const out: Shape[] = [];
  for (let i = 0; i < 10; i++) {
    if (i < filled) out.push({ type: 'circle', x: x0 + i * step, y, d, fill: color });
    else out.push(...hole(x0 + i * step + d / 2, y + d / 2, d - 1));
  }
  return out;
}

/** La marca, dibujada con figuras: el tablero de tinta con sus nueve hoyos de papel y uno «tocado». */
function logoMark(x: number, y: number, s: number): Shape[] {
  const u = s / 32;
  const out: Shape[] = [rect(x, y, s, s, INK, { radius: 7 * u })];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) {
      const cx = x + (9 + c * 7) * u;
      const cy = y + (9 + r * 7) * u;
      const tap = r === 1 && c === 2;
      const d = (tap ? 6.2 : 3.8) * u;
      out.push({ type: 'circle', x: cx - d / 2, y: cy - d / 2, d, fill: tap ? MARK : PAPER });
    }
  return out;
}

function title(slide: Slide, opts: { x?: number; w?: number; h?: number; max?: number; min?: number } = {}): TextShape {
  return text(slide.title, opts.x ?? G.x, G.titleY, opts.w ?? G.w, opts.h ?? G.titleH, opts.max ?? 44, { bold: true, display: true, min: opts.min ?? 26, lineHeight: 1.15, edit: 'title' });
}

function footer(ctx: LayoutContext): Shape[] {
  return [
    ...logoMark(G.x, G.footerY - 1, 20),
    text(ctx.deckTitle, G.x + 30, G.footerY, 850, 20, 13, { color: FAINT, min: 11 }),
    text(`${String(ctx.index + 1).padStart(2, '0')} / ${String(ctx.total).padStart(2, '0')}`, SLIDE_W - G.x - 160, G.footerY, 160, 20, 13, { color: FAINT, align: 'right', mono: true }),
  ];
}

/** Una lista con marcas a la izquierda, todas con el mismo tamaño de letra. */
function list(
  items: ReadonlyArray<{ text: string; marker: Shape[] | ((size: number, y: number) => Shape[]) }>,
  box: { x: number; y: number; w: number; h: number },
  max: number,
  min: number,
  indent: number,
): Shape[] {
  const lh = 1.3;
  const gap = 0.9;
  const width = box.w - indent;
  const size = fitList(
    items.map((i) => i.text),
    { width, height: box.h },
    max,
    min,
    { lineHeight: lh, gap },
  );
  const out: Shape[] = [];
  let y = box.y;
  const bottom = box.y + box.h;
  items.forEach((item, i) => {
    const left = bottom - y;
    if (left < size * lh) return;
    const t = text(item.text, box.x + indent, y, width, left, size, { min, lineHeight: lh, edit: `item:${i}` });
    const used = Math.min(left, countLines(t.text, width, t.size) * t.size * lh);
    t.h = used;
    const marker = typeof item.marker === 'function' ? item.marker(size, y) : item.marker;
    out.push(...marker, t);
    y += used + size * gap;
  });
  return out;
}

function scoreTone(slide: { tone: keyof typeof TONE }): string {
  return TONE[slide.tone];
}

// ── Cada tipo de diapositiva ──

/** Ancho del tablero de puntos de la portada, a la derecha. */
const COVER_FIELD = 384;

function cover(slide: Extract<Slide, { kind: 'cover' }>): Shape[] {
  const w = SLIDE_W - COVER_FIELD - G.x - 56;
  const out: Shape[] = [...eyebrow('Resultados del estudio', w)];
  if (slide.filter) {
    const fw = Math.min(w, slide.filter.length * 8.4 + 32);
    out.push(rect(G.x, 100, fw, 32, PAPER, { radius: 3, line: HOLE }), text(slide.filter, G.x + 14, 106, fw - 28, 22, 15, { color: INK, min: 12 }));
  }
  out.push(text(slide.title, G.x, 176, w, 220, 76, { bold: true, display: true, min: 40, lineHeight: 1.04, valign: 'bottom', edit: 'title' }));
  out.push(text(slide.subtitle, G.x, 414, w, 36, 26, { color: MUTED, min: 18 }));
  if (slide.takeaway !== undefined) out.push(text(slide.takeaway, G.x, 462, w, 90, 22, { color: MUTED, min: 15, lineHeight: 1.4, edit: 'takeaway' }));
  const items = slide.items ?? [];
  if (items.length) {
    out.push(rect(G.x, 582, w, 1.5, INK));
    const colW = w / Math.max(3, items.length);
    items.forEach((item, i) => out.push(text(item.text, G.x + i * colW, 598, colW - 24, 56, 18, { min: 13, edit: `item:${i}` })));
  }
  out.push(...logoMark(G.x, G.footerY - 3, 24), text('Hecho con Taptana', G.x + 34, G.footerY, 300, 20, 13, { color: MUTED }));

  // El tablero grande, con el camino de una persona: toques numerados en tinta y el último con resaltador.
  const fx = SLIDE_W - COVER_FIELD;
  out.push(rect(fx, 0, 1, SLIDE_H, LINE));
  const step = 64;
  const at = (c: number, r: number): [number, number] => [fx + 64 + c * step, 104 + r * step];
  const path: Array<[number, number]> = [
    [0, 1],
    [3, 1],
    [3, 3],
    [1, 3],
    [1, 6],
    [4, 6],
  ];
  for (let r = 0; r < 9; r++) for (let c = 0; c < 5; c++) out.push({ type: 'circle', x: at(c, r)[0] - 3.5, y: at(c, r)[1] - 3.5, d: 7, fill: HOLE });
  path.slice(1).forEach(([c, r], i) => {
    const [x1, y1] = at(...(path[i] as [number, number]));
    const [x2, y2] = at(c, r);
    out.push(rect(Math.min(x1, x2) - 0.75, Math.min(y1, y2) - 0.75, Math.abs(x2 - x1) + 1.5, Math.abs(y2 - y1) + 1.5, INK));
  });
  path.forEach(([c, r], i) => {
    const [cx, cy] = at(c, r);
    const last = i === path.length - 1;
    const d = last ? 44 : 34;
    if (last) out.push({ type: 'circle', x: cx - d / 2 - 2, y: cy - d / 2 - 2, d: d + 4, fill: INK });
    out.push({ type: 'circle', x: cx - d / 2, y: cy - d / 2, d, fill: last ? MARK : INK });
    out.push(text(String(i + 1), cx - d / 2, cy - d / 2, d, d, last ? 18 : 15, { mono: true, align: 'center', valign: 'middle', color: last ? INK : PAPER, lineHeight: 1 }));
  });
  return out;
}

function empty(slide: Extract<Slide, { kind: 'empty' }>): Shape[] {
  return [
    text(slide.title, G.x, 250, G.w, 110, 52, { bold: true, min: 32, align: 'center', valign: 'bottom', edit: 'title' }),
    text(slide.takeaway ?? '', 192, 380, 896, 100, 24, { color: MUTED, min: 16, align: 'center', lineHeight: 1.4, edit: 'takeaway' }),
  ];
}

function summary(slide: Extract<Slide, { kind: 'summary' }>): Shape[] {
  const tone = scoreTone(slide);
  const out: Shape[] = [...eyebrow('Resumen'), title(slide, { h: 60, max: 44 })];
  // Arriba: el puntaje en su tablero de 100 puntos, el número y la frase.
  const top = 192;
  out.push(...dotBoard(slide.score, G.x, top, 250, tone));
  const sx = G.x + 250 + 44;
  out.push(label('Puntaje de usabilidad', sx, top + 4, 300));
  const value = slide.score === null ? '—' : String(slide.score);
  out.push(text(value, sx, top + 30, 260, 136, 128, { bold: true, display: true, lineHeight: 1 }));
  out.push(label('de 100', sx + value.length * 74 + 14, top + 126, 100, { upper: false }));
  out.push({ type: 'circle', x: sx, y: top + 192, d: 14, fill: tone });
  out.push(text(slide.scoreLabel, sx + 24, top + 180, 300, 60, 24, { bold: true, min: 17, lineHeight: 1.2 }));
  const tx = 760;
  if (slide.takeaway) {
    out.push(rect(tx - 28, top + 4, 1, 242, LINE));
    out.push(text(slide.takeaway, tx, top, SLIDE_W - G.x - tx, 250, 24, { min: 14, lineHeight: 1.4, valign: 'middle', edit: 'takeaway' }));
  }
  // Abajo: los cuatro números en una sola fila con reglas.
  const y = 478;
  const metrics = slide.metrics.slice(0, 4);
  const cw = G.w / Math.max(1, metrics.length);
  out.push(rect(G.x, y, G.w, 1.5, INK));
  metrics.forEach((m, i) => {
    const x = G.x + i * cw + (i === 0 ? 0 : 24);
    const w = cw - (i === 0 ? 24 : 48);
    if (i > 0) out.push(rect(G.x + i * cw, y + 20, 1, 152, LINE));
    out.push(label(m.label, x, y + 22, w));
    out.push(text(m.value, x, y + 52, w, 62, 52, { bold: true, display: true, min: 28, lineHeight: 1.1 }));
    if (m.note) out.push(text(m.note, x, y + 124, w, 42, 15, { color: MUTED, min: 12 }));
  });
  return out;
}

function dot(color: string, x: number) {
  return (size: number, y: number): Shape[] => {
    const d = Math.round(size * 0.5);
    return [{ type: 'circle', x, y: y + (size * 1.3 - d) / 2, d, fill: color }];
  };
}

function highlights(slide: Extract<Slide, { kind: 'highlights' }>): Shape[] {
  const problems = slide.items.filter((i) => i.tone !== 'good').length;
  const goods = slide.items.length - problems;
  const parts = [problems && `${problems} por mejorar`, goods && `${goods} ${goods === 1 ? 'buena noticia' : 'buenas noticias'}`].filter(Boolean).join(' · ');
  const out: Shape[] = [...eyebrow(parts || 'Hallazgos'), title(slide, { h: 60 })];
  out.push(...list(slide.items.map((i) => ({ text: i.text, marker: dot(i.tone === 'good' ? GOOD : PROBLEM, G.x) })), { x: G.x, y: 196, w: G.w, h: 430 }, 30, 15, 40));
  out.push({ type: 'circle', x: G.x, y: 643, d: 12, fill: PROBLEM }, text('Por mejorar', G.x + 20, 638, 160, 22, 14, { color: MUTED }));
  out.push({ type: 'circle', x: G.x + 160, y: 643, d: 12, fill: GOOD }, text('Buena noticia', G.x + 180, 638, 180, 22, 14, { color: MUTED }));
  return out;
}

function task(slide: Extract<Slide, { kind: 'task' }>): Shape[] {
  const tone = scoreTone(slide);
  const out: Shape[] = [...eyebrow(`${slide.label} · ${slide.participants} ${slide.participants === 1 ? 'participante' : 'participantes'}`, 860)];
  const right = SLIDE_W - G.x;
  out.push(text(slide.score === null ? '—' : String(slide.score), right - 200, 44, 200, 66, 60, { bold: true, display: true, align: 'right', lineHeight: 1.05 }));
  out.push(...dotRow(slide.score, right, 116, tone));
  out.push(label('Puntaje de 100', right - 200, 136, 200, { align: 'right' }));
  out.push(title(slide, { w: 880, h: 104, max: 42, min: 24 }));
  if (slide.instruction) {
    out.push(label('Lo que leyó el participante', G.x, 210, 600));
    out.push(text(`«${slide.instruction}»`, G.x, 234, G.w, 58, 22, { italic: true, min: 14, lineHeight: 1.3 }));
  }
  // Barra de resultados.
  const by = 310;
  const bh = 44;
  out.push(rect(G.x, by, G.w, bh, SOFT, { radius: 2 }));
  let x = G.x;
  for (const o of slide.outcomes) {
    const w = G.w * o.share;
    if (w <= 0) continue;
    out.push(rect(x, by, w, bh, OUTCOME[o.key]));
    if (o.share >= 0.08) out.push(text(pct(o.share), x, by + 12, w, 22, 16, { mono: true, align: 'center', color: OUTCOME_DARK_TEXT.has(o.key) ? INK : PAPER, min: 12 }));
    x += w;
  }
  // Leyenda.
  let lx = G.x;
  let ly = by + bh + 14;
  for (const o of slide.outcomes) {
    const text_ = `${o.label}  ${o.count}`;
    const w = text_.length * 8.6 + 44;
    if (lx + w > G.x + G.w) {
      lx = G.x;
      ly += 26;
    }
    out.push(rect(lx, ly + 5, 12, 12, OUTCOME[o.key], { radius: 2 }), text(text_, lx + 22, ly, w - 22, 22, 16, { color: INK }));
    lx += w;
  }
  // Números: una fila con reglas; la primera cifra (cuántos lo lograron) lleva el resaltador.
  const my = 424;
  const metrics = slide.metrics.slice(0, 3);
  const mw = G.w / 3;
  out.push(rect(G.x, my, G.w, 1.5, INK));
  metrics.forEach((m, i) => {
    const mx = G.x + i * mw + (i === 0 ? 0 : 24);
    const w = mw - (i === 0 ? 24 : 48);
    if (i > 0) out.push(rect(G.x + i * mw, my + 14, 1, 104, LINE));
    out.push(label(m.label, mx, my + 16, w));
    const value = text(m.value, mx, my + 40, w, 50, 42, { bold: true, display: true, min: 28, lineHeight: 1.1 });
    if (i === 0 && /\d/.test(m.value)) out.push(mark(value.text, mx, my + 40, value.size));
    out.push(value);
    if (m.note) out.push(text(m.note, mx, my + 96, w, 20, 14, { color: MUTED, min: 11 }));
  });
  if (slide.drop) out.push(text(`↓ ${slide.drop}`, G.x, 552, G.w, 24, 16, { color: 'B45309', min: 12 }));
  if (slide.takeaway) {
    const stripe = slide.takeawayTone === 'good' ? GOOD : PROBLEM;
    out.push(rect(G.x, 590, 4, 66, stripe));
    out.push(text(slide.takeaway, G.x + 24, 590, G.w - 24, 66, 20, { min: 13, lineHeight: 1.35, valign: 'middle', edit: 'takeaway' }));
  }
  return out;
}

function heatmap(slide: Extract<Slide, { kind: 'heatmap' }>, ctx: LayoutContext): Shape[] {
  const wide = (ctx.heatmapViewport ?? 390) > 700;
  const w = wide ? 560 : 300;
  const out: Shape[] = [{ type: 'heatmap', x: G.x, y: 48, w, h: 612, blockId: slide.blockId, screen: slide.screen, firstClick: slide.firstClick, screenName: slide.screenName }];
  const x = G.x + w + 56;
  const cw = SLIDE_W - G.x - x;
  out.push(...eyebrow(slide.firstClick ? 'Primer clic · mapa de toques' : 'Mapa de calor', cw, x));
  out.push(title(slide, { x, w: cw, h: 110, max: 38, min: 22 }));
  if (slide.takeaway) out.push(text(slide.takeaway, x, 214, cw, 120, 22, { color: MUTED, min: 14, lineHeight: 1.4, edit: 'takeaway' }));
  const stats = [
    { label: 'Visitas', value: String(slide.visitors) },
    { label: 'Toques', value: String(slide.taps) },
    { label: 'Sin efecto', value: String(slide.misclicks) },
  ];
  const sw = cw / 3;
  stats.forEach((s, i) => {
    out.push(text(s.value, x + i * sw, 356, sw - 16, 50, 42, { bold: true, display: true, color: i === 2 && slide.misclicks > 0 ? TONE.bad : INK, lineHeight: 1.1 }));
    out.push(label(s.label, x + i * sw, 410, sw - 16));
  });
  if (slide.topMisclicks.length) {
    out.push(label('Lo más tocado sin efecto', x, 466, cw));
    slide.topMisclicks.forEach((m, i) => {
      const y = 496 + i * 42;
      out.push(rect(x, y + 34, cw, 1, LINE));
      out.push(text(`«${m.label}»`, x, y, cw - 120, 30, 19, { min: 13 }));
      out.push(text(m.count === 1 ? '1 vez' : `${m.count} veces`, x + cw - 110, y + 2, 110, 28, 16, { align: 'right', color: MUTED, mono: true }));
    });
  }
  out.push(text(slide.firstClick ? 'Verde: acertó · Rojo: tocó en otro lado' : 'Azul: toque con efecto · Rojo: toque sin efecto', x, 636, cw, 20, 14, { color: FAINT }));
  return out;
}

function question(slide: Extract<Slide, { kind: 'question' }>): Shape[] {
  const out: Shape[] = [...eyebrow(`Pregunta · ${slide.label} · ${slide.responses} ${slide.responses === 1 ? 'respuesta' : 'respuestas'}`, G.w, G.x), title(slide, { h: 120, max: 40, min: 22 })];
  const top = 240;
  const bottom = 596;
  if (slide.questionKind === 'scale') {
    const avg = slide.average === undefined ? '—' : slide.average.toFixed(1).replace('.', ',');
    if (slide.average !== undefined) out.push(mark(avg, G.x, top + 16, 112));
    out.push(text(avg, G.x, top + 16, 300, 120, 112, { bold: true, display: true, lineHeight: 1 }));
    out.push(label(`de ${slide.max ?? ''}, en promedio`, G.x, top + 146, 300, { upper: false }));
    const bars = slide.bars ?? [];
    const cx = 420;
    const cw = SLIDE_W - G.x - cx;
    const gap = bars.length > 7 ? 12 : 20;
    const colW = (cw - gap * (bars.length - 1)) / Math.max(1, bars.length);
    const barW = Math.min(colW, 72);
    const maxCount = Math.max(1, ...bars.map((b) => b.count));
    const area = 220;
    bars.forEach((b, i) => {
      const bx = cx + i * (colW + gap);
      const h = b.count > 0 ? Math.max(6, (b.count / maxCount) * area) : 4;
      const base = top + 30 + area;
      out.push(rect(bx + (colW - barW) / 2, base - h, barW, h, b.count === maxCount ? BAR : b.count > 0 ? BAR_MID : LINE, { radius: 2 }));
      out.push(text(String(b.count), bx, base - h - 28, colW, 24, 17, { mono: true, align: 'center', color: b.count > 0 ? INK : FAINT }));
      out.push(text(b.label, bx, base + 12, colW, 24, 17, { mono: true, align: 'center', color: MUTED }));
    });
  } else if (slide.questionKind === 'text') {
    const quotes = slide.quotes ?? [];
    const cols = quotes.length === 1 ? 1 : 2;
    const rows = Math.ceil(quotes.length / cols);
    const gap = 24;
    const cw = (G.w - gap * (cols - 1)) / cols;
    const ch = (bottom - top - gap * (rows - 1)) / rows;
    quotes.forEach((q, i) => {
      const qx = G.x + (i % cols) * (cw + gap);
      const qy = top + Math.floor(i / cols) * (ch + gap);
      out.push(rect(qx, qy + 8, 2, ch - 16, INK));
      out.push(text(`«${q.text}»`, qx + 28, qy + 8, cw - 56, ch - 60, quotes.length === 1 ? 32 : 24, { min: 13, lineHeight: 1.35 }));
      out.push(label(q.who, qx + 28, qy + ch - 36, cw - 56));
    });
  } else {
    const bars = slide.bars ?? [];
    const rowH = Math.min(64, (bottom - top) / Math.max(1, bars.length));
    const labelW = 400;
    const bx = G.x + labelW + 24;
    const vw = 140;
    const bw = G.w - labelW - 24 - vw - 16;
    const topCount = Math.max(...bars.map((b) => b.count));
    bars.forEach((b, i) => {
      const y = top + i * rowH;
      const barH = Math.min(30, rowH * 0.55);
      out.push(text(b.label, G.x, y + (rowH - Math.min(rowH, 48)) / 2, labelW, Math.min(rowH, 48), 20, { min: 12, valign: 'middle', lineHeight: 1.2 }));
      out.push(rect(bx, y + (rowH - barH) / 2, bw, barH, SOFT, { radius: 2 }));
      if (b.share > 0) out.push(rect(bx, y + (rowH - barH) / 2, Math.max(8, bw * b.share), barH, b.count === topCount ? BAR : BAR_MID, { radius: 2 }));
      out.push(text(b.value, bx + bw + 16, y + (rowH - 24) / 2, vw, 24, 16, { mono: true, align: 'right' }));
    });
  }
  if (slide.takeaway) out.push(text(slide.takeaway, G.x, 614, G.w, 44, 18, { color: MUTED, min: 13, edit: 'takeaway' }));
  return out;
}

function nextSteps(slide: Extract<Slide, { kind: 'next-steps' }>): Shape[] {
  const out: Shape[] = [...eyebrow('Próximos pasos, en orden'), title(slide, { h: 60 })];
  out.push(
    ...list(
      slide.items.map((item, i) => ({
        text: item.text,
        marker: (size: number, y: number): Shape[] => {
          const n = Math.round(Math.max(15, size * 0.72));
          return [text(String(i + 1).padStart(2, '0'), G.x, y + (size * 1.3 - n * 1.3) / 2 + 1, 48, n * 1.3, n, { mono: true, color: item.tone === 'good' ? GOOD : MUTED, lineHeight: 1.3 })];
        },
      })),
      { x: G.x, y: 200, w: G.w, h: 450 },
      30,
      15,
      64,
    ),
  );
  return out;
}

function method(slide: Extract<Slide, { kind: 'method' }>): Shape[] {
  const out: Shape[] = [...eyebrow('Para leer los números'), title(slide, { h: 60 })];
  out.push(...list(slide.items.map((i) => ({ text: i.text, marker: dot(FAINT, G.x + 4) })), { x: G.x, y: 196, w: G.w, h: 460 }, 22, 12, 32));
  return out;
}

/** El ancho de la pantalla del mapa de una diapositiva (para elegir el hueco). */
export function heatmapViewport(slide: Slide, report: Pick<StudyReport, 'tasks'>): number | undefined {
  if (slide.kind !== 'heatmap') return undefined;
  const screen = report.tasks.find((t) => t.taskId === slide.blockId)?.screens.find((s) => s.path === slide.screen);
  return screen ? screen.sample?.vw || screen.viewportWidth || 390 : undefined;
}

export function layoutSlide(slide: Slide, ctx: LayoutContext): Shape[] {
  let shapes: Shape[];
  switch (slide.kind) {
    case 'cover':
      return cover(slide);
    case 'empty':
      shapes = empty(slide);
      break;
    case 'summary':
      shapes = summary(slide);
      break;
    case 'highlights':
      shapes = highlights(slide);
      break;
    case 'task':
      shapes = task(slide);
      break;
    case 'heatmap':
      shapes = heatmap(slide, ctx);
      break;
    case 'question':
      shapes = question(slide);
      break;
    case 'next-steps':
      shapes = nextSteps(slide);
      break;
    case 'method':
      shapes = method(slide);
      break;
  }
  return [...shapes, ...footer(ctx)];
}

/** Para las pruebas: ¿todas las figuras caen dentro de la diapositiva? */
export function outOfBounds(shapes: readonly Shape[]): Shape[] {
  return shapes.filter((s) => {
    const w = s.type === 'circle' ? s.d : s.w;
    const h = s.type === 'circle' ? s.d : s.h;
    return s.x < -0.5 || s.y < -0.5 || s.x + w > SLIDE_W + 0.5 || s.y + h > SLIDE_H + 0.5;
  });
}
