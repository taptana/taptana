import { useEffect, useRef, useState } from 'react';
import type { HeatPoint } from '@taptana/shared';

/**
 * Mapa de calor sobre la pantalla real del prototipo.
 *
 * Carga la página en un iframe a la medida del celular del participante (sin grabar: el recorder
 * se apaga con ?taptana-preview) y dibuja los toques encima. Rojo intenso = muchos toques.
 * Con `misclicksOnly`, solo los toques que no cayeron en nada tocable.
 */
export function Heatmap({
  src,
  points,
  viewportWidth,
  displayWidth = 260,
  mode = 'heat',
}: {
  src: string | null;
  points: HeatPoint[];
  viewportWidth: number;
  displayWidth?: number;
  mode?: 'heat' | 'dots' | 'misclicks';
}) {
  const [height, setHeight] = useState(Math.round(viewportWidth * 1.9));
  const [failed, setFailed] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const scale = displayWidth / viewportWidth;
  const maxY = Math.max(height, ...points.map((p) => p.y + 40));

  const onLoad = (): void => {
    try {
      const doc = frame.current?.contentDocument;
      const h = doc ? Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0) : 0;
      if (h > 0) setHeight(Math.min(h, 4000));
    } catch {
      /* otro origen: dejamos la altura estimada */
    }
  };

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = displayWidth * dpr;
    c.height = maxY * scale * dpr;
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, displayWidth, maxY * scale);
    const shown = mode === 'misclicks' ? points.filter((p) => p.misclick) : points;
    const pos = (p: HeatPoint) => ({ x: (p.x * viewportWidth) / (p.vw || viewportWidth) * scale, y: p.y * scale });

    if (mode === 'dots' || mode === 'misclicks') {
      for (const p of shown) {
        const { x, y } = pos(p);
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fillStyle = p.misclick ? 'rgba(220,38,38,.75)' : 'rgba(37,99,235,.7)';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
      }
      return;
    }

    // Mapa de calor: intensidad acumulada en escala de grises, luego coloreada.
    const off = document.createElement('canvas');
    off.width = c.width;
    off.height = c.height;
    const o = off.getContext('2d')!;
    o.scale(dpr, dpr);
    const r = 26;
    for (const p of shown) {
      const { x, y } = pos(p);
      const g = o.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(0,0,0,0.35)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      o.fillStyle = g;
      o.fillRect(x - r, y - r, r * 2, r * 2);
    }
    const img = o.getImageData(0, 0, off.width, off.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3]! / 255;
      if (a === 0) continue;
      // azul → verde → amarillo → rojo
      const t = Math.min(1, a * 1.6);
      const [rC, gC, bC] = t < 0.33 ? [0, t * 3 * 255, 255] : t < 0.66 ? [(t - 0.33) * 3 * 255, 255, 255 - (t - 0.33) * 3 * 255] : [255, 255 - (t - 0.66) * 3 * 255, 0];
      d[i] = rC;
      d[i + 1] = gC;
      d[i + 2] = bC;
      d[i + 3] = Math.min(220, 60 + a * 400);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.putImageData(img, 0, 0);
  }, [points, mode, displayWidth, viewportWidth, scale, maxY]);

  return (
    <div className="relative overflow-hidden rounded-xl border bg-white shadow-sm" style={{ width: displayWidth, height: Math.min(maxY * scale, 640) }}>
      <div className="absolute inset-0 overflow-y-auto overflow-x-hidden">
        <div className="relative" style={{ width: displayWidth, height: maxY * scale }}>
          {src && !failed ? (
            <iframe
              ref={frame}
              name="taptana-preview"
              src={src}
              title="Vista de la pantalla"
              onLoad={onLoad}
              onError={() => setFailed(true)}
              tabIndex={-1}
              className="absolute top-0 left-0 origin-top-left pointer-events-none border-0 bg-white"
              style={{ width: viewportWidth, height: maxY, transform: `scale(${scale})` }}
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground bg-muted">Sin vista previa</div>
          )}
          <canvas ref={canvas} className="absolute top-0 left-0 pointer-events-none" style={{ width: displayWidth, height: maxY * scale }} />
        </div>
      </div>
    </div>
  );
}
