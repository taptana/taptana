/**
 * Configura rrweb. Todo lo escrito en inputs se enmascara antes de salir del celular.
 */

import { record } from '@rrweb/record';
import type { eventWithTime } from '@rrweb/types';
import type { RrwebEvent } from '@taptana/shared';

type Emit = (event: RrwebEvent) => void;

export function startRrweb(emit: Emit): () => void {
  const stop = record({
    emit(event: eventWithTime) {
      emit({ kind: 'rrweb', t: event.timestamp, data: event });
    },
    // Privacidad: cada carácter escrito en input, textarea y select se reemplaza por *.
    maskAllInputs: true,
    // Elementos con clase rr-block se graban como un rectángulo vacío (nuestro botón flotante).
    blockClass: 'rr-block',
    // Movimientos de mouse/dedo con poca frecuencia: el reproductor igual los suaviza.
    sampling: {
      mousemove: 50,
      scroll: 150,
      input: 'last',
    },
    inlineStylesheet: true,
    recordCanvas: false,
    collectFonts: false,
  });
  return () => {
    if (stop) stop();
  };
}
