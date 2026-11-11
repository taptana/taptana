/**
 * Dónde va cada cosa en una diapositiva. `layoutSlide` convierte una diapositiva (datos de
 * `shared`) en una lista de figuras simples (textos, rectángulos, círculos y el hueco del mapa de
 * calor) con posición en píxeles sobre 1280×720. La vista en pantalla y el PowerPoint dibujan esa
 * misma lista: así se ven igual, y el texto ya viene con un tamaño que cabe en su caja.
 * Sin React ni navegador, con pruebas.
 */

import type { Slide, StudyReport } from '@taptana/shared';
import { countLines, fitList, fitText, SLIDE_H, SLIDE_W } from './fit.ts';
import { BAR, BAR_MID, FAINT, G, GOOD, INK, LINE, MUTED, OUTCOME, OUTCOME_DARK_TEXT, PAPER, PROBLEM, SOFT, TONE } from './theme.ts';

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
  const fit = fitText(opts.upper ? value.toUpperCase() : value, { width: opts.bold ? w * 0.93 : w, height: h }, max, opts.min ?? max, lineHeight);
  const { min: _min, ...rest } = opts;
  return { type: 'text', x, y, w, h, text: fit.text, full: value, size: fit.size, lines: fit.lines, color: INK, ...rest, lineHeight };
}

const rect = (x: number, y: number, w: number, h: number, fill: string, extra: Partial<RectShape> = {}): RectShape => ({ type: 'rect', x, y, w, h, fill, ...extra });
const pct = (x: number): string => `${Math.round(x * 100)} %`;

function eyebrow(value: string, w: number = G.w, x: number = G.x): TextShape {
  return text(value, x, G.eyebrowY, w, 22, 14, { color: MUTED, bold: true, upper: true, min: 11 });
}

function title(slide: Slide, opts: { x?: number; w?: number; h?: number; max?: number; min?: number } = {}): TextShape {
  return text(slide.title, opts.x ?? G.x, G.titleY, opts.w ?? G.w, opts.h ?? G.titleH, opts.max ?? 44, { bold: true, min: opts.min ?? 26, lineHeight: 1.15, edit: 'title' });
}

