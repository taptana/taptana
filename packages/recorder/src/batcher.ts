/**
 * Acumula eventos y los manda por lotes: cada 3 segundos, o antes si hay muchos o si llega uno
 * importante (navegación, tarea, respuesta).
 *
 * Reglas para no perder ni duplicar nada:
 * - Cada lote recibe su número (`seq`) al armarse y lo conserva en cada reintento: el servidor
 *   reconoce un lote repetido por (sessionId, pageId, seq) y lo ignora.
 * - Los eventos propios (pocos y pequeños) viajan en lotes separados de los de rrweb (pesados),
 *   y primero: si la persona cierra la página enseguida, lo importante alcanza a salir.
 * - Ningún lote pasa de 500 kB; un evento más grande viaja solo. Si el servidor rechaza un lote
 *   (400 / 413), se parte en dos hasta aislar el evento malo, que se descarta.
 * - Si no hay red, reintenta con espera creciente (1 s, 2 s, 4 s… hasta 30 s).
 * - Al cerrar o esconder la página manda lo pendiente con sendBeacon, salvo lo que ya está
 *   entregado o viajando en una petición que sobrevive al cierre.
 */

import {
  BATCH_INTERVAL_MS,
  BATCH_MAX_BYTES,
  BATCH_MAX_EVENTS,
  BEACON_MAX_BYTES,
  type DeviceInfo,
  type PageInfo,
  type TaptanaEvent,
} from '@taptana/shared';
import type { SendResult, Transport, Wire } from './transport.js';

export interface BatcherOptions {
  transport: Transport;
  prototypeId: string;
  sessionId: string;
  pageId: string;
  page: PageInfo;
  device: DeviceInfo;
}

/** Lo que ocupa el sobre de un lote (ids, página y dispositivo), con holgura. */
const ENVELOPE_BYTES = 2048;
/** Tope de lo que se retiene sin poder enviar. Pasado, se dejan de guardar eventos de rrweb. */
const MAX_PENDING_BYTES = 24 * 1024 * 1024;
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30_000;

/** Bytes que ocupa un texto en UTF-8 (sin crear una copia). */
export function utf8Length(text: string): number {
  let bytes = text.length;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0x7f) bytes += code > 0x7ff ? 2 : 1;
  }
  return bytes;
}

/**
 * Reparte una lista de tamaños en trozos consecutivos `[inicio, fin)` que no pasen de `max`.
 * Un elemento más grande que `max` queda solo en su trozo.
 */
export function chunkBySize(sizes: readonly number[], max: number): Array<[number, number]> {
  const chunks: Array<[number, number]> = [];
  let start = 0;
  let total = 0;
  for (let i = 0; i < sizes.length; i++) {
    const size = sizes[i] ?? 0;
    if (i > start && total + size > max) {
      chunks.push([start, i]);
      start = i;
      total = 0;
    }
    total += size;
  }
  if (sizes.length > start) chunks.push([start, sizes.length]);
  return chunks;
}

/** Espera antes del reintento número `failures` (1, 2, 3…): 1 s, 2 s, 4 s… hasta 30 s. */
export function backoffMs(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(failures - 1, 10));
}

interface Part {
  json: string;
  bytes: number;
  own: boolean;
}

interface Outgoing {
  seq: number;
  parts: Part[];
  bytes: number;
  /** Lleva `page` y `device` (el primer lote de la página). */
  header: boolean;
  tries: number;
  state: 'idle' | 'sending' | 'handed';
  wire: Wire | null;
}

export class Batcher {
  private queue: Part[] = [];
  private outbox: Outgoing[] = [];
  private seq = 0;
  private bytes = 0;
  private headerOwed = true;
  private failures = 0;
  private nextTryAt = 0;
  private pumping: Promise<void> | null = null;
  private closed = false;
  private stopped = false;
  private interval: number | undefined;
  private soonTimer: number | undefined;
  private retryTimer: number | undefined;
  /** Eventos de rrweb que no se guardaron por pasar el tope sin red. */
  dropped = 0;

  constructor(private readonly opts: BatcherOptions) {
    this.interval = window.setInterval(() => void this.flush(), BATCH_INTERVAL_MS);
  }

