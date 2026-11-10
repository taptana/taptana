import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Flame, PlayCircle, Route as RouteIcon, Users } from 'lucide-react';
import { OUTCOME_LABELS, taskBlocks, type ScreenReport, type TaskBlock, type TaskOutcomeCounts, type TaskReport, type TaskReportRow } from '@taptana/shared';
import { getClient } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { HeatCanvas, type HeatMode } from '@/components/heatmap';
import { friendlyError } from '@/lib/errors';
import { pct, plural, screenName, seconds } from '@/lib/format';
import { prototypeFrameUrl } from '@/lib/links';
import { cn } from '@/lib/utils';
import { Link } from '@/router';
import { recordingRoute, useReport } from './context.tsx';
import { biggestDrop, fallbackHeight, funnelSteps, OUTCOME_ORDER, placePoints, ruleText, samePages } from './logic.ts';
import { ScoreChip, Stat } from './overview.tsx';
import { SnapshotView, type Backdrop } from './snapshot-view.tsx';

type OutcomeKey = keyof TaskOutcomeCounts;

const OUTCOME_COLOR: Record<OutcomeKey, string> = {
  direct: 'bg-emerald-600',
  indirect: 'bg-emerald-300',
  review: 'bg-sky-400',
  reported: 'bg-amber-400',
  failed: 'bg-red-500',
  incomplete: 'bg-zinc-300 dark:bg-zinc-600',
};

const OUTCOME_BADGE: Record<OutcomeKey, string> = {
  direct: 'border-emerald-600/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/10',
  indirect: 'border-emerald-600/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/10',
  review: 'border-sky-600/40 text-sky-700 dark:text-sky-400 bg-sky-500/10',
  reported: 'border-amber-600/40 text-amber-700 dark:text-amber-400 bg-amber-500/10',
  failed: 'border-red-600/40 text-red-700 dark:text-red-400 bg-red-500/10',
  incomplete: 'border-border text-muted-foreground',
};

const OUTCOME_HELP: Record<OutcomeKey, string> = {
  direct: 'Lo logró por el camino esperado',
  indirect: 'Lo logró dando vueltas',
  review: 'Tocó "Listo"; falta que decidas si lo logró',
  reported: 'Tocó "Listo" sin cumplir la regla',
  failed: 'Tocó "No pude"',
  incomplete: 'Dejó la tarea a medias',
};

/** En primer clic solo hay acierto o fallo. */
function outcomeLabel(key: OutcomeKey, firstClick: boolean): string {
  if (firstClick && (key === 'direct' || key === 'indirect')) return 'Acertó';
  if (firstClick && key === 'failed') return 'Tocó en otro lado';
  return OUTCOME_LABELS[key];
}

