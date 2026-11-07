import { useEffect, useMemo, useRef, useState } from 'react';
import rrwebPlayer from 'rrweb-player';
import type { eventWithTime } from '@rrweb/types';
import { ArrowLeft, Download, Hand, MoveHorizontal, Navigation, Smartphone, Monitor, ListChecks, Flag, ThumbsUp, ThumbsDown } from 'lucide-react';
import type { SessionEventsResponse, TaptanaEvent, TaptanaOwnEvent, TaskResult } from '@taptana/shared';
import { getClient } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Layout } from '@/components/layout';
import { cn, formatDate, formatDuration } from '@/lib/utils';
import { OUTCOME_CLASS, OUTCOME_LABEL } from '@/lib/outcomes';
import { Link } from '@/router';

/** Colores de los marcadores en la línea de tiempo del reproductor, por tipo de evento. */
const TAGS: Record<string, string> = {
  tap: '#2f7d4f',
  swipe: '#d97706',
  navigation: '#2563eb',
  task: '#7c3aed',
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
    else if (e.type === 'tap' || e.type === 'swipe' || e.type === 'navigation' || (e.type === 'task' && e.action === 'start')) {
      out.push({ type: RRWEB_CUSTOM, timestamp: e.t, data: { tag: e.type, payload: e } } as eventWithTime);
    }
  }
  return out.sort((a, b) => a.timestamp - b.timestamp);
}

type StepEvent = Extract<TaptanaOwnEvent, { type: 'tap' | 'swipe' | 'navigation' | 'task' | 'study' }>;

function describe(e: TaptanaOwnEvent, taskTitle: (id: string) => string): string {
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
      return { start: `Empezó: ${taskTitle(e.taskId)}`, done: `Marcó “Listo”: ${taskTitle(e.taskId)}`, skip: `Marcó “No pude”: ${taskTitle(e.taskId)}` }[e.action];
    case 'study':
      return e.action === 'start' ? 'Aceptó grabar y empezó el estudio' : 'Terminó el estudio';
  }
}

