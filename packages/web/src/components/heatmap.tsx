import { useEffect, useRef } from 'react';

export type HeatMode = 'heat' | 'dots' | 'misclicks' | 'first-click';

export interface HeatDot {
  /** Posición en píxeles CSS de la pantalla del participante (antes de reducir). */
  x: number;
  y: number;
  misclick: boolean;
  /** Solo en primer clic: el toque acertó. */
  ok?: boolean;
}

/**
 * Capa de toques que se dibuja encima de la foto de una pantalla.
 *
 * `width` y `height` son los de la pantalla real; `scale` la reduce al tamaño en que se muestra.
 * Modos: `heat` (rojo intenso = muchos toques), `dots` (cada toque; rojo = misclick),
 * `misclicks` (solo los toques sin efecto) y `first-click` (verde = acertó, rojo = falló).
 */
export function HeatCanvas({ points, width, height, scale, mode }: { points: HeatDot[]; width: number; height: number; scale: number; mode: HeatMode }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    // Un canvas muy grande falla en algunos navegadores: bajamos la densidad si hace falta.
    const dpr = Math.min(window.devicePixelRatio || 1, 2, 8000 / h);
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const shown = mode === 'misclicks' ? points.filter((p) => p.misclick) : points;

    if (mode !== 'heat') {
      for (const p of shown) {
        const bad = mode === 'first-click' ? p.ok !== true : p.misclick;
        ctx.beginPath();
        ctx.arc(p.x * scale, p.y * scale, mode === 'first-click' ? 7 : 6, 0, Math.PI * 2);
        ctx.fillStyle = mode === 'first-click' ? (bad ? 'rgba(220,38,38,.85)' : 'rgba(5,150,105,.85)') : bad ? 'rgba(220,38,38,.8)' : 'rgba(37,99,235,.75)';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
      }
      return;
    }

    // Mapa de calor: se acumula la intensidad en un lienzo aparte y luego se colorea.
    const off = document.createElement('canvas');
    off.width = c.width;
    off.height = c.height;
    const o = off.getContext('2d');
    if (!o || off.width === 0 || off.height === 0) return;
    o.setTransform(dpr, 0, 0, dpr, 0, 0);
    const r = 24;
    for (const p of shown) {
      const x = p.x * scale;
      const y = p.y * scale;
      const g = o.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(0,0,0,0.38)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      o.fillStyle = g;
      o.fillRect(x - r, y - r, r * 2, r * 2);
    }
    const img = o.getImageData(0, 0, off.width, off.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const a = (d[i + 3] as number) / 255;
      if (a === 0) continue;
      // azul → verde → amarillo → rojo
      const t = Math.min(1, a * 1.6);
      const [rC, gC, bC] = t < 0.33 ? [0, t * 3 * 255, 255] : t < 0.66 ? [(t - 0.33) * 3 * 255, 255, 255 - (t - 0.33) * 3 * 255] : [255, 255 - (t - 0.66) * 3 * 255, 0];
      d[i] = rC;
      d[i + 1] = gC;
      d[i + 2] = bC;
      d[i + 3] = Math.min(225, 70 + a * 400);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.putImageData(img, 0, 0);
  }, [points, mode, w, h, scale]);

  return <canvas ref={canvas} aria-hidden="true" className="absolute top-0 left-0 pointer-events-none" style={{ width: w, height: h }} />;
}
