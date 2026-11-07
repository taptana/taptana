/**
 * Punto de entrada del recorder. Arranca todo al cargar la página.
 *
 * Orden: configuración → sesión → transporte → cola → rrweb + gestos + scroll + viewport.
 */

import type { NavigationEvent } from '@taptana/shared';
import { readConfig, VERSION } from './config.js';
import { startSession } from './session.js';
import { HttpTransport, LocalTransport, type Transport } from './transport.js';
import { Batcher } from './batcher.js';
import { startRrweb } from './rrweb.js';
import { watchGestures } from './gestures.js';
import { watchScroll } from './scroll.js';
import { watchViewport } from './viewport.js';
import { batchesToExport, downloadExport } from './export.js';
import { mountLocalButton } from './local-ui.js';

interface TaptanaGlobal {
  version: string;
  sessionId: string;
  pageId: string;
  flush(): Promise<void>;
  pending(): number;
  stop(): void;
}

declare global {
  interface Window {
    __taptana?: TaptanaGlobal;
  }
}

function main(): void {
  if (window.__taptana) return; // ya está corriendo (script duplicado)
  if (window.top !== window.self && !document.currentScript) return;

  const config = readConfig();
  const ctx = startSession();

  const local = config.transport === 'local' ? new LocalTransport() : null;
  const transport: Transport = local ?? new HttpTransport(config.endpoint);

  const batcher = new Batcher({
    transport,
    prototypeId: config.prototypeId,
    sessionId: ctx.sessionId,
    pageId: ctx.pageId,
    page: ctx.page,
    device: ctx.device,
  });

  const navigation: NavigationEvent = {
    kind: 'taptana',
    type: 'navigation',
    t: Date.now(),
    from: ctx.previousPath,
    to: ctx.page.path,
  };
  batcher.push(navigation);

  const stops = [
    watchViewport((e) => batcher.push(e)),
    startRrweb((e) => batcher.push(e)),
    watchGestures((e) => batcher.push(e)),
    watchScroll((e) => batcher.push(e)),
  ];

  if (local) {
    const mount = (): void =>
      mountLocalButton(async () => {
        await batcher.flush(false);
        const batches = await local.readSession(ctx.sessionId);
        const data = batchesToExport(batches);
        if (data) downloadExport(data);
      });
    if (document.body) mount();
    else document.addEventListener('DOMContentLoaded', mount);
  }

  window.__taptana = {
    version: VERSION,
    sessionId: ctx.sessionId,
    pageId: ctx.pageId,
    flush: () => batcher.flush(false),
    pending: () => batcher.pending,
    stop: () => {
      for (const stop of stops) stop();
      batcher.stop();
    },
  };
}

main();