function OutcomeBar({ task }: { task: TaskReport }) {
  const firstClick = task.kind === 'first-click';
  const total = Math.max(1, task.participants);
  const present = OUTCOME_ORDER.filter((k) => task.outcomes[k] > 0);
  const summary = present.map((k) => `${outcomeLabel(k, firstClick)}: ${task.outcomes[k]}`).join(', ');
  return (
    <div className="space-y-3" data-print="keep">
      <div className="flex h-9 w-full overflow-hidden rounded-lg bg-muted" role="img" aria-label={`Resultados de ${plural(task.participants, 'participante', 'participantes')}. ${summary}`}>
        {present.map((k) => (
          <div
            key={k}
            className={cn('grid place-items-center text-xs font-medium text-white/95 min-w-1', OUTCOME_COLOR[k], (k === 'indirect' || k === 'incomplete' || k === 'reported' || k === 'review') && 'text-zinc-900/80')}
            style={{ width: `${(task.outcomes[k] / total) * 100}%` }}
            title={`${outcomeLabel(k, firstClick)}: ${task.outcomes[k]}`}
          >
            {task.outcomes[k] / total >= 0.12 ? pct(task.outcomes[k] / total) : ''}
          </div>
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {present.map((k) => (
          <li key={k} className="flex items-center gap-2" title={OUTCOME_HELP[k]}>
            <span className={cn('size-3 rounded-sm shrink-0', OUTCOME_COLOR[k])} aria-hidden="true" />
            <span>{outcomeLabel(k, firstClick)}</span>
            <span className="font-medium tabular-nums">{task.outcomes[k]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Funnel({ task }: { task: TaskReport }) {
  const steps = useMemo(() => funnelSteps(task.funnel, task.participants, screenName), [task]);
  if (steps.length < 2) return null;
  const worst = biggestDrop(steps);
  return (
    <div className="space-y-3" data-print="keep">
      <div>
        <h4 className="font-medium">Embudo del camino esperado</h4>
        <p className="text-sm text-muted-foreground">
          Cuántas personas llegaron a cada paso, en orden.
          {task.expectedPathInferred && ' Esta tarea no tiene camino esperado: se usa el más corto de quienes lo lograron.'}
        </p>
      </div>
      <ol className="space-y-1.5">
        {steps.map((step, i) => (
          <li key={`${step.path}-${i}`}>
            {step.note && (
              <p className={cn('ml-9 mb-1.5 text-xs', i === worst ? 'text-red-600 dark:text-red-400 font-medium' : 'text-muted-foreground')}>
                ↓ {step.note}
                {i === worst && steps.filter((s) => s.lost > 0).length > 1 && ' (la caída más grande)'}
              </p>
            )}
            <div className="flex items-center gap-3">
              <span className="size-6 shrink-0 rounded-full bg-muted grid place-items-center text-xs font-medium tabular-nums">{i + 1}</span>
              <div className="relative flex-1 min-w-0 h-9 rounded-md bg-muted overflow-hidden">
                <div className="absolute inset-y-0 left-0 bg-emerald-500/30 dark:bg-emerald-500/40" style={{ width: `${step.rate * 100}%` }} />
                <div className="relative h-full flex items-center justify-between gap-3 px-3 text-sm">
                  <span className="truncate">{screenName(step.path)}</span>
                  <span className="tabular-nums whitespace-nowrap">
                    <span className="font-medium">{step.reached}</span> de {task.participants} · {pct(step.rate)}
                  </span>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function VariantTable({ task }: { task: TaskReport }) {
  const { study } = useReport();
  if (task.byVariant.length === 0) return null;
  const name = (id: string): string => study.variants?.find((v) => v.id === id)?.name ?? id;
  return (
    <div className="space-y-2" data-print="keep">
      <h4 className="font-medium">Por variante (A/B)</h4>
      <div className="grid gap-3 sm:grid-cols-2">
        {task.byVariant.map((v) => (
          <div key={v.variantId} className="rounded-lg border p-3 space-y-2">
            <div className="font-medium text-sm truncate">{name(v.variantId)}</div>
            <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
              <Stat label="Puntaje" value={<ScoreChip score={v.score} />} />
              <Stat label="Éxito" value={v.decided ? pct(v.successRate) : '—'} />
              <Stat label="Directo" value={v.decided ? pct(v.directRate) : '—'} />
              <Stat label="Tiempo" value={seconds(v.medianTimeMs)} />
              <Stat label="Participantes" value={v.participants} />
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Pantallas y mapas de calor ──

const MODES: Array<{ id: HeatMode; label: string }> = [
  { id: 'heat', label: 'Mapa de calor' },
  { id: 'dots', label: 'Cada toque' },
  { id: 'misclicks', label: 'Solo misclicks' },
];

function ScreenCard({ screen, task, mode, anchor, highlighted }: { screen: ScreenReport; task: TaskReport; mode: HeatMode; anchor: string; highlighted: boolean }) {
  const ctx = useReport();
  const [backdrop, setBackdrop] = useState<Backdrop | null>(null);
  const vw = screen.sample?.vw || screen.viewportWidth || 390;
  const wide = vw > 700;
  // El mapa nunca es más ancho que la tarjeta (celulares angostos).
  const holder = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);
  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const update = (): void => setAvailable(Math.floor(el.clientWidth));
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const wanted = wide ? 460 : 260;
  const displayWidth = available > 0 ? Math.max(120, Math.min(wanted, available)) : wanted;
  const estimated = useMemo(() => fallbackHeight(screen.taps, vw), [screen.taps, vw]);
  const left = useMemo(() => placePoints(screen.taps, vw, estimated).left, [screen.taps, vw, estimated]);
  const liveSrc = ctx.proto?.url ? prototypeFrameUrl(ctx.proto, { screen: screen.path, preview: true }) : null;
  const okSessions = useMemo(() => new Set(task.results.filter((r) => r.outcome === 'direct' || r.outcome === 'indirect').map((r) => r.sessionId)), [task.results]);
  const name = screenName(screen.path);
  const drawn = screen.taps.length - left;

  return (
    <article id={anchor} className={cn('rounded-xl border bg-background p-4 space-y-4 scroll-mt-20 min-w-0', wide && 'col-span-full', highlighted && 'ring-2 ring-primary/60')} data-print="keep">
      <header className="space-y-1">
        <h5 className="font-medium break-words">{screen.title && screen.title !== name ? `${screen.title}` : name}</h5>
        <p className="text-xs text-muted-foreground break-all">{screen.path}</p>
      </header>
      <dl className="grid grid-cols-3 gap-2 text-sm">
        <Stat label="Visitas" value={screen.visitors} />
        <Stat label="Tiempo promedio" value={seconds(screen.avgTimeMs)} />
        <Stat label="Misclicks" value={screen.misclicks} />
      </dl>
      <div ref={holder} className="flex justify-center">
        <SnapshotView
          sample={screen.sample}
          viewportWidth={vw}
          displayWidth={displayWidth}
          liveSrc={liveSrc}
          estimatedHeight={estimated}
          eager={ctx.printing}
          preferNextLoad={screen.taps.length === 0}
          label={`Pantalla ${name} con ${plural(drawn, 'toque', 'toques')}`}
          onBackdrop={setBackdrop}
        >
          {({ docHeight, scale }) => {
            const points = placePoints(screen.taps, vw, docHeight).shown.map((p) => ({ ...p, ok: okSessions.has(p.sessionId) }));
            return <HeatCanvas points={points} width={vw} height={docHeight} scale={scale} mode={mode} />;
          }}
        </SnapshotView>
      </div>
      <div className="space-y-1 text-xs text-muted-foreground">
        {backdrop === 'snapshot' && screen.sample && (
          <p>
            Fondo: lo que vio {ctx.names.get(screen.sample.sessionId) ?? 'un participante'} ({vw} px de ancho).{' '}
            <Link to={recordingRoute(ctx, screen.sample.sessionId, screen.sample.t)} className="underline underline-offset-4 hover:text-foreground" data-print="hide">
              Ver ese momento
            </Link>
          </p>
        )}
        {backdrop === 'live' && <p>Fondo: el prototipo como está ahora (no hay foto de la grabación). Si la pantalla cambia según lo que se haga, los toques pueden no calzar.</p>}
        <p>
          {plural(drawn, 'toque dibujado', 'toques dibujados', 'Sin toques en esta pantalla')}
          {left > 0 && `. ${plural(left, 'toque quedó fuera', 'toques quedaron fuera')} por venir de pantallas de otro tamaño`}.
        </p>
      </div>
      {screen.topMisclicks.length > 0 && (
        <div className="space-y-1.5">
          <h6 className="text-sm font-medium">Elementos más tocados sin efecto</h6>
          <ul className="space-y-1 text-sm">
            {screen.topMisclicks.map((m) => (
              <li key={m.label} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 break-words">{m.label}</span>
                <span className="tabular-nums text-muted-foreground whitespace-nowrap">{plural(m.count, 'vez', 'veces')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

function ScreensPanel({ task, focusScreen }: { task: TaskReport; focusScreen: string | undefined }) {
  const firstClick = task.kind === 'first-click';
  const [mode, setMode] = useState<HeatMode>('heat');
  const anchor = (i: number): string => `pantalla-${task.taskId}-${i}`;

  useEffect(() => {
    if (!focusScreen) return;
    const i = task.screens.findIndex((s) => s.path === focusScreen);
    if (i < 0) return;
    const timer = setTimeout(() => document.getElementById(anchor(i))?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusScreen, task.taskId]);

  if (task.screens.length === 0) return <p className="text-sm text-muted-foreground">Todavía no hay pantallas visitadas en esta tarea.</p>;

  return (
    <div className="space-y-4">
      {firstClick ? (
        <div className="space-y-1">
          <h4 className="font-medium">Dónde cayó el primer toque</h4>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-3 rounded-full bg-emerald-600" aria-hidden="true" /> Acertó ({task.outcomes.direct + task.outcomes.indirect})
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-3 rounded-full bg-red-600" aria-hidden="true" /> Tocó en otro lado ({task.outcomes.failed})
            </span>
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="radiogroup" aria-label="Qué mostrar sobre las pantallas" className="inline-flex max-w-full overflow-x-auto rounded-lg bg-muted p-1 gap-1" data-print="hide">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={mode === m.id}
                onClick={() => setMode(m.id)}
                className={cn(
                  'shrink-0 cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  mode === m.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {mode === 'heat' && 'Rojo intenso = muchos toques en el mismo lugar.'}
            {mode === 'dots' && 'Azul: toque con efecto. Rojo: misclick (toque sin efecto).'}
            {mode === 'misclicks' && 'Solo los toques que cayeron donde no pasa nada.'}
          </p>
        </div>
      )}
      <div className="tt-screens grid gap-4 grid-cols-[repeat(auto-fill,minmax(min(18.5rem,100%),1fr))]">
        {task.screens.map((s, i) => (
          <ScreenCard key={s.path} screen={s} task={task} mode={firstClick ? 'first-click' : mode} anchor={anchor(i)} highlighted={focusScreen === s.path} />
        ))}
      </div>
    </div>
  );
}

// ── Caminos ──

function PathChips({ pages }: { pages: string[] }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {pages.map((p, i) => (
        <span key={`${p}-${i}`} className="inline-flex items-center gap-1.5">
          {i > 0 && <ArrowRight className="size-3 text-muted-foreground" aria-label="luego" />}
          <span className="rounded-md bg-muted px-2 py-0.5 text-xs" title={p}>
            {screenName(p)}
          </span>
        </span>
      ))}
      {pages.length === 0 && <span className="text-xs text-muted-foreground">No se movió de la pantalla inicial</span>}
    </span>
  );
}

function PathsPanel({ task }: { task: TaskReport }) {
  const ctx = useReport();
  const [pending, setPending] = useState<string[] | null>(null);
  const canSet = task.kind === 'task';

  const save = async (): Promise<void> => {
    if (!pending) return;
    try {
      const client = await getClient();
      const fresh = await client.getStudy(ctx.study.id);
      if (!fresh) throw new Error('El estudio ya no existe.');
      const block = taskBlocks(fresh).find((b) => b.id === task.taskId);
      if (!block) throw new Error('Esta tarea ya no está en el estudio.');
      block.expectedPath = [...pending];
      await client.saveStudy(fresh, fresh.id);
      toast.success('Camino esperado guardado. El reporte se actualizó.');
      await ctx.reload();
    } catch (e) {
      toast.error(friendlyError(e, 'No se pudo guardar el camino esperado. Inténtalo de nuevo.'));
    }
  };

  if (task.paths.length === 0) return <p className="text-sm text-muted-foreground">Todavía no hay caminos recorridos en esta tarea.</p>;

  return (
    <div className="space-y-4">
      {task.expectedPath.length > 0 && (
        <div className="rounded-lg border bg-muted/40 p-3 space-y-1.5" data-print="keep">
          <p className="text-sm font-medium">
            Camino esperado{' '}
            {task.expectedPathInferred && <span className="font-normal text-muted-foreground">(deducido: el más corto de quienes lo lograron)</span>}
          </p>
          <PathChips pages={task.expectedPath} />
        </div>
      )}
      <ul className="space-y-2">
        {task.paths.map((p, i) => {
          const isExpected = samePages(p.pages, task.expectedPath);
          return (
            <li key={i} className="rounded-lg border bg-background p-3 space-y-2" data-print="keep">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  <span className="font-medium">{plural(p.count, 'persona', 'personas')}</span>
                  <span className="text-muted-foreground">
                    {' · '}
                    {p.successes === p.count ? (p.count === 1 ? 'lo logró' : 'todas lo lograron') : p.successes === 0 ? (p.count === 1 ? 'no lo logró' : 'ninguna lo logró') : `${p.successes} lo lograron`}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  {isExpected && <Badge variant="outline">Camino esperado</Badge>}
                  {canSet && p.successes > 0 && p.pages.length > 0 && (!isExpected || task.expectedPathInferred) && (
                    <Button variant="outline" size="sm" onClick={() => setPending(p.pages)} data-print="hide">
                      Usar como camino esperado
                    </Button>
                  )}
                </span>
              </div>
              <PathChips pages={p.pages} />
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title="¿Usar este camino como el esperado?"
        description={
          <span className="block space-y-3">
            <span className="block">Quienes sigan exactamente este camino contarán como éxito directo; el resto de quienes lo logren, como indirecto. El reporte se vuelve a calcular con las sesiones que ya tienes.</span>
            <span className="block">{pending && <PathChips pages={pending} />}</span>
          </span>
        }
        confirmLabel="Usar este camino"
        onConfirm={save}
      />
    </div>
  );
}

// ── Participantes ──

function ParticipantsPanel({ task }: { task: TaskReport }) {
  const ctx = useReport();
  const firstClick = task.kind === 'first-click';
  const variantName = (id: string | undefined): string | undefined => (id ? (ctx.study.variants?.find((v) => v.id === id)?.name ?? id) : undefined);
  const who = (r: TaskReportRow): string => ctx.names.get(r.sessionId) ?? r.who ?? 'Participante';

  if (task.results.length === 0) return <p className="text-sm text-muted-foreground">Nadie empezó esta tarea todavía.</p>;

  return (
    <ul className="divide-y rounded-lg border bg-background">
      {task.results.map((r) => {
        const session = ctx.sessions.get(r.sessionId);
        const variant = variantName(r.variantId);
        return (
          <li key={r.sessionId} className="grid gap-x-4 gap-y-2 p-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] sm:items-center" data-print="keep">
            <div className="min-w-0">
              <div className="font-medium truncate">{who(r)}</div>
              <div className="text-xs text-muted-foreground truncate">
                {session?.deviceLabel ?? 'Dispositivo desconocido'}
                {variant && ` · ${variant}`}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <Badge variant="outline" className={OUTCOME_BADGE[r.outcome]} title={OUTCOME_HELP[r.outcome]}>
                {outcomeLabel(r.outcome, firstClick)}
              </Badge>
              <span className="tabular-nums text-muted-foreground">{seconds(r.durationMs)}</span>
              {!firstClick && <span className="tabular-nums text-muted-foreground">{plural(r.misclicks, 'misclick', 'misclicks', 'sin misclicks')}</span>}
            </div>
            <div className="flex flex-wrap items-center gap-1" data-print="hide">
              <Button variant="ghost" size="sm" asChild>
                <Link to={recordingRoute(ctx, r.sessionId, r.startedAt)} aria-label={`Ver la grabación de ${who(r)} desde el inicio de esta tarea`}>
                  <PlayCircle />
                  {r.outcome === 'review' ? 'Revisar grabación' : 'Ver grabación'}
                </Link>
              </Button>
              {r.goalAt !== undefined && !firstClick && (
                <Button variant="ghost" size="sm" asChild>
                  <Link to={recordingRoute(ctx, r.sessionId, r.goalAt, 3000)} title="Abre la grabación 3 segundos antes de que se cumpliera la regla">
                    Ver cuando lo logró
                  </Link>
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ── La sección de una tarea ──

type TabId = 'screens' | 'paths' | 'people';

/** Todo lo de una tarea o primer clic: resultados, números, embudo y pestañas de detalle. */
export function TaskBody({ task, block, focusScreen }: { task: TaskReport; block: TaskBlock | undefined; focusScreen: string | undefined }) {
  const { printing } = useReport();
  const [tab, setTab] = useState<TabId>('screens');
  const firstClick = task.kind === 'first-click';

  useEffect(() => {
    if (focusScreen) setTab('screens');
  }, [focusScreen]);

  if (task.participants === 0) {
    return (
      <div className="space-y-2">
        {block?.instruction && <p className="text-muted-foreground">“{block.instruction}”</p>}
        <p className="text-sm text-muted-foreground">Nadie empezó esta tarea todavía.</p>
      </div>
    );
  }

  const tabs: Array<{ id: TabId; label: string; icon: React.ReactNode; count: number }> = [
    { id: 'screens', label: firstClick ? 'Dónde tocaron' : 'Pantallas y mapas de calor', icon: <Flame className="size-3.5" />, count: task.screens.length },
    { id: 'paths', label: 'Caminos', icon: <RouteIcon className="size-3.5" />, count: task.paths.length },
    { id: 'people', label: 'Participantes', icon: <Users className="size-3.5" />, count: task.results.length },
  ];
  const visibleTabs = firstClick ? tabs.filter((t) => t.id !== 'paths') : tabs;
  const panel = (id: TabId): React.ReactNode => (id === 'screens' ? <ScreensPanel task={task} focusScreen={focusScreen} /> : id === 'paths' ? <PathsPanel task={task} /> : <ParticipantsPanel task={task} />);

  return (
    <div className="space-y-6">
      {(block?.instruction || block?.success) && (
        <div className="space-y-1">
          {block.instruction && <p className="text-muted-foreground">“{block.instruction}”</p>}
          <p className="text-xs text-muted-foreground">{ruleText(block.success, screenName)}</p>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-print="keep">
        <div className="rounded-lg border p-3">
          <dt className="text-xs text-muted-foreground">Puntaje</dt>
          <dd className="text-2xl">
            <ScoreChip score={task.score} />
          </dd>
        </div>
        <div className="rounded-lg border p-3">
          <dt className="text-xs text-muted-foreground">{firstClick ? 'Acertaron' : 'Lo lograron'}</dt>
          <dd className="text-2xl font-semibold tabular-nums">{task.decided ? pct(task.successRate) : '—'}</dd>
          <dd className="text-xs text-muted-foreground">
            {task.decided
              ? `${task.outcomes.direct + task.outcomes.indirect} de ${task.decided}${task.outcomes.review > 0 ? ' ya decididos' : ''}`
              : 'Sin resultados decididos'}
            {task.outcomes.review > 0 && ` · ${task.outcomes.review} por revisar`}
          </dd>
        </div>
        <div className="rounded-lg border p-3">
          <dt className="text-xs text-muted-foreground">Tiempo mediano</dt>
          <dd className="text-2xl font-semibold tabular-nums">{seconds(task.medianTimeMs)}</dd>
          <dd className="text-xs text-muted-foreground">{firstClick ? 'Hasta el primer toque, de quienes acertaron' : 'De quienes lo lograron'}</dd>
        </div>
        <div className="rounded-lg border p-3">
          <dt className="text-xs text-muted-foreground">Misclicks</dt>
          <dd className="text-2xl font-semibold tabular-nums">{task.tapCount > 0 ? pct(task.misclickRate) : '—'}</dd>
          <dd className="text-xs text-muted-foreground">
            {task.tapCount > 0 ? `de ${plural(task.tapCount, 'toque', 'toques')} · ${task.avgMisclicks.toFixed(1).replace('.', ',')} por persona` : 'Sin toques'}
          </dd>
        </div>
      </dl>

      <OutcomeBar task={task} />
      {!firstClick && <Funnel task={task} />}
      <VariantTable task={task} />

      {printing ? (
        <div className="space-y-6">
          {visibleTabs.map((t) => (
            <div key={t.id} className="space-y-3">
              <h4 className="font-medium" data-print="heading">
                {t.label}
              </h4>
              {panel(t.id)}
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <div role="tablist" aria-label="Detalle de la tarea" className="inline-flex max-w-full overflow-x-auto rounded-lg bg-muted p-1 gap-1">
            {visibleTabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`tab-${task.taskId}-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls={`panel-${task.taskId}`}
                onClick={() => setTab(t.id)}
                className={cn(
                  'inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  tab === t.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t.icon}
                {t.label}
                <span className="text-xs text-muted-foreground tabular-nums">{t.count}</span>
              </button>
            ))}
          </div>
          <div role="tabpanel" id={`panel-${task.taskId}`} aria-labelledby={`tab-${task.taskId}-${firstClick && tab === 'paths' ? 'screens' : tab}`}>
            {panel(firstClick && tab === 'paths' ? 'screens' : tab)}
          </div>
        </div>
      )}
    </div>
  );
}
