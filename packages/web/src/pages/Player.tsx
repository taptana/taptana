import { useEffect, useMemo, useRef, useState } from 'react';
import rrwebPlayer from 'rrweb-player';
import type { eventWithTime } from '@rrweb/types';
import { ArrowLeft, Check, Download, Flag, Hand, ListChecks, MessageSquare, Monitor, MoveHorizontal, Navigation, NotebookPen, PlayCircle, Smartphone, Target, Undo2, X } from 'lucide-react';
import {
  BLOCK_KIND_LABELS,
  blockKind,
  blockTitle,
  isQuestionBlock,
  isTaskBlock,
  needsReview,
  SESSION_LIMITS,
  studyBlocks,
  type AnswerResult,
  type AnswerValue,
  type Block,
  type QuestionBlock,
  type ScreenInfo,
  type SessionEventsResponse,
  type SessionPatch,
  type SessionSummary,
  type TaptanaEvent,
  type TaptanaOwnEvent,
  type TaskBlock,
  type TaskResult,
} from '@taptana/shared';
import { getClient, IS_DEMO } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toast';
import { EmptyState, ErrorState, Layout, PageSkeleton, Section } from '@/components/layout';
import { downloadText } from '@/lib/download';
import { friendlyError } from '@/lib/errors';
import { plural, seconds } from '@/lib/format';
import { outcomeBadge } from '@/lib/outcomes';
import { liveTitleIsStable, screenNamer, type ScreenNamer } from '@/lib/screens';
import { exportFileName, stripPrototypeBase } from '@/lib/sessions';
import { cn, formatDate, formatDuration } from '@/lib/utils';
import { Link } from '@/router';
import { LabelEditor } from './Sessions';

/** Colores de los marcadores en la línea de tiempo del reproductor, por tipo de evento. */
const TAGS: Record<string, string> = {
  tap: '#2f7d4f',
  swipe: '#d97706',
  navigation: '#2563eb',
  task: '#7c3aed',
  goal: '#059669',
  answer: '#db2777',
};

const RRWEB_CUSTOM = 5;

type StepEvent = Extract<TaptanaOwnEvent, { type: 'tap' | 'swipe' | 'navigation' | 'task' | 'study' | 'answer' }>;
const STEP_TYPES = new Set(['tap', 'swipe', 'navigation', 'task', 'study', 'answer']);
const isStep = (e: TaptanaEvent): e is StepEvent => e.kind === 'taptana' && STEP_TYPES.has(e.type);

/**
 * Convierte los eventos de la sesión en lo que rrweb-player espera. Los eventos propios de
 * Taptana se vuelven "custom events" de rrweb con un tag, y aparecen como marcas en la línea
 * de tiempo.
 */
function toPlayerEvents(events: TaptanaEvent[]): eventWithTime[] {
  const out: eventWithTime[] = [];
  for (const e of events) {
    if (e.kind === 'rrweb') out.push(e.data as eventWithTime);
    else if (e.type === 'tap' || e.type === 'swipe' || e.type === 'navigation' || e.type === 'answer') {
      out.push({ type: RRWEB_CUSTOM, timestamp: e.t, data: { tag: e.type, payload: {} } } as eventWithTime);
    } else if (e.type === 'task' && (e.action === 'start' || e.action === 'goal')) {
      out.push({ type: RRWEB_CUSTOM, timestamp: e.t, data: { tag: e.action === 'goal' ? 'goal' : 'task', payload: {} } } as eventWithTime);
    }
  }
  return out.sort((a, b) => a.timestamp - b.timestamp);
}

const TAG_NAMES: Record<string, string> = {
  a: 'un enlace',
  button: 'un botón',
  input: 'un campo',
  textarea: 'un campo de texto',
  select: 'una lista',
  img: 'una imagen',
  label: 'una etiqueta',
  body: 'el fondo de la página',
  html: 'el fondo de la página',
};

function answerText(value: AnswerValue, block: QuestionBlock | undefined): string {
  if (value === null || value === undefined) return 'la saltó';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (typeof value === 'number') return block?.kind === 'scale' ? `${value} de ${block.max}` : String(value);
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'ninguna opción';
  return value.trim() ? `«${value}»` : 'sin texto';
}

