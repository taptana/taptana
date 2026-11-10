/**
 * Convierte los lotes guardados en modo local en un archivo de sesión (SessionExport),
 * exactamente con la forma que el servidor devolvería. El panel lo importa tal cual.
 */

import type { EventBatch, SessionExport } from './api.js';
import { deviceLabel } from './device.js';
import type { TaptanaEvent } from './events.js';
import { participantName } from './results.js';
import { countScreens } from './screen.js';
import type { SessionPage, SessionSummary } from './session.js';

export function batchesToExport(batches: EventBatch[]): SessionExport | null {
  if (batches.length === 0) return null;
  const first = batches[0] as EventBatch;
  const events: TaptanaEvent[] = [];
  const pages = new Map<string, SessionPage>();
  const seen = new Set<string>();
  let device = first.device;

  for (const b of batches) {
    // Un lote guardado dos veces (reintento) cuenta una sola vez.
    const key = `${b.pageId}#${b.seq}`;
    if (seen.has(key)) continue;
    seen.add(key);
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
    screenCount: countScreens(events),
  };

  // Si aceptó participar en un estudio, la sesión queda ligada a él (como hace el servidor).
  const start = events.find((e) => e.kind === 'taptana' && e.type === 'study' && e.action === 'start');
  if (start && start.kind === 'taptana' && start.type === 'study') {
    session.studyId = start.studyId;
    if (start.variantId) session.variantId = start.variantId;
  }
  const participant = participantName(events);
  if (participant) session.participant = participant;

  return { v: 1, exportedAt: Date.now(), session, pages: pageList, events };
}
