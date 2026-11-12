import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Prototype, Slide, StudyReport } from '@taptana/shared';
import { HeatCanvas } from '@/components/heatmap';
import { fallbackHeight, placePoints } from '@/components/report/logic';
import { SnapshotView } from '@/components/report/snapshot-view';
import { prototypeFrameUrl } from '@/lib/links';
import { SLIDE_H, SLIDE_W } from './fit.ts';
import { heatmapViewport, layoutSlide, type EditKey, type HeatmapShape, type LayoutContext, type TextShape } from './layout.ts';
import { DISPLAY_STACK, FAINT, FONT_STACK, hex, MONO_STACK, MUTED, PAPER, SOFT } from './theme.ts';

export type EditHandler = (key: EditKey, value: string) => void;

/** Una diapositiva escalada a `width` píxeles de ancho (16:9). */
export function ScaledSlide({ width, children, className }: { width: number; children: ReactNode; className?: string }) {
  const scale = width / SLIDE_W;
  return (
    <div className={className} style={{ width, height: Math.round(SLIDE_H * scale), position: 'relative', overflow: 'hidden' }}>
      <div style={{ width: SLIDE_W, height: SLIDE_H, transform: `scale(${scale})`, transformOrigin: 'top left', position: 'absolute', left: 0, top: 0 }}>{children}</div>
    </div>
  );
}

/** Mide el ancho disponible de un contenedor. */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = (): void => setWidth(Math.floor(el.clientWidth));
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

function TextBox({ shape, editable, onEdit }: { shape: TextShape; editable: boolean; onEdit?: EditHandler | undefined }) {
  const canEdit = editable && shape.edit !== undefined && onEdit !== undefined;
  const value = canEdit ? shape.full : shape.text;
  const box: CSSProperties = {
    position: 'absolute',
    left: shape.x,
    top: shape.y,
    width: shape.w,
    height: shape.h,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: shape.valign === 'middle' ? 'center' : shape.valign === 'bottom' ? 'flex-end' : 'flex-start',
    overflow: 'hidden',
  };
  const inner: CSSProperties = {
    fontSize: shape.size,
    lineHeight: shape.lineHeight,
    color: hex(shape.color),
    fontWeight: shape.mono ? (shape.bold ? 500 : 400) : shape.display ? 700 : shape.bold ? 600 : 400,
    ...(shape.display ? { fontFamily: DISPLAY_STACK } : shape.mono ? { fontFamily: MONO_STACK, fontVariantNumeric: 'tabular-nums' } : {}),
    fontStyle: shape.italic ? 'italic' : 'normal',
    textAlign: shape.align ?? 'left',
    letterSpacing: shape.upper ? '0.06em' : shape.display ? '-0.025em' : shape.bold && shape.size >= 36 ? '-0.015em' : undefined,
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: shape.lines,
    overflow: 'hidden',
    overflowWrap: 'anywhere',
    whiteSpace: 'pre-line',
  };
  if (!canEdit) {
    return (
      <div style={box}>
        <div style={inner}>{value}</div>
      </div>
    );
  }
  return (
    <div style={box}>
      <div
        // La clave reinicia el texto cuando cambia desde afuera («Restablecer»).
        key={value}
        className="tt-editable"
        style={inner}
        contentEditable="plaintext-only"
        suppressContentEditableWarning
        role="textbox"
        aria-label={shape.edit === 'title' ? 'Título de la diapositiva' : shape.edit === 'takeaway' ? 'Frase principal' : 'Punto de la lista'}
        spellCheck
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            (e.currentTarget as HTMLElement).blur();
          }
          if (e.key === 'Escape') {
            e.currentTarget.textContent = value;
            (e.currentTarget as HTMLElement).blur();
          }
        }}
        onBlur={(e) => {
          const next = (e.currentTarget.textContent ?? '').replace(/\s+/g, ' ').trim();
          if (!next) e.currentTarget.textContent = value;
          else if (next !== value) onEdit(shape.edit as EditKey, next);
        }}
      >
        {value}
      </div>
    </div>
  );
}

