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
} from '@taptana/shared';

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

export function downloadExport(data: SessionExport): void {
  const json = JSON.stringify(data);
  const name = `taptana-${data.session.id}.json`;
  const file = new File([json], name, { type: 'application/json' });

  // En celulares, compartir abre AirDrop, WhatsApp, Drive... Si no se puede, descarga.
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare && nav.canShare({ files: [file] })) {
    nav.share({ files: [file], title: 'Sesión de Taptana' }).catch(() => triggerDownload(file));
    return;
  }
  triggerDownload(file);
}

function triggerDownload(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
