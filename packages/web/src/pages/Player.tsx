import { useEffect, useMemo, useRef, useState } from 'react';
import rrwebPlayer from 'rrweb-player';
import type { eventWithTime } from '@rrweb/types';
import { ArrowLeft, Download, Hand, MoveHorizontal, Navigation, Smartphone, Monitor } from 'lucide-react';
import type { SessionEventsResponse, TaptanaEvent, TaptanaOwnEvent } from '@taptana/shared';
import { getClient } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { cn, formatDate, formatDuration } from '@/lib/utils';
import { Link } from '@/router';

/** Colores de los marcadores en la línea de tiempo del reproductor, por tipo de evento. */
const TAGS: Record<string, string> = {
  tap: '#2f7d4f',
  swipe: '#d97706',
  navigation: '#2563eb',
};

const RRWEB_CUSTOM = 5;

/**
 * Convierte los eventos de la sesión en lo que rrweb-player espera. Los eventos propios de
 * Taptana se vuelven "custom events" de rrweb con un tag, y aparecen como marcas en la línea
 * de tiempo.
 */
function toPlayerEvents(events: TaptanaEvent[]): eventWithTime[] {
  const out: eventWithTime[] = [];
  for (const e of events) {
    if (e.kind === 'rrweb') out.push(e.data as eventWithTime);
    else if (e.type === 'tap' || e.type === 'swipe' || e.type === 'navigation') {
      out.push({ type: RRWEB_CUSTOM, timestamp: e.t, data: { tag: e.type, payload: e } } as eventWithTime);
    }
  }
  return out.sort((a, b) => a.timestamp - b.timestamp);
}

function describe(e: TaptanaOwnEvent): string {
  switch (e.type) {
    case 'tap':
      return e.target.text ? `Tocó “${e.target.text}”` : `Tocó ${e.target.tag}${e.target.id ? `#${e.target.id}` : ''}`;
    case 'swipe':
      return `Deslizó hacia ${{ up: 'arriba', down: 'abajo', left: 'la izquierda', right: 'la derecha' }[e.direction]}`;
    case 'navigation':
      return `Abrió ${e.to}`;
    case 'scroll':
      return `Scroll al ${Math.round(e.depth * 100)}%`;
    case 'viewport':
      return `Pantalla ${e.width}×${e.height}`;
    case 'task':
      return { start: 'Empezó la tarea', done: 'Marcó la tarea como lista', skip: 'No pudo con la tarea' }[e.action];
    case 'study':
      return e.action === 'start' ? 'Aceptó grabar y empezó el estudio' : 'Terminó el estudio';
  }
}

function Icon({ type }: { type: TaptanaOwnEvent['type'] }) {
  const cls = 'size-3.5';
  if (type === 'tap') return <Hand className={cls} style={{ color: TAGS['tap'] }} />;
  if (type === 'swipe') return <MoveHorizontal className={cls} style={{ color: TAGS['swipe'] }} />;
  return <Navigation className={cls} style={{ color: TAGS['navigation'] }} />;
}

export function PlayerPage({ id }: { id: string }) {
  const [data, setData] = useState<SessionEventsResponse | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);
  const [mode, setMode] = useState<'http' | 'static'>('http');
  const frame = useRef<HTMLDivElement>(null);
  const player = useRef<rrwebPlayer | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const client = await getClient();
        setMode(client.mode);
        const result = await client.getSessionEvents(id);
        if (!cancelled) setData(result);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const playerEvents = useMemo(() => (data ? toPlayerEvents(data.events) : []), [data]);
  const steps = useMemo(
    () =>
      (data?.events ?? []).filter(
        (e): e is TaptanaOwnEvent => e.kind === 'taptana' && (e.type === 'tap' || e.type === 'swipe' || e.type === 'navigation'),
      ),
    [data],
  );

  useEffect(() => {
    const target = frame.current;
    if (!target || !data || playerEvents.length < 2) return;
    target.innerHTML = '';
    const maxWidth = Math.min(target.clientWidth || 390, 480);
    const scale = Math.min(1, maxWidth / Math.max(data.session.viewport.width, 1));
    const p = new rrwebPlayer({
      target,
      props: {
        events: playerEvents,
        width: Math.round(data.session.viewport.width * scale),
        height: Math.round(data.session.viewport.height * scale),
        autoPlay: false,
        skipInactive: true,
        showController: true,
        tags: TAGS,
        mouseTail: false,
      },
    });
    p.addEventListener('ui-update-current-time', (payload) => {
      setCurrent((payload as { payload: number }).payload);
    });
    player.current = p;
    return () => {
      try {
        p.getReplayer().destroy();
      } catch {
        /* ya destruido */
      }
      player.current = null;
    };
  }, [data, playerEvents]);

  if (error) return <Shell title="Error">{error}</Shell>;
  if (data === undefined) return <Shell title="Cargando…" />;
  if (data === null) return <Shell title="No existe esta sesión">Puede haberse borrado.</Shell>;

  const start = data.session.startedAt;
  let activeIndex = -1;
  for (let i = 0; i < steps.length; i++) if (steps[i]!.t - start <= current) activeIndex = i;
  const onExport = (): void => {
    const blob = new Blob([JSON.stringify({ v: 1, exportedAt: Date.now(), ...data })], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `taptana-${data.session.id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6 space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link to={{ name: 'list' }}>
              <ArrowLeft />
            </Link>
          </Button>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{formatDate(start)}</h1>
            <p className="text-muted-foreground text-sm inline-flex items-center gap-1.5">
              {data.session.touch ? <Smartphone className="size-4" /> : <Monitor className="size-4" />}
              {data.session.deviceLabel} · {data.session.viewport.width}×{data.session.viewport.height} ·{' '}
              {formatDuration(data.session.durationMs)}
              {mode === 'static' && <Badge variant="outline">demo</Badge>}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onExport}>
          <Download /> Exportar
        </Button>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="py-4">
          <CardContent className="px-4">
            {playerEvents.length < 2 ? (
              <p className="text-muted-foreground text-sm py-10 text-center">Esta sesión no tiene suficientes eventos para reproducirse.</p>
            ) : (
              <div ref={frame} className="flex justify-center" />
            )}
          </CardContent>
        </Card>

        <Card className="py-4 gap-3 max-h-[80vh] overflow-hidden flex flex-col">
          <CardHeader className="px-4">
            <CardTitle className="text-base">Qué hizo</CardTitle>
            <CardDescription>
              {data.pages.length} página{data.pages.length === 1 ? '' : 's'} · {data.session.tapCount} toques. Toca un paso para ir ahí.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-2 overflow-y-auto">
            <ol className="space-y-0.5">
              {steps.map((e, i) => {
                const offset = e.t - start;
                const active = i === activeIndex;
                return (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => player.current?.goto(Math.max(0, offset), true)}
                      className={cn(
                        'w-full text-left flex items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent',
                        active && 'bg-accent',
                      )}
                    >
                      <span className="text-muted-foreground tabular-nums w-10 shrink-0 text-xs pt-0.5">{formatDuration(offset)}</span>
                      <span className="pt-0.5">
                        <Icon type={e.type} />
                      </span>
                      <span className="min-w-0 break-words">{describe(e)}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Shell({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl p-6 space-y-3">
      <Link to={{ name: 'list' }} className="text-sm text-muted-foreground hover:underline">
        ← Sesiones
      </Link>
      <h1 className="text-xl font-semibold">{title}</h1>
      {children && <p className="text-muted-foreground text-sm">{children}</p>}
    </div>
  );
}
