/**
 * Registra scroll como máximo una vez cada 250 ms mientras se hace scroll, y una vez más al
 * detenerse. `depth` dice qué tan abajo llegó (0 a 1).
 */

import { GESTURE_THRESHOLDS, type ScrollEvent } from '@taptana/shared';

type Emit = (event: ScrollEvent) => void;

function snapshot(): ScrollEvent {
  const doc = document.documentElement;
  const total = Math.max(doc.scrollHeight, document.body?.scrollHeight ?? 0, 1);
  const depth = Math.min(1, (window.scrollY + window.innerHeight) / total);
  return {
    kind: 'taptana',
    type: 'scroll',
    t: Date.now(),
    x: Math.round(window.scrollX),
    y: Math.round(window.scrollY),
    depth: Math.round(depth * 1000) / 1000,
  };
}

export function watchScroll(emit: Emit): () => void {
  let lastEmit = 0;
  let trailing: number | undefined;

  const onScroll = (): void => {
    const now = Date.now();
    if (trailing !== undefined) clearTimeout(trailing);
    if (now - lastEmit >= GESTURE_THRESHOLDS.scrollThrottleMs) {
      lastEmit = now;
      emit(snapshot());
    }
    trailing = window.setTimeout(() => {
      trailing = undefined;
      lastEmit = Date.now();
      emit(snapshot());
    }, GESTURE_THRESHOLDS.scrollThrottleMs + 50);
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  return () => {
    window.removeEventListener('scroll', onScroll);
    if (trailing !== undefined) clearTimeout(trailing);
  };
}
