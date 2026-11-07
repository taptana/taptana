/**
 * Uno al cargar la página y uno cada vez que cambia el tamaño u orientación.
 */

import type { ViewportEvent } from '@taptana/shared';

type Emit = (event: ViewportEvent) => void;

export function viewportSnapshot(): ViewportEvent {
  const width = window.innerWidth;
  const height = window.innerHeight;
  return {
    kind: 'taptana',
    type: 'viewport',
    t: Date.now(),
    width,
    height,
    orientation: width > height ? 'landscape' : 'portrait',
  };
}

export function watchViewport(emit: Emit): () => void {
  emit(viewportSnapshot());
  let timer: number | undefined;
  const onResize = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = window.setTimeout(() => emit(viewportSnapshot()), 200);
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  return () => {
    window.removeEventListener('resize', onResize);
    window.removeEventListener('orientationchange', onResize);
  };
}
