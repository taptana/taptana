import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import rrwebPlayer from 'rrweb-player';
import type { eventWithTime } from '@rrweb/types';
import { PREVIEW_WINDOW, type TapEvent } from '@taptana/shared';
import { getClient } from '@/api/client';
import { Skeleton } from '@/components/ui/skeleton';

/** Qué se ve de fondo: la foto de una sesión real, el prototipo como está hoy, o nada. */
export type Backdrop = 'snapshot' | 'live' | 'none';

const RRWEB_FULL_SNAPSHOT = 2;
const RRWEB_META = 4;
const MAX_DOC_HEIGHT = 6000;
const MAX_CACHED_SESSIONS = 4;

// ── Eventos de rrweb por sesión (se piden una vez aunque varias pantallas usen la misma) ──

interface LoadedSession {
  /** Eventos de rrweb en orden, o null si la sesión no trae una foto completa. */
  replay: eventWithTime[] | null;
  /** Los toques, para saber qué texto tenía un elemento. */
  taps: TapEvent[];
}

const replayCache = new Map<string, Promise<LoadedSession | null>>();

/** La sesión ya separada en grabación y toques. Se pide una sola vez por sesión. */
export function loadSession(sessionId: string): Promise<LoadedSession | null> {
  const hit = replayCache.get(sessionId);
  if (hit) return hit;
  const loading = getClient()
    .then((c) => c.getSessionEvents(sessionId))
    .then((data): LoadedSession | null => {
      if (!data) return null;
      const events: eventWithTime[] = [];
      const taps: TapEvent[] = [];
      for (const e of data.events) {
        if (e.kind === 'rrweb') events.push(e.data as eventWithTime);
        else if (e.type === 'tap') taps.push(e);
      }
      events.sort((a, b) => a.timestamp - b.timestamp);
      return { replay: events.some((e) => e.type === RRWEB_FULL_SNAPSHOT) ? events : null, taps };
    });
  loading.catch(() => replayCache.delete(sessionId));
  replayCache.set(sessionId, loading);
  // Las grabaciones pesan: solo se guardan las últimas.
  while (replayCache.size > MAX_CACHED_SESSIONS) {
    const oldest = replayCache.keys().next().value;
    if (oldest === undefined) break;
    replayCache.delete(oldest);
  }
  return loading;
}

function loadReplayEvents(sessionId: string): Promise<eventWithTime[] | null> {
  return loadSession(sessionId).then((s) => s?.replay ?? null);
}

/** Suelta las grabaciones guardadas (al salir del reporte). */
export function clearSnapshotCache(): void {
  replayCache.clear();
}

// ── Cuántas fotos se están dibujando, para esperar antes de imprimir ──

let busy = 0;