function HeatmapHole({ shape, report, proto, lite, eager }: { shape: HeatmapShape; report: StudyReport; proto: Prototype | undefined; lite: boolean; eager: boolean }) {
  const task = report.tasks.find((t) => t.taskId === shape.blockId);
  const screen = task?.screens.find((s) => s.path === shape.screen);
  const vw = screen?.sample?.vw || screen?.viewportWidth || 390;
  const estimated = useMemo(() => (screen ? fallbackHeight(screen.taps, vw) : 800), [screen, vw]);
  const ok = useMemo(() => new Set((task?.results ?? []).filter((r) => r.outcome === 'direct' || r.outcome === 'indirect').map((r) => r.sessionId)), [task]);
  const frame: CSSProperties = { position: 'absolute', left: shape.x, top: shape.y, width: shape.w, height: shape.h, display: 'flex', alignItems: 'flex-start', justifyContent: 'center' };
  if (lite || !screen) {
    return (
      <div style={frame}>
        <div style={{ width: '100%', height: '100%', borderRadius: 4, background: hex(SOFT), display: 'grid', placeItems: 'center', color: hex(MUTED), fontSize: 22, textAlign: 'center', padding: 24 }}>
          {screen ? `Mapa de «${shape.screenName}»` : 'Esta pantalla ya no está en el reporte'}
        </div>
      </div>
    );
  }
  const liveSrc = proto?.url ? prototypeFrameUrl(proto, { screen: screen.path, preview: true }) : null;
  return (
    <div style={frame} className="tt-deck-map">
      <SnapshotView
        sample={screen.sample}
        viewportWidth={vw}
        displayWidth={shape.w}
        liveSrc={liveSrc}
        estimatedHeight={estimated}
        eager={eager}
        preferNextLoad={screen.taps.length === 0}
        maxHeight={shape.h}
        label={`Pantalla ${shape.screenName} con sus toques`}
      >
        {({ docHeight, scale }) => {
          const points = placePoints(screen.taps, vw, docHeight).shown.map((p) => ({ ...p, ok: ok.has(p.sessionId) }));
          return <HeatCanvas points={points} width={vw} height={docHeight} scale={scale} mode={shape.firstClick ? 'first-click' : 'dots'} />;
        }}
      </SnapshotView>
    </div>
  );
}

/**
 * Una diapositiva a tamaño real (1280×720). `lite` (miniaturas) no dibuja la foto del mapa de
 * calor; `eager` la dibuja aunque no esté a la vista (PDF).
 */
export function SlideCanvas({
  slide,
  ctx,
  report,
  proto,
  editable = false,
  onEdit,
  lite = false,
  eager = false,
}: {
  slide: Slide;
  ctx: LayoutContext;
  report: StudyReport;
  proto: Prototype | undefined;
  editable?: boolean;
  onEdit?: EditHandler;
  lite?: boolean;
  eager?: boolean;
}) {
  const shapes = useMemo(() => layoutSlide(slide, { ...ctx, heatmapViewport: heatmapViewport(slide, report) }), [slide, ctx, report]);
  return (
    <div className="tt-slide" style={{ width: SLIDE_W, height: SLIDE_H, position: 'relative', background: hex(PAPER), color: hex(FAINT), fontFamily: FONT_STACK, overflow: 'hidden' }}>
      {shapes.map((s, i) => {
        switch (s.type) {
          case 'text':
            return <TextBox key={i} shape={s} editable={editable} onEdit={onEdit} />;
          case 'rect':
            return (
              <div
                key={i}
                style={{ position: 'absolute', left: s.x, top: s.y, width: s.w, height: s.h, background: hex(s.fill), borderRadius: s.radius ?? 0, boxShadow: s.line ? `inset 0 0 0 1px ${hex(s.line)}` : undefined }}
              />
            );
          case 'circle':
            return <div key={i} style={{ position: 'absolute', left: s.x, top: s.y, width: s.d, height: s.d, borderRadius: '50%', background: hex(s.fill) }} />;
          case 'heatmap':
            return <HeatmapHole key={i} shape={s} report={report} proto={proto} lite={lite} eager={eager} />;
        }
      })}
    </div>
  );
}