  /** `urgent`: mandar enseguida, sin esperar al siguiente ciclo. */
  push(event: TaptanaEvent, urgent = false): void {
    if (this.closed) return;
    let json: string;
    try {
      json = JSON.stringify(event);
    } catch {
      return; // algo que no se puede serializar no se puede enviar
    }
    const bytes = utf8Length(json) + 1;
    const own = event.kind === 'taptana';
    if (!own && this.bytes + bytes > MAX_PENDING_BYTES) {
      this.dropped++;
      return;
    }
    this.queue.push({ json, bytes, own });
    this.bytes += bytes;
    if (urgent || this.queue.length >= BATCH_MAX_EVENTS) this.soon();
  }

  /** Eventos que todavía no se confirman como entregados. */
  get pending(): number {
    let n = this.queue.length;
    for (const o of this.outbox) n += o.parts.length;
    return n;
  }

  /** Arma lotes con lo acumulado e intenta entregarlos. Termina cuando ya no hay más que hacer por ahora. */
  async flush(): Promise<void> {
    if (this.stopped) return;
    this.seal(BATCH_MAX_BYTES - ENVELOPE_BYTES);
    // Lo que se entregó al navegador al esconder la página y nadie confirmó se vuelve a mandar:
    // si ya había llegado, el servidor lo reconoce por su `seq` y lo ignora.
    for (const o of this.outbox) if (o.state === 'handed') o.state = 'idle';
    await this.pump();
  }

  /** La red volvió: reintentar ya. */
  retryNow(): void {
    this.nextTryAt = 0;
    void this.flush();
  }

  /**
   * La página se cierra o se esconde: no habrá otra oportunidad segura. Manda lo pendiente con
   * sendBeacon, que solo acepta lotes pequeños, así que lo que aún no se intentó se reparte en
   * trozos pequeños.
   */
  flushFinal(): void {
    if (this.stopped) return;
    const limit = BEACON_MAX_BYTES - ENVELOPE_BYTES;
    this.seal(limit);
    const next: Outgoing[] = [];
    for (const o of this.outbox) {
      if (o.tries === 0 && o.state === 'idle' && o.bytes > limit && o.parts.length > 1) next.push(...this.rechunk(o, limit));
      else next.push(o);
    }
    this.outbox = next;
    for (const o of [...this.outbox]) {
      // Ya viaja en una petición que sobrevive al cierre, o ya se entregó al navegador.
      if (o.state === 'handed' || (o.state === 'sending' && o.wire?.keepalive)) continue;
      const wasSending = o.state === 'sending';
      o.state = 'handed';
      void this.opts.transport.send(this.wire(o, false), true).then((result) => {
        if (result === 'retry' && !wasSending && o.state === 'handed') o.state = 'idle';
      });
    }
  }

  /** No acepta más eventos; termina de entregar lo pendiente y se apaga sola. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    void this.flush();
  }

  /** Tira lo pendiente y se apaga. */
  discard(): void {
    this.queue = [];
    this.outbox = [];
    this.bytes = 0;
    this.stop();
  }

  stop(): void {
    this.closed = true;
    this.stopped = true;
    if (this.interval !== undefined) clearInterval(this.interval);
    if (this.soonTimer !== undefined) clearTimeout(this.soonTimer);
    if (this.retryTimer !== undefined) clearTimeout(this.retryTimer);
    this.interval = this.soonTimer = this.retryTimer = undefined;
  }

  // ── Interno ────────────────────────────────────────────────────────────

  private soon(): void {
    if (this.soonTimer !== undefined) return;
    this.soonTimer = window.setTimeout(() => {
      this.soonTimer = undefined;
      void this.flush();
    }, 30);
  }

  /** Pasa la cola a lotes numerados: primero los eventos propios, después los de rrweb. */
  private seal(maxBytes: number): void {
    if (this.queue.length === 0) return;
    const queue = this.queue;
    this.queue = [];
    for (const lane of [queue.filter((p) => p.own), queue.filter((p) => !p.own)]) {
      for (const [from, to] of chunkBySize(lane.map((p) => p.bytes), maxBytes)) this.outbox.push(this.outgoing(lane.slice(from, to), this.seq++));
    }
  }

