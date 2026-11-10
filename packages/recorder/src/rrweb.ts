/**
 * Configura rrweb. Nada de lo que el participante escribe sale del celular:
 * - el valor de cada campo se reemplaza por asteriscos (`maskAllInputs`);
 * - el texto que el prototipo copie de un campo a otro lugar se tapa (`maskTextFn`);
 * - una zona `contenteditable` se tapa entera;
 * - la URL de la página viaja sin los valores de su query (`maskUrl`).
 */

import { record } from '@rrweb/record';
import type { eventWithTime } from '@rrweb/types';
import { maskUrl, type RrwebEvent } from '@taptana/shared';
import { maskRecordedText } from './privacy.js';

type Emit = (event: RrwebEvent) => void;

/** Tipos de evento de rrweb que nos importan (EventType en @rrweb/types). */
export const RRWEB_FULL_SNAPSHOT = 2;
const RRWEB_META = 4;

export function startRrweb(emit: Emit): () => void {
  const stop = record({
    emit(event: eventWithTime) {
      if (event.type === RRWEB_META) {
        const data = event.data as { href?: unknown };
        if (typeof data.href === 'string') data.href = maskUrl(data.href);
      }
      emit({ kind: 'rrweb', t: event.timestamp, data: event });
    },
    // Privacidad: cada carácter escrito en input, textarea y select se reemplaza por *.
    maskAllInputs: true,
    // Todo nodo de texto pasa por maskRecordedText, que solo tapa lo que se escribió en un campo.
    maskTextSelector: '*',
    maskTextFn: maskRecordedText,
    // Elementos con clase rr-block se graban como un rectángulo vacío (nuestra interfaz).
    blockClass: 'rr-block',
    // Empezar en cuanto el HTML está listo, sin esperar a las imágenes: se pierde menos si la
    // persona navega rápido.
    recordAfter: 'DOMContentLoaded',
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
