/**
 * Convierte los lotes guardados en modo local en un archivo de sesión (SessionExport),
 * exactamente con la forma que el servidor devolvería. El panel lo importa tal cual.
 */

import {
  deviceLabel,
  type EventBatch,
  type SessionExport,
  type SessionPage,
  type SessionSummary,
  type TaptanaEvent,
} from './index.js';

export function batchesToExport(batches: EventBatch[]): SessionExport | null {
  if (batches.length === 0) return null;
  const first = batches[0]!;
  const events: TaptanaEvent[] = [];
  const pages = new Map<string, SessionPage>();
  let device = first.device;

  for (const b of batches) {
    if (b.device && !device) device = b.device;
    if (b.page && !pages.has(b.pageId)) pages.set(b.pageId, { id: b.pageId, ...b.page });
    events.push(...b.events);
  }
  events.sort((a, b) => a.t - b.t);

  const pageList = Array.from(pages.values()).sort((a, b) => a.startedAt - b.startedAt);
  const startedAt = events[0]?.t ?? first.sentAt;
  const lastSeenAt = events[events.length - 1]?.t ?? first.sentAt;

  const session: SessionSummary = {
    id: first.sessionId,
    prototypeId: first.prototypeId,
    startedAt,
    lastSeenAt,
    durationMs: lastSeenAt - startedAt,
    deviceLabel: device ? deviceLabel(device.userAgent) : 'Desconocido',
    viewport: device?.viewport ?? { width: 0, height: 0 },
    touch: device?.touch ?? false,
    entryPath: pageList[0]?.path ?? '',
    pageCount: pageList.length,
    tapCount: events.filter((e) => e.kind === 'taptana' && e.type === 'tap').length,
  };

  return { v: 1, exportedAt: Date.now(), session, pages: pageList, events };
}
