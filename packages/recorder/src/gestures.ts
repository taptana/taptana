/**
 * Detecta toques y deslizamientos.
 *
 * - tap: dedo baja y sube en menos de 300 ms, moviéndose menos de 10 px.
 * - swipe: dedo baja y sube en menos de 600 ms, moviéndose más de 40 px.
 *   La dirección es la del eje con más desplazamiento.
 * - En laptop (sin táctil) los tap salen del click del mouse. No hay swipe con mouse.
 */

import { GESTURE_THRESHOLDS, type SwipeDirection, type TapEvent, type SwipeEvent } from '@taptana/shared';
import { describeTarget } from './target.js';

type Emit = (event: TapEvent | SwipeEvent) => void;

interface TouchStart {
  x: number;
  y: number;
  t: number;
  target: Element | null;
}

export function watchGestures(emit: Emit): () => void {
  let start: TouchStart | null = null;
  let lastTouchEndAt = 0;

  const onTouchStart = (e: TouchEvent): void => {
    const touch = e.touches[0];
    if (!touch || e.touches.length > 1) {
      start = null;
      return;
    }
    start = {
      x: touch.clientX,
      y: touch.clientY,
      t: Date.now(),
      target: e.target instanceof Element ? e.target : null,
    };
  };

  const onTouchEnd = (e: TouchEvent): void => {
    lastTouchEndAt = Date.now();
    if (!start) return;
    const touch = e.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    const dist = Math.hypot(dx, dy);
    const durationMs = Date.now() - start.t;
    const s = start;
    start = null;

    if (durationMs <= GESTURE_THRESHOLDS.tapMaxMs && dist <= GESTURE_THRESHOLDS.tapMaxPx) {
      const target = s.target ?? document.elementFromPoint(touch.clientX, touch.clientY);
      emit({
        kind: 'taptana',
        type: 'tap',
        t: Date.now(),
        x: Math.round(touch.clientX),
        y: Math.round(touch.clientY),
        target: describeTarget(target ?? document.body),
      });
      return;
    }

    if (durationMs <= GESTURE_THRESHOLDS.swipeMaxMs && dist >= GESTURE_THRESHOLDS.swipeMinPx) {
      let direction: SwipeDirection;
      if (Math.abs(dx) > Math.abs(dy)) direction = dx > 0 ? 'right' : 'left';
      else direction = dy > 0 ? 'down' : 'up';
      emit({
        kind: 'taptana',
        type: 'swipe',
        t: Date.now(),
        direction,
        startX: Math.round(s.x),
        startY: Math.round(s.y),
        endX: Math.round(touch.clientX),
        endY: Math.round(touch.clientY),
        durationMs,
      });
    }
  };

  const onTouchCancel = (): void => {
    start = null;
  };

  // Click de mouse. En táctil también se dispara click después de un tap: lo ignoramos
  // si hubo un touchend hace menos de un segundo, para no contar el toque dos veces.
  const onClick = (e: MouseEvent): void => {
    if (Date.now() - lastTouchEndAt < 1000) return;
    if (!e.isTrusted) return;
    const target = e.target instanceof Element ? e.target : document.body;
    emit({
      kind: 'taptana',
      type: 'tap',
      t: Date.now(),
      x: Math.round(e.clientX),
      y: Math.round(e.clientY),
      target: describeTarget(target),
    });
  };

  const opts: AddEventListenerOptions = { capture: true, passive: true };
  document.addEventListener('touchstart', onTouchStart, opts);
  document.addEventListener('touchend', onTouchEnd, opts);
  document.addEventListener('touchcancel', onTouchCancel, opts);
  document.addEventListener('click', onClick, opts);

  return () => {
    document.removeEventListener('touchstart', onTouchStart, opts);
    document.removeEventListener('touchend', onTouchEnd, opts);
    document.removeEventListener('touchcancel', onTouchCancel, opts);
    document.removeEventListener('click', onClick, opts);
  };
}