/** Espera a que terminen de dibujarse las fotos en curso (o a que pase `timeoutMs`). */
export function whenSnapshotsReady(timeoutMs = 8000): Promise<void> {
  const started = Date.now();
  return new Promise((resolve) => {
    const check = (): void => {
      if (busy <= 0 || Date.now() - started > timeoutMs) resolve();
      else setTimeout(check, 150);
    };
    setTimeout(check, 300);
  });
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function destroyPlayer(player: rrwebPlayer | null): void {
  if (!player) return;
  try {
    player.pause();
  } catch {
    /* ya detenido */
  }
  try {
    player.getReplayer().destroy();
  } catch {
    /* ya destruido */
  }
  try {
    (player as unknown as { $destroy?: () => void }).$destroy?.();
  } catch {
    /* ya desmontado */
  }
}

/** ¿El elemento ya está cerca de la parte visible de la página? Se queda en true. */
function useNearViewport(eager: boolean): [React.RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [near, setNear] = useState(eager);
  useEffect(() => {
    if (near) return;
    if (eager || typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      { rootMargin: '500px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [eager, near]);
  return [ref, near];
}

/**
 * La pantalla tal como la vio un participante, a documento completo, con una capa encima.
 *
 * Reconstruye la foto de rrweb de `sample` (una sesión y un instante): pide los eventos de esa
 * sesión, crea el reproductor sin controles, lo detiene en ese instante, estira el iframe al
 * alto de todo el documento y lo sube al inicio, para que las coordenadas de página de los
 * toques calcen. Si no se puede, muestra el prototipo actual (`liveSrc`, sin grabar); si eso
 * tampoco, un fondo neutro.
 *
 * `children` recibe el alto del documento y qué fondo quedó, y dibuja la capa (los toques).
 * Solo se dibuja cuando está por entrar en pantalla (o si `eager`).
 */
export function SnapshotView({
  sample,
  viewportWidth,
  displayWidth,
  liveSrc,
  estimatedHeight,
  eager = false,
  preferNextLoad = false,
  maxHeight = 560,
  label,
  onBackdrop,
  children,
}: {
  sample: { sessionId: string; t: number; vw: number } | undefined;
  viewportWidth: number;
  displayWidth: number;
  liveSrc: string | null;
  /** Alto a usar mientras no se conoce el del documento. */
  estimatedHeight: number;
  eager?: boolean;
  /**
   * Si justo después del instante hay una carga de página (hasta 2 s), usar esa. Sirve para
   * pantallas sin toques donde la visita fue tan corta que el instante cae antes de la foto.
   */
  preferNextLoad?: boolean;
  maxHeight?: number;
  label: string;
  onBackdrop?: (backdrop: Backdrop) => void;
  children: (view: { docHeight: number; scale: number; backdrop: Backdrop | 'loading' }) => ReactNode;
}) {
  const [root, near] = useNearViewport(eager);
  const host = useRef<HTMLDivElement>(null);
  const live = useRef<HTMLIFrameElement>(null);
  const [backdrop, setBackdrop] = useState<Backdrop | 'loading'>('loading');
  const [docHeight, setDocHeight] = useState(estimatedHeight);
  const width = Math.max(1, sample?.vw || viewportWidth);
  const scale = displayWidth / width;
  const sampleKey = sample ? `${sample.sessionId}@${sample.t}` : '';
  const notify = useRef(onBackdrop);
  notify.current = onBackdrop;

  const settle = useMemo(
    () => (value: Backdrop) => {
      setBackdrop(value);
      notify.current?.(value);
    },
    [],
  );

  useEffect(() => {
    if (!near) return;
    const fallback = (): void => settle(liveSrc ? 'live' : 'none');
    if (!sample) {
      fallback();
      return;
    }
    let cancelled = false;
    let player: rrwebPlayer | null = null;
    busy++;
    let counted = true;
    const done = (): void => {
      if (counted) busy--;
      counted = false;
    };
    setBackdrop('loading');

    void (async () => {
      const events = await loadReplayEvents(sample.sessionId);
      const target = host.current;
      if (cancelled) return;
      if (!events || events.length === 0 || !target) throw new Error('sin grabación');
      const first = (events[0] as eventWithTime).timestamp;
      const last = (events[events.length - 1] as eventWithTime).timestamp;
      if (sample.t < first - 5000 || sample.t > last + 5000) throw new Error('instante fuera de la grabación');
      // Alto de la pantalla del participante en ese instante (último Meta antes de `t`).
      let viewportHeight = Math.round(width * 1.9);
      for (const e of events) {
        if (e.timestamp > sample.t) break;
        if (e.type === RRWEB_META) {
          const h = (e.data as { height?: number }).height;
          if (typeof h === 'number' && h > 0) viewportHeight = h;
        }
      }
      target.innerHTML = '';
      player = new rrwebPlayer({
        target,
        props: { events, width, height: viewportHeight, autoPlay: false, showController: false, mouseTail: false, skipInactive: false },
      });
      let at = sample.t;
      if (preferNextLoad) {
        const next = events.find((e) => e.type === RRWEB_FULL_SNAPSHOT && e.timestamp > sample.t && e.timestamp <= sample.t + 2000);
        if (next) at = next.timestamp + 30;
      }
      player.goto(Math.min(Math.max(0, at - first), Math.max(0, last - first)), false);

      // La foto se arma en el siguiente cuadro; las imágenes y fuentes pueden tardar un poco más.
      const measure = (): boolean => {
        const iframe = player?.getReplayer().iframe;
        const doc = iframe?.contentDocument;
        if (!iframe || !doc?.body || doc.body.childElementCount === 0) return false;
        iframe.style.width = `${width}px`;
        iframe.style.height = `${viewportHeight}px`;
        const full = Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight, viewportHeight);
        const h = Math.min(MAX_DOC_HEIGHT, full);
        iframe.style.height = `${h}px`;
        iframe.contentWindow?.scrollTo(0, 0);
        doc.documentElement.scrollTop = 0;
        doc.body.scrollTop = 0;
        setDocHeight(h);
        return true;
      };
      await wait(120);
      if (cancelled) return;
      if (!measure()) {
        await wait(500);
        if (cancelled) return;
        if (!measure()) throw new Error('foto vacía');
      }
      settle('snapshot');
      done();
      // Segunda medida: el alto cambia cuando terminan de cargar imágenes y fuentes.
      await wait(900);
      if (!cancelled) measure();
    })().catch(() => {
      if (cancelled) return;
      destroyPlayer(player);
      player = null;
      if (host.current) host.current.innerHTML = '';
      setDocHeight(estimatedHeight);
      fallback();
      done();
    });

    return () => {
      cancelled = true;
      done();
      destroyPlayer(player);
      player = null;
    };
    // `sample` se compara por su clave: el reporte crea objetos nuevos en cada carga.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near, sampleKey, width, liveSrc, estimatedHeight, settle, preferNextLoad]);

  const onLiveLoad = (): void => {
    try {
      const doc = live.current?.contentDocument;
      const h = doc ? Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0) : 0;
      if (h > 0) setDocHeight(Math.min(MAX_DOC_HEIGHT, Math.max(h, estimatedHeight)));
    } catch {
      /* otro origen: se queda el alto estimado */
    }
  };

  const shownHeight = Math.round(docHeight * scale);

  return (
    <div ref={root} className="tt-map relative overflow-hidden rounded-xl border bg-white shadow-sm" style={{ width: displayWidth, maxWidth: '100%' }}>
      <div className="tt-map-scroll overflow-y-auto overflow-x-hidden" style={{ maxHeight }} tabIndex={shownHeight > maxHeight ? 0 : -1} role="img" aria-label={label}>
        <div className="relative" style={{ width: displayWidth, height: shownHeight }}>
          <div ref={host} className="tt-snapshot" style={{ ['--tt-scale' as string]: String(scale), visibility: backdrop === 'snapshot' ? 'visible' : 'hidden' }} />
          {backdrop === 'live' && liveSrc && (
            <iframe
              ref={live}
              name={PREVIEW_WINDOW}
              src={liveSrc}
              title={label}
              onLoad={onLiveLoad}
              onError={() => settle('none')}
              tabIndex={-1}
              aria-hidden="true"
              className="absolute top-0 left-0 origin-top-left pointer-events-none border-0 bg-white"
              style={{ width, height: docHeight, transform: `scale(${scale})` }}
            />
          )}
          {backdrop === 'none' && (
            <div className="absolute inset-0 bg-[repeating-linear-gradient(135deg,#f4f4f5_0,#f4f4f5_12px,#fafafa_12px,#fafafa_24px)]">
              <p className="sticky top-0 p-4 text-center text-sm text-zinc-600">No hay imagen de esta pantalla. Los toques se muestran en su posición.</p>
            </div>
          )}
          {backdrop === 'loading' && <Skeleton className="absolute inset-0 rounded-none" />}
          {near && children({ docHeight, scale, backdrop })}
        </div>
      </div>
    </div>
  );
}