  private outgoing(parts: Part[], seq: number, header?: boolean): Outgoing {
    let takesHeader = header ?? false;
    if (header === undefined && this.headerOwed) {
      takesHeader = true;
      this.headerOwed = false;
    }
    let bytes = 0;
    for (const p of parts) bytes += p.bytes;
    return { seq, parts, bytes, header: takesHeader, tries: 0, state: 'idle', wire: null };
  }

  /** Parte un lote que aún no se intentó en trozos más pequeños. El primero conserva su `seq`. */
  private rechunk(o: Outgoing, maxBytes: number): Outgoing[] {
    return chunkBySize(o.parts.map((p) => p.bytes), maxBytes).map(([from, to], i) =>
      this.outgoing(o.parts.slice(from, to), i === 0 ? o.seq : this.seq++, i === 0 ? o.header : false),
    );
  }

  private wire(o: Outgoing, keepalive: boolean): Wire {
    const { prototypeId, sessionId, pageId, page, device } = this.opts;
    const head: Record<string, unknown> = { v: 1, prototypeId, sessionId, pageId, seq: o.seq, sentAt: Date.now() };
    if (o.header) {
      head['page'] = page;
      head['device'] = device;
    }
    // Los eventos ya están serializados: se pegan tal cual para no convertirlos dos veces.
    const envelope = JSON.stringify(head);
    const json = `${envelope.slice(0, -1)},"events":[${o.parts.map((p) => p.json).join(',')}]}`;
    return { sessionId, pageId, seq: o.seq, json, keepalive };
  }

  private remove(o: Outgoing): void {
    const i = this.outbox.indexOf(o);
    if (i !== -1) this.outbox.splice(i, 1);
    this.bytes -= o.bytes;
  }

  /** El servidor no acepta este lote: se parte para aislar el evento malo, o se descarta si es uno solo. */
  private reject(o: Outgoing): void {
    const i = this.outbox.indexOf(o);
    if (i === -1) return;
    if (o.parts.length <= 1) {
      this.remove(o);
      if (o.header) {
        // `page` y `device` tienen que llegar con algún lote: con el siguiente.
        const nextUp = this.outbox.find((x) => x.tries === 0 && x.state === 'idle');
        if (nextUp) nextUp.header = true;
        else this.headerOwed = true;
      }
      return;
    }
    const mid = Math.ceil(o.parts.length / 2);
    const first = this.outgoing(o.parts.slice(0, mid), o.seq, o.header);
    const second = this.outgoing(o.parts.slice(mid), this.seq++, false);
    this.outbox.splice(i, 1, first, second);
  }

  /** Entrega los lotes en orden, de uno en uno. Si ya hay una entrega en curso, espera a esa. */
  private pump(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (!this.pumping) {
      this.pumping = this.deliver().finally(() => {
        this.pumping = null;
        if (this.closed && this.outbox.length === 0 && this.queue.length === 0) this.stop();
      });
    }
    return this.pumping;
  }

  private async deliver(): Promise<void> {
    for (;;) {
      if (this.stopped || Date.now() < this.nextTryAt) return;
      const o = this.outbox.find((x) => x.state === 'idle');
      if (!o) return;
      o.state = 'sending';
      o.tries++;
      o.wire = this.wire(o, o.bytes + ENVELOPE_BYTES <= BEACON_MAX_BYTES);
      let result: SendResult;
      try {
        result = await this.opts.transport.send(o.wire, false);
      } catch {
        result = 'retry';
      }
      o.wire = null;
      if (this.stopped) return;
      if (result === 'ok' || result === 'sent') {
        this.remove(o);
        this.failures = 0;
      } else if (result === 'reject') {
        o.state = 'idle';
        this.reject(o);
        this.failures = 0;
      } else {
        // Si entre tanto la página se escondió y este lote se entregó por beacon, se deja así.
        if (o.state === 'sending') o.state = 'idle';
        this.failures++;
        this.nextTryAt = Date.now() + backoffMs(this.failures);
        if (this.retryTimer !== undefined) clearTimeout(this.retryTimer);
        this.retryTimer = window.setTimeout(() => void this.flush(), this.nextTryAt - Date.now() + 10);
        return;
      }
    }
  }
}