function describe(e: StepEvent, blocks: Map<string, Block>, screenName: ScreenNamer): string {
  const title = (id: string): string => {
    const b = blocks.get(id);
    return b ? blockTitle(b) || BLOCK_KIND_LABELS[blockKind(b)] : 'un bloque que ya no está en el estudio';
  };
  switch (e.type) {
    case 'tap': {
      const what = e.target.text ? `«${e.target.text}»` : (TAG_NAMES[e.target.tag.toLowerCase()] ?? 'un elemento sin texto');
      return `Tocó ${what}${e.target.interactive === false ? ' (sin efecto)' : ''}`;
    }
    case 'swipe':
      return `Deslizó hacia ${{ up: 'arriba', down: 'abajo', left: 'la izquierda', right: 'la derecha' }[e.direction]}`;
    case 'navigation': {
      // El mismo nombre que en el constructor y en el reporte, no el título de esta visita.
      return `Llegó a «${screenName(stripPrototypeBase(e.to))}»`;
    }
    case 'task':
      if (e.action === 'start') return `Empezó: ${title(e.taskId)}`;
      if (e.action === 'goal') return `Cumplió el objetivo: ${title(e.taskId)}`;
      if (e.action === 'done') return e.auto ? `Terminó: ${title(e.taskId)}` : `Tocó «Listo, terminé»: ${title(e.taskId)}`;
      return `Tocó «No pude»: ${title(e.taskId)}`;
    case 'answer': {
      const b = blocks.get(e.blockId);
      return `Respondió «${title(e.blockId)}»: ${answerText(e.value, b && isQuestionBlock(b) ? b : undefined)}`;
    }
    case 'study':
      return e.action === 'start' ? `Aceptó grabar y empezó el estudio${e.participant ? ` (alias: ${e.participant})` : ''}` : 'Terminó el estudio';
  }
}

function StepIcon({ e }: { e: StepEvent }) {
  const cls = 'size-4 text-muted-foreground';
  if (e.type === 'tap') return <Hand className={cls} />;
  if (e.type === 'swipe') return <MoveHorizontal className={cls} />;
  if (e.type === 'answer') return <MessageSquare className={cls} />;
  if (e.type === 'task' && e.action === 'goal') return <Target className={cls} style={{ color: TAGS['goal'] }} />;
  if (e.type === 'task' || e.type === 'study') return <Flag className={cls} />;
  return <Navigation className={cls} />;
}