function Icon({ type }: { type: TaptanaOwnEvent['type'] }) {
  const cls = 'size-3.5';
  if (type === 'tap') return <Hand className={cls} style={{ color: TAGS['tap'] }} />;
  if (type === 'swipe') return <MoveHorizontal className={cls} style={{ color: TAGS['swipe'] }} />;
  if (type === 'task' || type === 'study') return <Flag className={cls} style={{ color: TAGS['task'] }} />;
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
        (e): e is StepEvent => e.kind === 'taptana' && (e.type === 'tap' || e.type === 'swipe' || e.type === 'navigation' || e.type === 'task' || e.type === 'study'),
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
  const taskTitle = (taskId: string): string => data.study?.tasks.find((t) => t.id === taskId)?.title ?? taskId;
  let activeIndex = -1;
  for (let i = 0; i < steps.length; i++) if (steps[i]!.t - start <= current) activeIndex = i;
  const goto = (t: number): void => player.current?.goto(Math.max(0, t - start), true);

  const onExport = (): void => {
    const blob = new Blob([JSON.stringify({ v: 1, exportedAt: Date.now(), ...data })], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `taptana-${data.session.id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  const onManual = async (taskId: string, value: 'success' | 'failure'): Promise<void> => {
    const client = await getClient();
    const session = await client.setManualResults(data.session.id, { [taskId]: value });
    setData({ ...data, session });
  };

  return (
    <Layout wide>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link to={{ name: 'list' }}>
              <ArrowLeft />
            </Link>
          </Button>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{formatDate(start)}</h1>
            <p className="text-muted-foreground text-sm inline-flex items-center gap-1.5 flex-wrap">
              {data.session.touch ? <Smartphone className="size-4" /> : <Monitor className="size-4" />}
              {data.session.deviceLabel} · {data.session.viewport.width}×{data.session.viewport.height} ·{' '}
              {formatDuration(data.session.durationMs)}
              {data.study && (
                <Badge variant="secondary">
                  {data.study.name}
                  {data.session.variantId ? ` · ${data.session.variantId}` : ''}
                </Badge>
              )}
              {mode === 'static' && <Badge variant="outline">demo</Badge>}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onExport}>
          <Download /> Exportar
        </Button>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <Card className="py-4">
            <CardContent className="px-4">
              {playerEvents.length < 2 ? (
                <p className="text-muted-foreground text-sm py-10 text-center">Esta sesión no tiene suficientes eventos para reproducirse.</p>
              ) : (
                <div ref={frame} className="flex justify-center" />
              )}
            </CardContent>
          </Card>

          {data.study && data.session.tasks && (
            <Card className="py-4 gap-3">
              <CardHeader className="px-4">
                <CardTitle className="text-base flex items-center gap-2">
                  <ListChecks className="size-4" /> Tareas
                </CardTitle>
                <CardDescription>Toca una tarea para ir a donde empezó. Puedes corregir el resultado a mano.</CardDescription>
              </CardHeader>
              <CardContent className="px-4">
                <ol className="divide-y">
                  {data.session.tasks.map((r, i) => (
                    <TaskRow key={r.taskId} index={i} result={r} title={taskTitle(r.taskId)} kind={data.study?.tasks.find((t) => t.id === r.taskId)?.kind ?? 'task'} onGoto={goto} onManual={onManual} />
                  ))}
                </ol>
              </CardContent>
            </Card>
          )}
        </div>

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
                const isMarker = e.type === 'task' || e.type === 'study';
                return (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => goto(e.t)}
                      className={cn(
                        'w-full text-left flex items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent',
                        active && 'bg-accent',
                        isMarker && 'font-medium',
                      )}
                    >
                      <span className="text-muted-foreground tabular-nums w-10 shrink-0 text-xs pt-0.5">{formatDuration(offset)}</span>
                      <span className="pt-0.5">
                        <Icon type={e.type} />
                      </span>
                      <span className="min-w-0 break-words">{describe(e, taskTitle)}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}

function TaskRow({
  index,
  result,
  title,
  kind,
  onGoto,
  onManual,
}: {
  index: number;
  result: TaskResult;
  title: string;
  kind: string;
  onGoto: (t: number) => void;
  onManual: (taskId: string, value: 'success' | 'failure') => Promise<void>;
}) {
  const detail: string[] = [];
  if (result.durationMs !== undefined) detail.push(formatDuration(result.durationMs));
  if (result.ruleMatched) detail.push('regla cumplida');
  if (result.reported === 'done') detail.push('tocó Listo');
  if (result.reported === 'skip') detail.push('tocó No pude');
  if (result.manual) detail.push(`moderador: ${result.manual === 'success' ? 'logró' : 'no logró'}`);
  if (kind === 'first-click' && result.firstTap) detail.push(`primer toque: ${result.firstTap.text ?? result.firstTap.selector}`);

  return (
    <li className="flex items-start gap-3 py-2.5">
      <button
        type="button"
        className="flex-1 text-left min-w-0 disabled:cursor-default"
        disabled={result.startedAt === undefined}
        onClick={() => result.startedAt !== undefined && onGoto(result.startedAt)}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-muted-foreground tabular-nums text-xs w-4">{index + 1}</span>
          <span className="font-medium">{title}</span>
          {kind === 'first-click' && <Badge variant="secondary">first click</Badge>}
          <Badge variant="outline" className={OUTCOME_CLASS[result.outcome]}>
            {OUTCOME_LABEL[result.outcome]}
          </Badge>
        </div>
        {detail.length > 0 && <div className="text-muted-foreground text-xs pl-6 mt-0.5">{detail.join(' · ')}</div>}
      </button>
      <div className="flex gap-0.5 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Marcar como logrado"
          className={cn(result.manual === 'success' && 'bg-emerald-500/15 text-emerald-700')}
          onClick={() => void onManual(result.taskId, 'success')}
        >
          <ThumbsUp />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Marcar como no logrado"
          className={cn(result.manual === 'failure' && 'bg-red-500/15 text-red-700')}
          onClick={() => void onManual(result.taskId, 'failure')}
        >
          <ThumbsDown />
        </Button>
      </div>
    </li>
  );
}

function Shell({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <Layout>
      <h1 className="text-xl font-semibold">{title}</h1>
      {children && <p className="text-muted-foreground text-sm">{children}</p>}
    </Layout>
  );
}
