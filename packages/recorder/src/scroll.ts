/**
 * Registra scroll como máximo una vez cada 250 ms mientras se hace scroll, y una vez más al
 * detenerse. `depth` dice qué tan abajo llegó (0 a 1).
 *
 * Mide la ventana y también el contenedor principal con scroll propio: muchas apps de una sola
 * página fijan el <body> y desplazan un <main> con `overflow: auto`.
 */

import { GESTURE_THRESHOLDS, type ScrollEvent } from '@taptana/shared';
import { isOurs } from './screens.js';

type Emit = (event: ScrollEvent) => void;

interface Throttle {
  last: number;
  trailing: number | undefined;
}

function round(depth: number): number {
  return Math.round(Math.min(1, Math.max(0, depth)) * 1000) / 1000;
}

function windowScroll(): ScrollEvent {
  const doc = document.documentElement;
  const total = Math.max(doc.scrollHeight, document.body?.scrollHeight ?? 0, 1);
  return {
    kind: 'taptana',
    type: 'scroll',
    t: Date.now(),
    x: Math.round(window.scrollX),
    y: Math.round(window.scrollY),
    depth: round((window.scrollY + window.innerHeight) / total),
  };
}

function elementScroll(el: Element): ScrollEvent {
  return {
    kind: 'taptana',
    type: 'scroll',
    t: Date.now(),
    x: Math.round(el.scrollLeft),
    y: Math.round(el.scrollTop),
    depth: round((el.scrollTop + el.clientHeight) / Math.max(el.scrollHeight, 1)),
  };
}

/** ¿Es el contenedor principal? Ocupa casi todo el ancho y al menos media pantalla, y desplaza hacia abajo. */
function isMainScroller(el: Element): boolean {
  return (
    el.clientWidth >= window.innerWidth * 0.8 &&
    el.clientHeight >= window.innerHeight * 0.5 &&
    el.scrollHeight > el.clientHeight + 4
  );
}

export function watchScroll(emit: Emit): () => void {
  const throttles = new Map<EventTarget, Throttle>();

  const onScroll = (e: Event): void => {
    const target = e.target;
    let read: () => ScrollEvent;
    if (target === document || target === document.documentElement || target === document.body || target === window) {
      read = windowScroll;
    } else if (target instanceof Element && !isOurs(target) && isMainScroller(target)) {
      read = () => elementScroll(target);
    } else {
      return;
    }
    const key = read === windowScroll ? window : (target as EventTarget);
    let state = throttles.get(key);
    if (!state) {
      state = { last: 0, trailing: undefined };
      throttles.set(key, state);
    }
    const s = state;
    const now = Date.now();
    if (s.trailing !== undefined) clearTimeout(s.trailing);
    if (now - s.last >= GESTURE_THRESHOLDS.scrollThrottleMs) {
      s.last = now;
      emit(read());
    }
    s.trailing = window.setTimeout(() => {
      s.trailing = undefined;
      s.last = Date.now();
      emit(read());
    }, GESTURE_THRESHOLDS.scrollThrottleMs + 50);
  };

  // El scroll de un elemento no burbujea: se escucha en captura desde el documento.
  const options: AddEventListenerOptions = { capture: true, passive: true };
  document.addEventListener('scroll', onScroll, options);
  return () => {
    document.removeEventListener('scroll', onScroll, options);
    for (const s of throttles.values()) if (s.trailing !== undefined) clearTimeout(s.trailing);
    throttles.clear();
  };
}
