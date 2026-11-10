/**
 * Lo que observa al prototipo en cualquier modo: la pantalla actual y los toques. Grabar,
 * probar un estudio sin grabar o mostrarle al panel lo que pasa usan los mismos sensores; solo
 * cambia a dónde van los eventos.
 */

import type { NavigationEvent, SwipeEvent, TapEvent } from '@taptana/shared';
import { watchGestures, type GestureWatcher } from './gestures.js';
import { maskTyped } from './privacy.js';
import { ScreenTracker } from './screens.js';

export interface SensorOptions {
  /** Pantalla anterior de la sesión (ScreenId), o "" si es la entrada. */
  previous: string;
  emit(event: NavigationEvent | TapEvent | SwipeEvent): void;
  /** Cada toque en el prototipo, en el momento, con el elemento real. */
  onTap?(tap: TapEvent, element: Element): void;
  /** Cambió la pantalla. */
  onScreen?(event: NavigationEvent): void;
  /** Terminó una revisión del DOM (para reglas del tipo "aparece un texto"). */
  onCheck?(): void;
}

export interface Sensors {
  tracker: ScreenTracker;
  gestures: GestureWatcher;
  stop(): void;
}

export function startSensors(opts: SensorOptions): Sensors {
  let gestures: GestureWatcher | null = null;
  const tracker = new ScreenTracker({
    previous: opts.previous,
    mask: maskTyped,
    emit(event) {
      // Un toque que esperaba su efecto lo tuvo: sale antes que la navegación que provocó.
      gestures?.effect('screen');
      opts.emit(event);
      opts.onScreen?.(event);
    },
    onMutation: () => gestures?.effect('dom'),
    onCheck: () => opts.onCheck?.(),
  });
  gestures = watchGestures({
    emit: opts.emit,
    lastMutationAt: () => tracker.lastMutationAt,
    onTap(tap, element) {
      opts.onTap?.(tap, element);
      // Hay cambios de pantalla que no tocan el DOM (`:target`, una casilla con CSS).
      tracker.checkSoon();
    },
  });
  tracker.start();
  const watcher = gestures;
  return {
    tracker,
    gestures: watcher,
    stop() {
      watcher.stop();
      tracker.stop();
    },
  };
}
