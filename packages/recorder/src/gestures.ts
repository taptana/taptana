/**
 * Detecta toques y deslizamientos.
 *
 * - tap: dedo que baja y sube casi sin moverse (10 px) en hasta 800 ms. En laptop, un clic.
 * - swipe: dedo que baja y sube en menos de 600 ms, moviéndose más de 40 px.
 *
 * Cada toque se avisa de inmediato (`onTap`, para el estudio y el panel), pero el evento se
 * emite cuando se sabe si **tuvo efecto**: si el elemento no es tocable por naturaleza, se
 * esperan hasta 350 ms a que cambie el DOM, la pantalla, el foco o el scroll. Un toque sin
 * efecto sobre algo no tocable es un misclick (`target.interactive === false`). La hora del
 * evento (`t`) es la del toque, no la del final de la espera.
 */

import { GESTURE_THRESHOLDS, type SwipeDirection, type SwipeEvent, type TapEvent } from '@taptana/shared';
import { isOurs } from './screens.js';
import { describeTarget } from './target.js';

/** El clic que el navegador dispara después de un toque llega cerca y pronto. */
const CLICK_AFTER_TAP_MS = 700;
const CLICK_AFTER_TAP_PX = 30;
/** Dos clics casi simultáneos son uno solo (un <label> reenvía el clic a su campo). */
const CLICK_ECHO_MS = 60;
/** Si el DOM ya venía cambiando solo (un reloj, un carrusel), un cambio no prueba nada. */
const NOISE_MS = 400;

export interface GestureOptions {
  emit(event: TapEvent | SwipeEvent): void;
  /** Aviso inmediato de cada toque, con el elemento real. */
  onTap?(tap: TapEvent, element: Element): void;
  /** Última vez que cambió el DOM del prototipo (lo lleva el rastreador de pantallas). */
  lastMutationAt(): number;
}

export interface GestureWatcher {
  stop(): void;
  /** Algo cambió (DOM o pantalla): los toques en espera tuvieron efecto. */
  effect(kind: 'dom' | 'screen'): void;
  /** Emite ya los toques en espera. `unloading`: la página se va, que es un efecto. */
  flush(unloading: boolean): void;
}

interface TouchStart {
  x: number;
  y: number;
  t: number;
  target: Element | null;
  moved: number;
}

/** Cómo estaba la página cuando el dedo (o el mouse) bajó: contra esto se mide el efecto. */
interface Baseline {
  t: number;
  mutationAt: number;
  /** El DOM ya venía cambiando solo: sus cambios no prueban que el toque hizo algo. */
  noisy: boolean;
  focused: Element | null;
  href: string;
}

interface Pending {
  event: TapEvent;
  timer: number;
  base: Baseline;
}

function inFixed(el: Element): boolean {
  for (let node: Element | null = el; node && node !== document.documentElement; node = node.parentElement) {
    try {
      if (getComputedStyle(node).position === 'fixed') return true;
    } catch {
      return false;
    }
  }
  return false;
}