function footer(ctx: LayoutContext): Shape[] {
  return [
    text(ctx.deckTitle, G.x, G.footerY, 880, 20, 13, { color: FAINT, min: 11 }),
    text(`${ctx.index + 1} / ${ctx.total}`, SLIDE_W - G.x - 160, G.footerY, 160, 20, 13, { color: FAINT, align: 'right' }),
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

function cover(slide: Extract<Slide, { kind: 'cover' }>): Shape[] {
  const out: Shape[] = [eyebrow('Resultados del estudio', 700)];
  if (slide.filter) {
    const w = Math.min(520, slide.filter.length * 8.4 + 40);
    out.push(rect(SLIDE_W - G.x - w, 52, w, 36, SOFT, { radius: 18 }), text(slide.filter, SLIDE_W - G.x - w + 18, 60, w - 36, 22, 15, { color: INK, min: 11, align: 'center' }));
  }
  out.push(text(slide.title, G.x, 196, G.w, 200, 76, { bold: true, min: 40, lineHeight: 1.08, valign: 'bottom', edit: 'title' }));
  out.push(text(slide.subtitle, G.x, 414, G.w, 36, 26, { color: MUTED, min: 18 }));
  if (slide.takeaway !== undefined) out.push(text(slide.takeaway, G.x, 462, 980, 90, 22, { color: MUTED, min: 15, lineHeight: 1.4, edit: 'takeaway' }));
  const items = slide.items ?? [];
  if (items.length) {
    out.push(rect(G.x, 594, G.w, 1, LINE));
    const colW = G.w / Math.max(3, items.length);
    items.forEach((item, i) => out.push(text(item.text, G.x + i * colW, 616, colW - 24, 52, 20, { min: 14, edit: `item:${i}` })));
  }
  out.push(text('Hecho con Taptana', SLIDE_W - G.x - 240, G.footerY, 240, 20, 13, { color: FAINT, align: 'right' }));
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
  const out: Shape[] = [eyebrow('Resumen'), title(slide, { h: 60, max: 44 })];
  // El puntaje, a la izquierda.
  out.push(rect(G.x, 196, 420, 404, SOFT, { radius: 20 }));
  out.push(text('Puntaje de usabilidad', 104, 228, 360, 26, 18, { color: MUTED }));
  const value = slide.score === null ? '—' : String(slide.score);
  out.push(text(value, 104, 262, 240, 150, 140, { bold: true, color: tone, lineHeight: 1 }));
  out.push(text('de 100', 104 + value.length * 80 + 18, 360, 120, 30, 22, { color: MUTED }));
  out.push(text(slide.scoreLabel, 104, 430, 356, 64, 26, { bold: true, color: tone, min: 18, lineHeight: 1.2 }));
  out.push(rect(104, 524, 356, 12, LINE, { radius: 6 }));
  if (slide.score !== null && slide.score > 0) out.push(rect(104, 524, Math.max(12, (356 * slide.score) / 100), 12, tone, { radius: 6 }));
  // Los números, a la derecha, de a dos.
  const x0 = 524;
  const cw = (SLIDE_W - G.x - x0 - 24) / 2;
  const ch = 190;
  slide.metrics.slice(0, 4).forEach((m, i) => {
    const x = x0 + (i % 2) * (cw + 24);
    const y = 196 + Math.floor(i / 2) * (ch + 24);
    out.push(rect(x, y, cw, ch, PAPER, { radius: 20, line: LINE }));
    out.push(text(m.label, x + 28, y + 26, cw - 56, 24, 17, { color: MUTED, min: 13 }));
    out.push(text(m.value, x + 28, y + 58, cw - 56, 64, 54, { bold: true, min: 30, lineHeight: 1.1 }));
    if (m.note) out.push(text(m.note, x + 28, y + 132, cw - 56, 40, 15, { color: MUTED, min: 12 }));
  });
  if (slide.takeaway) out.push(text(slide.takeaway, G.x, 622, G.w, 44, 18, { color: MUTED, min: 13, edit: 'takeaway' }));
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
  const out: Shape[] = [eyebrow(parts || 'Hallazgos'), title(slide, { h: 60 })];
  out.push(...list(slide.items.map((i) => ({ text: i.text, marker: dot(i.tone === 'good' ? GOOD : PROBLEM, G.x) })), { x: G.x, y: 196, w: G.w, h: 430 }, 30, 15, 40));
  out.push({ type: 'circle', x: G.x, y: 643, d: 12, fill: PROBLEM }, text('Por mejorar', G.x + 20, 638, 160, 22, 14, { color: MUTED }));
  out.push({ type: 'circle', x: G.x + 160, y: 643, d: 12, fill: GOOD }, text('Buena noticia', G.x + 180, 638, 180, 22, 14, { color: MUTED }));
  return out;
}

function task(slide: Extract<Slide, { kind: 'task' }>): Shape[] {
  const tone = scoreTone(slide);
  const out: Shape[] = [eyebrow(`${slide.label} · ${slide.participants} ${slide.participants === 1 ? 'participante' : 'participantes'}`, 860)];
  out.push(text(slide.score === null ? '—' : String(slide.score), SLIDE_W - G.x - 200, 46, 200, 66, 60, { bold: true, color: tone, align: 'right', lineHeight: 1.05 }));
  out.push(text('puntaje de 100', SLIDE_W - G.x - 200, 114, 200, 20, 14, { color: MUTED, align: 'right' }));
  out.push(title(slide, { w: 880, h: 104, max: 42, min: 24 }));
  if (slide.instruction) {
    out.push(text('Lo que leyó el participante', G.x, 210, 600, 18, 13, { color: MUTED, bold: true, upper: true }));
    out.push(text(`«${slide.instruction}»`, G.x, 232, G.w, 58, 22, { italic: true, min: 14, lineHeight: 1.3 }));
  }
  // Barra de resultados.
  const by = 308;
  const bh = 48;
  out.push(rect(G.x, by, G.w, bh, SOFT, { radius: 10 }));
  let x = G.x;
  for (const o of slide.outcomes) {
    const w = G.w * o.share;
    if (w <= 0) continue;
    out.push(rect(x, by, w, bh, OUTCOME[o.key]));
    if (o.share >= 0.08) out.push(text(pct(o.share), x, by + 13, w, 22, 17, { bold: true, align: 'center', color: OUTCOME_DARK_TEXT.has(o.key) ? INK : PAPER, min: 12 }));
    x += w;
  }
  // Leyenda.
  let lx = G.x;
  let ly = by + bh + 16;
  for (const o of slide.outcomes) {
    const label = `${o.label}  ${o.count}`;
    const w = label.length * 8.6 + 44;
    if (lx + w > G.x + G.w) {
      lx = G.x;
      ly += 26;
    }
    out.push(rect(lx, ly + 4, 14, 14, OUTCOME[o.key], { radius: 3 }), text(label, lx + 22, ly, w - 22, 22, 16, { color: INK }));
    lx += w;
  }
  // Números.
  const my = 428;
  const mw = G.w / 3;
  slide.metrics.slice(0, 3).forEach((m, i) => {
    const mx = G.x + i * mw;
    out.push(text(m.value, mx, my, mw - 24, 52, 44, { bold: true, min: 28, lineHeight: 1.1 }));
    out.push(text(m.label, mx, my + 56, mw - 24, 22, 16, { color: MUTED }));
    if (m.note) out.push(text(m.note, mx, my + 80, mw - 24, 20, 14, { color: FAINT, min: 11 }));
  });
  if (slide.drop) out.push(text(`↓ ${slide.drop}`, G.x, 544, G.w, 26, 17, { color: 'B45309', min: 12 }));
  if (slide.takeaway) {
    const stripe = slide.takeawayTone === 'good' ? GOOD : PROBLEM;
    out.push(rect(G.x, 584, G.w, 76, SOFT, { radius: 12 }), rect(G.x, 584, 6, 76, stripe));
    out.push(text(slide.takeaway, G.x + 30, 594, G.w - 56, 56, 20, { min: 13, lineHeight: 1.35, valign: 'middle', edit: 'takeaway' }));
  }
  return out;
}

function heatmap(slide: Extract<Slide, { kind: 'heatmap' }>, ctx: LayoutContext): Shape[] {
  const wide = (ctx.heatmapViewport ?? 390) > 700;
  const w = wide ? 560 : 300;
  const out: Shape[] = [{ type: 'heatmap', x: G.x, y: 48, w, h: 612, blockId: slide.blockId, screen: slide.screen, firstClick: slide.firstClick, screenName: slide.screenName }];
  const x = G.x + w + 56;
  const cw = SLIDE_W - G.x - x;
  out.push(eyebrow(slide.firstClick ? 'Primer clic · mapa de toques' : 'Mapa de calor', cw, x));
  out.push(title(slide, { x, w: cw, h: 110, max: 38, min: 22 }));
  if (slide.takeaway) out.push(text(slide.takeaway, x, 214, cw, 120, 22, { color: MUTED, min: 14, lineHeight: 1.4, edit: 'takeaway' }));
  const stats = [
    { label: 'Visitas', value: String(slide.visitors) },
    { label: 'Toques', value: String(slide.taps) },
    { label: 'Sin efecto', value: String(slide.misclicks) },
  ];
  const sw = cw / 3;
  stats.forEach((s, i) => {
    out.push(text(s.value, x + i * sw, 356, sw - 16, 50, 42, { bold: true, color: i === 2 && slide.misclicks > 0 ? TONE.bad : INK, lineHeight: 1.1 }));
    out.push(text(s.label, x + i * sw, 410, sw - 16, 22, 16, { color: MUTED }));
  });
  if (slide.topMisclicks.length) {
    out.push(text('Lo más tocado sin efecto', x, 466, cw, 20, 13, { color: MUTED, bold: true, upper: true }));
    slide.topMisclicks.forEach((m, i) => {
      const y = 496 + i * 42;
      out.push(rect(x, y + 34, cw, 1, LINE));
      out.push(text(`«${m.label}»`, x, y, cw - 120, 30, 19, { min: 13 }));
      out.push(text(m.count === 1 ? '1 vez' : `${m.count} veces`, x + cw - 110, y, 110, 30, 19, { align: 'right', color: MUTED }));
    });
  }
  out.push(text(slide.firstClick ? 'Verde: acertó · Rojo: tocó en otro lado' : 'Azul: toque con efecto · Rojo: toque sin efecto', x, 636, cw, 20, 14, { color: FAINT }));
  return out;
}

function question(slide: Extract<Slide, { kind: 'question' }>): Shape[] {
  const out: Shape[] = [eyebrow(`Pregunta · ${slide.label} · ${slide.responses} ${slide.responses === 1 ? 'respuesta' : 'respuestas'}`), title(slide, { h: 120, max: 40, min: 22 })];
  const top = 240;
  const bottom = 596;
  if (slide.questionKind === 'scale') {
    const avg = slide.average === undefined ? '—' : slide.average.toFixed(1).replace('.', ',');
    out.push(text(avg, G.x, top + 16, 300, 120, 112, { bold: true, lineHeight: 1 }));
    out.push(text(`de ${slide.max ?? ''}, en promedio`, G.x, top + 140, 300, 30, 22, { color: MUTED }));
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
      out.push(rect(bx + (colW - barW) / 2, base - h, barW, h, b.count === maxCount ? BAR : b.count > 0 ? BAR_MID : LINE, { radius: 6 }));
      out.push(text(String(b.count), bx, base - h - 28, colW, 24, 18, { bold: true, align: 'center', color: b.count > 0 ? INK : FAINT }));
      out.push(text(b.label, bx, base + 12, colW, 24, 18, { align: 'center', color: MUTED }));
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
      out.push(rect(qx, qy, cw, ch, SOFT, { radius: 16 }));
      out.push(text(`«${q.text}»`, qx + 28, qy + 24, cw - 56, ch - 72, quotes.length === 1 ? 32 : 24, { min: 13, lineHeight: 1.35 }));
      out.push(text(`— ${q.who}`, qx + 28, qy + ch - 40, cw - 56, 22, 15, { bold: true, color: MUTED }));
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
      out.push(rect(bx, y + (rowH - barH) / 2, bw, barH, SOFT, { radius: 6 }));
      if (b.share > 0) out.push(rect(bx, y + (rowH - barH) / 2, Math.max(8, bw * b.share), barH, b.count === topCount ? BAR : BAR_MID, { radius: 6 }));
      out.push(text(b.value, bx + bw + 16, y + (rowH - 26) / 2, vw, 26, 18, { bold: true, align: 'right' }));
    });
  }
  if (slide.takeaway) out.push(text(slide.takeaway, G.x, 614, G.w, 44, 18, { color: MUTED, min: 13, edit: 'takeaway' }));
  return out;
}

function nextSteps(slide: Extract<Slide, { kind: 'next-steps' }>): Shape[] {
  const out: Shape[] = [eyebrow('Próximos pasos, en orden'), title(slide, { h: 60 })];
  out.push(
    ...list(
      slide.items.map((item, i) => ({
        text: item.text,
        marker: (size: number, y: number): Shape[] => {
          const d = Math.round(Math.max(30, size * 1.3));
          return [
            { type: 'circle', x: G.x, y: y + (size * 1.3 - d) / 2, d, fill: item.tone === 'good' ? GOOD : INK },
            text(String(i + 1), G.x, y + (size * 1.3 - d) / 2, d, d, Math.round(d * 0.5), { bold: true, align: 'center', valign: 'middle', color: PAPER, lineHeight: 1 }),
          ];
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
  const out: Shape[] = [eyebrow('Para leer los números'), title(slide, { h: 60 })];
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
