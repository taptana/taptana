/**
 * Acumula eventos y los manda por lotes: cada 3 segundos, o antes si hay más de 200.
 * Si falla el envío, los eventos se quedan en la cola y se reintentan en el siguiente ciclo.
 * Al cerrar o esconder la página, manda lo que queda con `final: true` (sendBeacon).
 */

import {
  BATCH_INTERVAL_MS,
  BATCH_MAX_EVENTS,
  type DeviceInfo,
  type EventBatch,
  type PageInfo,
  type TaptanaEvent,
} from '@taptana/shared';
import type { Transport } from './transport.js';

export interface BatcherOptions {
  transport: Transport;
  prototypeId: string;
  sessionId: string;
  pageId: string;
  page: PageInfo;
  device: DeviceInfo;
}

export class Batcher {
  private queue: TaptanaEvent[] = [];
  private seq = 0;
  private timer: number | undefined;
  private sending = false;
  private closed = false;

  constructor(private readonly opts: BatcherOptions) {
    this.timer = window.setInterval(() => void this.flush(false), BATCH_INTERVAL_MS);
    const onHide = (): void => {
      if (document.visibilityState === 'hidden') void this.flush(true);
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', () => void this.flush(true));
  }

  push(event: TaptanaEvent): void {
    if (this.closed) return;
    this.queue.push(event);
    if (this.queue.length >= BATCH_MAX_EVENTS) void this.flush(false);
  }

  get pending(): number {
    return this.queue.length;
  }

  async flush(final: boolean): Promise<void> {
    if (this.queue.length === 0) return;
    if (this.sending && !final) return;
    this.sending = true;

    const events = this.queue;
    this.queue = [];
    const batch: EventBatch = {
      v: 1,
      prototypeId: this.opts.prototypeId,
      sessionId: this.opts.sessionId,
      pageId: this.opts.pageId,
      seq: this.seq,
      sentAt: Date.now(),
      events,
    };
    if (this.seq === 0) {
      batch.page = this.opts.page;
      batch.device = this.opts.device;
    }

    try {
      const ok = await this.opts.transport.send(batch, final);
      if (ok) {
        this.seq += 1;
      } else {
        // Reintentar en el siguiente ciclo, conservando el orden.
        this.queue = events.concat(this.queue);
      }
    } catch {
      this.queue = events.concat(this.queue);
    } finally {
      this.sending = false;
    }
  }

  stop(): void {
    this.closed = true;
    if (this.timer !== undefined) clearInterval(this.timer);
  }
}