export function PlayerPage({ id, t }: { id: string; t?: number }) {
  // `data` no cambia después de cargar: así marcar un resultado o escribir una nota (que solo
  // tocan `session`) no vuelve a crear el reproductor ni reinicia la reproducción.
  const [data, setData] = useState<SessionEventsResponse | null | undefined>(undefined);
  const [session, setSession] = useState<SessionSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [knownScreens, setKnownScreens] = useState<ScreenInfo[]>([]);
  const frame = useRef<HTMLDivElement>(null);
  const player = useRef<rrwebPlayer | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(undefined);
    setSession(null);
    setError(null);
    setCurrent(0);
    setKnownScreens([]);
    (async () => {
      try {
        const client = await getClient();
        const result = await client.getSessionEvents(id);
        if (cancelled) return;
        setData(result);
        setSession(result?.session ?? null);
        if (result) {
          // Los nombres de pantalla salen de la misma lista que usan el constructor y el reporte.
          const list = await client.listPrototypeScreens(result.session.prototypeId).catch((): ScreenInfo[] => []);
          if (!cancelled) setKnownScreens(list);
        }
      } catch (e) {
        if (!cancelled) setError(friendlyError(e, 'No pudimos cargar esta sesión.'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, attempt]);

  const playerEvents = useMemo(() => (data ? toPlayerEvents(data.events) : []), [data]);
  const steps = useMemo(() => (data?.events ?? []).filter(isStep), [data]);
  const blocks = useMemo(() => new Map((data?.study ? studyBlocks(data.study) : []).map((b) => [b.id, b])), [data]);
  const screenName = useMemo(() => {
    // Pantallas que la API no conoce y que no son un archivo (hash, virtuales): vale su título en vivo.
    const live: Array<{ id: string; title: string }> = [];
    for (const e of data?.events ?? []) {
      if (e.kind !== 'taptana' || e.type !== 'navigation' || !e.title?.trim()) continue;
      const path = stripPrototypeBase(e.to);
      if (liveTitleIsStable(path)) live.push({ id: path, title: e.title.trim() });
    }
    return screenNamer([...knownScreens, ...live]);
  }, [data, knownScreens]);
  const canPlay = playerEvents.filter((e) => e.type !== RRWEB_CUSTOM).length >= 2;
  /** rrweb cuenta el tiempo desde su primer evento; la sesión, desde `startedAt`. */
  const playerStart = playerEvents[0]?.timestamp ?? data?.session.startedAt ?? 0;
  const viewport = data?.session.viewport;

  useEffect(() => {
    const target = frame.current;
    if (!target || !data || !canPlay || !viewport) return;
    target.innerHTML = '';
    const maxWidth = Math.min(target.clientWidth || 390, 520);
    const maxHeight = Math.max(360, window.innerHeight - 260);
    const scale = Math.min(1, maxWidth / Math.max(viewport.width, 1), maxHeight / Math.max(viewport.height, 1));
    let p: rrwebPlayer;
    try {
      p = new rrwebPlayer({
        target,
        props: {
          events: playerEvents,
          width: Math.round(viewport.width * scale),
          height: Math.round(viewport.height * scale),
          autoPlay: false,
          skipInactive: true,
          showController: true,
          tags: TAGS,
          mouseTail: false,
        },
      });
    } catch (e) {
      console.error('Taptana: no se pudo crear el reproductor', e);
      setError('Esta grabación no se puede reproducir: el archivo está incompleto o dañado.');
      return;
    }
    p.addEventListener('ui-update-current-time', (payload) => {
      setCurrent((payload as { payload: number }).payload);
    });
    player.current = p;
    // ?t=<ms desde el inicio de la sesión>: salta a ese instante, en pausa.
    if (t !== undefined) {
      try {
        p.goto(Math.max(0, data.session.startedAt + t - playerStart), false);
      } catch {
        /* instante fuera de la grabación */
      }
    }
    return () => {
      player.current = null;
      try {
        p.pause();
      } catch {
        /* ya detenido */
      }
      try {
        p.getReplayer().destroy();
      } catch {
        /* ya destruido */
      }
      try {
        (p as unknown as { $destroy?: () => void }).$destroy?.();
      } catch {
        /* ya destruido */
      }
      target.innerHTML = '';
    };
    // `t` solo se usa al crear el reproductor; cambiarlo no debe recrearlo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, playerEvents, canPlay]);

  // Cambió ?t= con el reproductor ya creado (salto desde el reporte a la misma sesión).
  useEffect(() => {
    if (t === undefined || !data || !player.current) return;
    try {
      player.current.goto(Math.max(0, data.session.startedAt + t - playerStart), false);
    } catch {
      /* instante fuera de la grabación */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  if (error) {
    return (
      <Layout>
        <ErrorState message={error} onRetry={() => setAttempt((n) => n + 1)} home />
      </Layout>
    );
  }
  if (data === undefined) {
    return (
      <Layout wide>
        <PageSkeleton />
      </Layout>
    );
  }
  if (data === null || !session) {
    return (
      <Layout>
        <EmptyState
          art="lost"
          title="No encontramos esta sesión"
          action={
            <Button asChild>
              <Link to={{ name: 'recordings' }}>Ver todas las sesiones</Link>
            </Button>
          }
        >
          <p>Puede que se haya borrado, o que el link sea de otra computadora{IS_DEMO ? ' o de otro navegador' : ''}.</p>
        </EmptyState>
      </Layout>
    );
  }

  const goto = (epoch: number): void => {
    try {
      player.current?.goto(Math.max(0, epoch - playerStart), false);
    } catch {
      /* instante fuera de la grabación */
    }
  };
  let activeIndex = -1;
  for (let i = 0; i < steps.length; i++) if (steps[i]!.t - playerStart <= current) activeIndex = i;

  const patch = async (change: Parameters<Awaited<ReturnType<typeof getClient>>['patchSession']>[1], failMessage: string): Promise<boolean> => {
    try {
      setSession(await (await getClient()).patchSession(session.id, change));
      return true;
    } catch (e) {
      toast.error(friendlyError(e, failMessage));
      return false;
    }
  };

  const onExport = (): void => {
    downloadText(exportFileName(session), JSON.stringify({ v: 1, exportedAt: Date.now(), ...data, session }));
  };

  const study = data.study;
  const results = new Map((session.tasks ?? []).map((r) => [r.taskId, r]));
  const answers = new Map((session.answers ?? []).map((a) => [a.blockId, a]));
  const studyRows = study ? studyBlocks(study).filter((b) => isTaskBlock(b) || isQuestionBlock(b)) : [];
  const screens = session.screenCount ?? data.pages.length;

  return (
    <Layout wide>
      <header className="flex items-start gap-3 min-w-0">
        <Button variant="ghost" size="icon" asChild className="shrink-0 mt-0.5">
          <Link to={session.studyId ? { name: 'recordings', study: session.studyId } : { name: 'recordings' }} aria-label="Volver a las sesiones">
            <ArrowLeft />
          </Link>
        </Button>
        <div className="min-w-0 space-y-1.5">
          <LabelEditor size="lg" session={session} onSave={async (label) => void (await patch({ label }, 'No se pudo guardar la etiqueta.'))} />
          <p className="text-muted-foreground text-sm flex items-center gap-x-3 gap-y-1 flex-wrap">
            <span className="whitespace-nowrap">{formatDate(session.startedAt)}</span>
            <span className="whitespace-nowrap">Duró {formatDuration(session.durationMs)}</span>
            {session.excluded && <Badge variant="outline">Excluida del reporte</Badge>}
          </p>
        </div>
      </header>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-12">
        <div className="space-y-12 min-w-0">
          <Card className="py-4">
            <CardContent className="px-2 sm:px-4">
              {canPlay ? (
                <div ref={frame} className="flex justify-center overflow-x-auto" />
              ) : (
                <p className="text-muted-foreground text-sm py-10 text-center">
                  Esta sesión no tiene grabación para reproducir (duró muy poco o el archivo solo trae los pasos). La lista de pasos sí está completa.
                </p>
              )}
            </CardContent>
          </Card>

          {study && studyRows.length > 0 && (
            <Section
              title={
                <span className="flex items-center gap-2">
                  <ListChecks className="size-4.5 text-muted-foreground" /> Resultado de tareas
                </span>
              }
              description="Toca una tarea para ir a su inicio. Si viste otra cosa en la grabación, corrige el resultado."
            >
              <div className="rounded-2xl border border-border/70 bg-card px-(--card-pad) py-1">
                <ol className="divide-y">
                  {studyRows.map((b, i) =>
                    isTaskBlock(b) ? (
                      <TaskRow
                        key={b.id}
                        index={i}
                        block={b}
                        result={results.get(b.id)}
                        onGoto={goto}
                        onManual={(value) => void patch({ manual: { [b.id]: value } as SessionPatch['manual'] }, 'No se pudo guardar el resultado.')}
                      />
                    ) : isQuestionBlock(b) ? (
                      <AnswerRow key={b.id} index={i} block={b} answer={answers.get(b.id)} onGoto={goto} />
                    ) : null,
                  )}
                </ol>
              </div>
            </Section>
          )}

          <NotesCard key={session.id} notes={session.notes ?? ''} onSave={(notes) => patch({ notes }, 'No se pudieron guardar las notas.')} />
        </div>

        <aside className="space-y-10 min-w-0 lg:sticky lg:top-6 lg:self-start lg:max-h-[calc(100dvh-3rem)] lg:flex lg:flex-col">
          <section className="space-y-4" aria-labelledby="participante">
            <h2 id="participante" className="type-subsection">
              Participante
            </h2>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Dispositivo</dt>
              <dd className="inline-flex items-center gap-1.5 min-w-0">
                {session.touch ? <Smartphone className="size-4 shrink-0" aria-hidden /> : <Monitor className="size-4 shrink-0" aria-hidden />}
                <span className="break-words">{session.deviceLabel}</span>
              </dd>
              <dt className="text-muted-foreground">Pantalla</dt>
              <dd className="tabular-nums">
                {session.viewport.width}×{session.viewport.height}
              </dd>
              {session.label && session.participant && (
                <>
                  <dt className="text-muted-foreground">Alias</dt>
                  <dd className="break-words">{session.participant}</dd>
                </>
              )}
              {study && (
                <>
                  <dt className="text-muted-foreground">Estudio</dt>
                  <dd className="break-words">
                    {study.name}
                    {session.variantId ? ` · variante ${session.variantId}` : ''}
                  </dd>
                </>
              )}
            </dl>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3 pt-1">
              <div className="flex items-center gap-2">
                <Switch
                  id="excluir"
                  checked={session.excluded === true}
                  onCheckedChange={(excluded) => void patch({ excluded }, 'No se pudo cambiar la sesión.').then((ok) => ok && toast(excluded ? 'La sesión ya no cuenta en el reporte.' : 'La sesión vuelve a contar en el reporte.'))}
                />
                <Label htmlFor="excluir" className="mb-0 font-normal" title="Para pruebas internas o sesiones que no valen: se conserva la grabación, pero no cuenta en los resultados.">
                  Excluir del reporte
                </Label>
              </div>
              <Button variant="outline" size="sm" onClick={onExport}>
                <Download /> Exportar sesión
              </Button>
            </div>
          </section>

          <section className="space-y-4 min-h-0 lg:flex lg:flex-col" aria-labelledby="pasos-sesion">
            <div className="space-y-1">
              <h2 id="pasos-sesion" className="type-subsection">
                Pasos
              </h2>
              <p className="text-sm text-muted-foreground">
                {plural(screens, 'pantalla', 'pantallas')} · {plural(session.tapCount, 'toque', 'toques')}.{canPlay ? ' Toca un paso para ir a ese momento.' : ''}
              </p>
            </div>
            <div className="-mx-2 overflow-y-auto max-h-[60vh] lg:max-h-none lg:min-h-0">
            {steps.length === 0 ? (
              <p className="px-2 py-4 text-sm text-muted-foreground">Esta sesión no registró toques ni cambios de pantalla.</p>
            ) : (
              <ol className="space-y-0.5">
                {steps.map((e, i) => {
                  const marker = e.type === 'task' || e.type === 'study';
                  return (
                    <li key={i}>
                      <button
                        type="button"
                        disabled={!canPlay}
                        onClick={() => goto(e.t)}
                        aria-current={i === activeIndex ? 'step' : undefined}
                        className={cn(
                          'w-full text-left flex items-start gap-2 rounded-md px-2 py-1.5 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                          canPlay && 'hover:bg-accent cursor-pointer',
                          i === activeIndex && 'bg-accent',
                          marker && 'font-medium',
                        )}
                      >
                        <span className="text-muted-foreground tabular-nums w-10 shrink-0 text-xs pt-0.5">{formatDuration(e.t - session.startedAt)}</span>
                        <span className="pt-0.5" aria-hidden>
                          <StepIcon e={e} />
                        </span>
                        <span className="min-w-0 break-words">{describe(e, blocks, screenName)}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
            </div>
          </section>
        </aside>
      </div>
    </Layout>
  );
}

function TaskRow({
  index,
  block,
  result,
  onGoto,
  onManual,
}: {
  index: number;
  block: TaskBlock;
  result: TaskResult | undefined;
  onGoto: (t: number) => void;
  /** null quita la marca: el resultado vuelve a ser el de la regla, o "por revisar". */
  onManual: (value: 'success' | 'failure' | null) => void;
}) {
  const firstClick = blockKind(block) === 'first-click';
  const badge = result ? outcomeBadge(block, result) : { label: 'No empezó', className: 'border-border text-muted-foreground' };
  const detail: string[] = [];
  if (result) {
    if (result.durationMs !== undefined) detail.push(seconds(result.durationMs));
    if (result.ruleMatched) detail.push('cumplió el objetivo');
    if (result.reported === 'done') detail.push('tocó «Listo, terminé»');
    if (result.reported === 'skip') detail.push('tocó «No pude»');
    if (result.manual) detail.push(`tú marcaste: ${result.manual === 'success' ? 'lo logró' : 'no lo logró'}`);
    if (firstClick && result.firstTap) detail.push(`primer toque: ${result.firstTap.text ? `«${result.firstTap.text}»` : result.firstTap.selector}`);
  }
  const started = result?.startedAt;
  // Si la regla ya decidió (o el participante dijo "No pude"), marcar es corregir ese resultado.
  const decided = Boolean(result) && !result?.manual && !needsReview(block, result as TaskResult);
  const correcting = decided || (Boolean(result?.manual) && block.success?.type !== 'manual');

  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-3">
      <button
        type="button"
        className="flex-1 text-left min-w-0 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 enabled:cursor-pointer disabled:cursor-default"
        disabled={started === undefined}
        onClick={() => started !== undefined && onGoto(started)}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-muted-foreground tabular-nums text-xs w-4">{index + 1}</span>
          <span className="font-medium">{blockTitle(block) || 'Tarea sin título'}</span>
          {firstClick && <Badge variant="secondary">{BLOCK_KIND_LABELS['first-click']}</Badge>}
          <Badge variant="outline" className={badge.className}>
            {badge.label}
          </Badge>
        </div>
        {detail.length > 0 && <div className="text-muted-foreground text-xs pl-6 mt-0.5">{detail.join(' · ')}</div>}
      </button>
      {result && result.outcome !== 'pending' && (
        <div className="flex flex-wrap items-center gap-1.5 shrink-0 pl-6 sm:pl-0" role="group" aria-label={correcting ? 'Corregir resultado' : 'Tu veredicto'}>
          <span className="text-xs text-muted-foreground w-full sm:w-auto sm:mr-1">{correcting ? 'Corregir resultado:' : 'Tu veredicto:'}</span>
          <Button
            variant="outline"
            size="sm"
            aria-pressed={result.manual === 'success'}
            className={cn(result.manual === 'success' && 'border-emerald-600/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20')}
            onClick={() => onManual('success')}
          >
            <Check /> Lo logró
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-pressed={result.manual === 'failure'}
            className={cn(result.manual === 'failure' && 'border-red-600/50 bg-red-500/15 text-red-700 dark:text-red-400 hover:bg-red-500/20')}
            onClick={() => onManual('failure')}
          >
            <X /> No lo logró
          </Button>
          {result.manual && (
            <Button variant="ghost" size="sm" onClick={() => onManual(null)} title={block.success?.type === 'manual' ? 'Vuelve a quedar por revisar' : 'Vuelve a valer lo que decidió la regla'}>
              <Undo2 /> Quitar marca
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

function AnswerRow({ index, block, answer, onGoto }: { index: number; block: QuestionBlock; answer: AnswerResult | undefined; onGoto: (t: number) => void }) {
  return (
    <li className="py-3">
      <button
        type="button"
        className="w-full text-left rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 enabled:cursor-pointer disabled:cursor-default"
        disabled={!answer}
        onClick={() => answer && onGoto(answer.t)}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-muted-foreground tabular-nums text-xs w-4">{index + 1}</span>
          <span className="font-medium">{block.question || 'Pregunta sin texto'}</span>
          <Badge variant="secondary">{BLOCK_KIND_LABELS[block.kind]}</Badge>
        </div>
        <div className={cn('pl-6 mt-0.5 text-sm break-words', (!answer || answer.value === null) && 'text-muted-foreground')}>
          {!answer ? 'No llegó a esta pregunta' : answer.value === null ? 'La saltó' : answerText(answer.value, block)}
        </div>
      </button>
    </li>
  );
}

/** Notas del moderador. Se guardan solas al dejar de escribir. */
function NotesCard({ notes, onSave }: { notes: string; onSave: (notes: string) => Promise<boolean> }) {
  const [value, setValue] = useState(notes);
  const [state, setState] = useState<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>('idle');
  const saved = useRef(notes);
  const latest = useRef(notes);
  const save = useRef(onSave);
  save.current = onSave;

  const flush = async (): Promise<void> => {
    const text = latest.current;
    if (text === saved.current) return;
    setState('saving');
    const ok = await save.current(text);
    if (ok) saved.current = text;
    setState(ok ? (latest.current === text ? 'saved' : 'dirty') : 'error');
  };

  useEffect(() => {
    if (state !== 'dirty') return;
    const timer = setTimeout(() => void flush(), 800);
    return () => clearTimeout(timer);
  }, [value, state]);

  // Al salir de la página, guarda lo que falte.
  useEffect(
    () => () => {
      if (latest.current !== saved.current) void save.current(latest.current);
    },
    [],
  );

  return (
    <section className="space-y-4" aria-labelledby="notas-titulo">
      <div className="space-y-1">
        <h2 id="notas-titulo" className="type-subsection flex items-center gap-2">
          <NotebookPen className="size-4.5 text-muted-foreground" /> <label htmlFor="notas">Notas</label>
        </h2>
        <p className="text-sm text-muted-foreground">Lo que observaste o lo que la persona dijo en voz alta. Solo las ves tú.</p>
      </div>
      <div className="space-y-1.5">
        <Textarea
          id="notas"
          value={value}
          maxLength={SESSION_LIMITS.notes}
          placeholder="Por ejemplo: dudó entre «Carrito» y «Mis pedidos»; dijo que esperaba ver el costo de envío antes."
          className="min-h-28 bg-card"
          onChange={(e) => {
            latest.current = e.target.value;
            setValue(e.target.value);
            setState('dirty');
          }}
          onBlur={() => void flush()}
        />
        <p className="text-xs text-muted-foreground h-4" aria-live="polite">
          {state === 'saving' || state === 'dirty' ? 'Guardando…' : state === 'saved' ? 'Guardado' : state === 'error' ? 'No se pudo guardar. Se intentará de nuevo cuando sigas escribiendo.' : ''}
        </p>
      </div>
    </section>
  );
}