export function watchGestures(opts: GestureOptions): GestureWatcher {
  let start: TouchStart | null = null;
  let lastTap: { x: number; y: number; t: number } | null = null;
  let lastClickAt = 0;
  let down: Baseline | null = null;
  const pending: Pending[] = [];

  const snapshot = (): Baseline => {
    const t = Date.now();
    const mutationAt = opts.lastMutationAt();
    return { t, mutationAt, noisy: t - mutationAt <= NOISE_MS, focused: document.activeElement, href: location.href };
  };

  const settle = (p: Pending, effect: boolean): void => {
    const i = pending.indexOf(p);
    if (i === -1) return;
    pending.splice(i, 1);
    clearTimeout(p.timer);
    if (effect) p.event.target.interactive = true;
    opts.emit(p.event);
  };

  /** ¿Cambió la URL o el foco pasó a otro elemento? (perder el foco no cuenta como efecto) */
  const sideEffect = (base: Baseline): boolean => {
    if (location.href !== base.href) return true;
    const active = document.activeElement;
    return active !== null && active !== document.body && active !== base.focused && !isOurs(active);
  };

  const tap = (element: Element, x: number, y: number): void => {
    const now = Date.now();
    const event: TapEvent = {
      kind: 'taptana',
      type: 'tap',
      t: now,
      x: Math.round(x),
      y: Math.round(y),
      pageX: Math.round(x + window.scrollX),
      pageY: Math.round(y + window.scrollY),
      target: describeTarget(element),
      vh: window.innerHeight,
    };
    if (inFixed(element)) event.fixed = true;
    opts.onTap?.(event, element);

    // La referencia es el momento en que bajó el dedo: un prototipo puede reaccionar ahí mismo.
    const base = down && now - down.t < 1500 ? down : snapshot();
    down = null;
    if (!event.target.interactive && ((!base.noisy && opts.lastMutationAt() > base.mutationAt) || sideEffect(base))) {
      event.target.interactive = true;
    }
    if (event.target.interactive) {
      opts.emit(event);
      return;
    }
    const p: Pending = { event, timer: 0, base };
    p.timer = window.setTimeout(() => settle(p, sideEffect(p.base)), GESTURE_THRESHOLDS.tapEffectMs);
    pending.push(p);
  };

  const onPointerDown = (e: Event): void => {
    down = isOurs(e.target) ? null : snapshot();
  };

  const onTouchStart = (e: TouchEvent): void => {
    const touch = e.touches[0];
    if (!touch || e.touches.length > 1 || isOurs(e.target)) {
      start = null;
      return;
    }
    start = { x: touch.clientX, y: touch.clientY, t: Date.now(), target: e.target instanceof Element ? e.target : null, moved: 0 };
  };

  const onTouchMove = (e: TouchEvent): void => {
    const touch = e.touches[0];
    if (start && touch) start.moved = Math.max(start.moved, Math.hypot(touch.clientX - start.x, touch.clientY - start.y));
  };

  const onTouchEnd = (e: TouchEvent): void => {
    const s = start;
    start = null;
    const touch = e.changedTouches[0];
    if (!s || !touch) return;
    const dx = touch.clientX - s.x;
    const dy = touch.clientY - s.y;
    const dist = Math.hypot(dx, dy);
    const durationMs = Date.now() - s.t;

    if (durationMs <= GESTURE_THRESHOLDS.tapMaxMs && Math.max(dist, s.moved) <= GESTURE_THRESHOLDS.tapMaxPx) {
      const target = s.target ?? document.elementFromPoint(touch.clientX, touch.clientY) ?? document.body;
      lastTap = { x: touch.clientX, y: touch.clientY, t: Date.now() };
      tap(target, touch.clientX, touch.clientY);
      return;
    }

    if (durationMs <= GESTURE_THRESHOLDS.swipeMaxMs && dist >= GESTURE_THRESHOLDS.swipeMinPx) {
      let direction: SwipeDirection;
      if (Math.abs(dx) > Math.abs(dy)) direction = dx > 0 ? 'right' : 'left';
      else direction = dy > 0 ? 'down' : 'up';
      opts.emit({
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

  // Clic de mouse, o el clic que sigue a un toque. Ese último se descarta solo si coincide en
  // lugar y tiempo con un toque ya contado: un toque largo (más de 800 ms) no se contó como
  // toque, así que su clic sí cuenta.
  const onClick = (e: MouseEvent): void => {
    if (!e.isTrusted || isOurs(e.target)) return;
    const now = Date.now();
    const echo = now - lastClickAt < CLICK_ECHO_MS;
    lastClickAt = now;
    if (echo) return;
    if (lastTap && now - lastTap.t < CLICK_AFTER_TAP_MS && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) <= CLICK_AFTER_TAP_PX) {
      lastTap = null;
      return;
    }
    const target = e.target instanceof Element ? e.target : document.body;
    let x = e.clientX;
    let y = e.clientY;
    if (e.detail === 0 && x === 0 && y === 0) {
      // Clic por teclado (Enter en un formulario): se anota en el centro del botón.
      const r = target.getBoundingClientRect();
      x = r.left + r.width / 2;
      y = r.top + r.height / 2;
    }
    tap(target, x, y);
  };

  const onFocus = (e: FocusEvent): void => {
    if (isOurs(e.target)) return;
    for (const p of [...pending]) if (e.target !== p.base.focused) settle(p, true);
  };

  const onScroll = (e: Event): void => {
    if (isOurs(e.target)) return;
    for (const p of [...pending]) settle(p, true);
  };

  const options: AddEventListenerOptions = { capture: true, passive: true };
  document.addEventListener('pointerdown', onPointerDown, options);
  document.addEventListener('touchstart', onTouchStart, options);
  document.addEventListener('touchmove', onTouchMove, options);
  document.addEventListener('touchend', onTouchEnd, options);
  document.addEventListener('touchcancel', onTouchCancel, options);
  document.addEventListener('click', onClick, options);
  document.addEventListener('focusin', onFocus, options);
  document.addEventListener('scroll', onScroll, options);

  return {
    stop() {
      for (const p of [...pending]) settle(p, false);
      document.removeEventListener('pointerdown', onPointerDown, options);
      document.removeEventListener('touchstart', onTouchStart, options);
      document.removeEventListener('touchmove', onTouchMove, options);
      document.removeEventListener('touchend', onTouchEnd, options);
      document.removeEventListener('touchcancel', onTouchCancel, options);
      document.removeEventListener('click', onClick, options);
      document.removeEventListener('focusin', onFocus, options);
      document.removeEventListener('scroll', onScroll, options);
    },
    effect(kind) {
      for (const p of [...pending]) if (kind === 'screen' || !p.base.noisy) settle(p, true);
    },
    flush(unloading) {
      for (const p of [...pending]) settle(p, unloading || sideEffect(p.base));
    },
  };
}
