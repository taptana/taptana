/**
 * Punto de entrada del recorder. Arranca todo al cargar la página.
 *
 * Orden: configuración → sesión → estudio (si hay) → transporte → cola →
 *        rrweb + gestos + scroll + viewport.
 */

import type { NavigationEvent, TaptanaEvent } from '@taptana/shared';
import { readConfig, VERSION } from './config.js';
import { setBasePath, startSession } from './session.js';
import { HttpTransport, LocalTransport, type Transport } from './transport.js';
import { Batcher } from './batcher.js';
import { startRrweb } from './rrweb.js';
import { watchGestures } from './gestures.js';
import { watchScroll } from './scroll.js';
import { watchViewport } from './viewport.js';
import { batchesToExport, downloadExport } from './export.js';
import { mountLocalButton } from './local-ui.js';
import { detectStudy, StudyController } from './study.js';

interface TaptanaGlobal {
  version: string;
  sessionId: string;
  pageId: string;
  studyId: string | null;
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
  setBasePath(config.base);
  const ctx = startSession();
  const studyState = detectStudy();
  // Con estudio y sin consentimiento, nada sale del celular hasta que el participante acepte.
  const holdUntilConsent = !!studyState && !studyState.consented && !studyState.declined;

  const local = config.transport === 'local' ? new LocalTransport() : null;
  const transport: Transport = local ?? new HttpTransport(config.endpoint);

  const batcher = new Batcher({
    transport,
    prototypeId: config.prototypeId,
    sessionId: ctx.sessionId,
    pageId: ctx.pageId,
    page: ctx.page,
    device: ctx.device,
    paused: holdUntilConsent,
  });

  let study: StudyController | null = null;
  const stops: Array<() => void> = [];
  const stopAll = (): void => {
    for (const stop of stops) stop();
    stops.length = 0;
  };

  const push = (e: TaptanaEvent): void => {
    batcher.push(e);
    if (study && e.kind === 'taptana' && e.type === 'tap') study.onTap(e);
  };

  if (studyState && !studyState.declined) {
    study = new StudyController({
      endpoint: config.endpoint,
      state: studyState,
      emit: push,
      onConsent: () => batcher.resume(),
      onDecline: () => {
        batcher.discard();
        stopAll();
      },
      onFinish: () => void batcher.flush(false),
    });
  }

  const navigation: NavigationEvent = {
    kind: 'taptana',
    type: 'navigation',
    t: Date.now(),
    from: ctx.previousPath,
    to: ctx.page.path,
  };
  push(navigation);

  if (!studyState?.declined) {
    stops.push(
      watchViewport(push),
      startRrweb(push),
      watchGestures(push),
      watchScroll(push),
    );
  }

  if (study) void study.start();

  if (local && config.exportButton) {
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
    studyId: studyState?.studyId ?? null,
    flush: () => batcher.flush(false),
    pending: () => batcher.pending,
    stop: () => {
      stopAll();
      batcher.stop();
    },
  };
}

main();
