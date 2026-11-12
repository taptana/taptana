import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, PlayCircle } from 'lucide-react';
import { tapMatches, taskOutcomeLabel, taskBlocks, type ScreenReport, type SuccessRule, type TaskBlock, type TaskOutcomeCounts, type TaskReport, type TaskReportRow } from '@taptana/shared';
import { getClient } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { HeatCanvas, type HeatMode } from '@/components/heatmap';
import { friendlyError } from '@/lib/errors';
import { pct, plural, seconds } from '@/lib/format';
import { prototypeFrameUrl } from '@/lib/links';
import { cn } from '@/lib/utils';
import { Link } from '@/router';
import { recordingRoute, useReport } from './context.tsx';
import { biggestDrop, fallbackHeight, funnelSteps, OUTCOME_ORDER, placePoints, ruleSelector, ruleText, samePages } from './logic.ts';
import { ScoreChip, Stat } from './overview.tsx';
import { loadSession, SnapshotView, type Backdrop } from './snapshot-view.tsx';

type OutcomeKey = keyof TaskOutcomeCounts;

export const OUTCOME_COLOR: Record<OutcomeKey, string> = {
  direct: 'bg-emerald-600',
  indirect: 'bg-emerald-300',
  review: 'bg-sky-400',
  reported: 'bg-amber-400',
  failed: 'bg-red-500',
  incomplete: 'bg-zinc-300 dark:bg-zinc-600',
};

export const OUTCOME_BADGE: Record<OutcomeKey, string> = {
  direct: 'border-emerald-600/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/10',
  indirect: 'border-emerald-600/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/10',
  review: 'border-sky-600/40 text-sky-700 dark:text-sky-400 bg-sky-500/10',
  reported: 'border-amber-600/40 text-amber-700 dark:text-amber-400 bg-amber-500/10',
  failed: 'border-red-600/40 text-red-700 dark:text-red-400 bg-red-500/10',
  incomplete: 'border-border text-muted-foreground',
};

export const OUTCOME_HELP: Record<OutcomeKey, string> = {
  direct: 'Lo logró por el camino esperado',
  indirect: 'Lo logró dando vueltas',
  review: 'Tocó "Listo"; falta que decidas si lo logró',
  reported: 'Tocó "Listo" sin cumplir la regla',
  failed: 'Tocó "No pude"',
  incomplete: 'Dejó la tarea a medias',
};

/** En primer clic solo hay acierto o fallo. */
export const outcomeLabel = taskOutcomeLabel;

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
  const { screenName } = useReport();
  const steps = useMemo(() => funnelSteps(task.funnel, task.participants, screenName), [task, screenName]);
  if (steps.length < 2) return null;
  const worst = biggestDrop(steps);
  return (
    <TaskSection
      title="Embudo del camino esperado"
      description={
        <>
          Cuántas personas llegaron a cada paso, en orden.
          {task.expectedPathInferred && ' Esta tarea no tiene camino esperado: se usa el más común de quienes lo lograron.'}
        </>
      }
      keep
    >
      <ol className="space-y-2">
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
    </TaskSection>
  );
}

function VariantTable({ task }: { task: TaskReport }) {
  const { study } = useReport();
  if (task.byVariant.length === 0) return null;
  const name = (id: string): string => study.variants?.find((v) => v.id === id)?.name ?? id;
  return (
    <div className="space-y-3" data-print="keep">
      <h3 className="font-display text-lg font-bold tracking-tight" data-print="heading">Por variante (A/B)</h3>
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
  const name = ctx.screenName(screen.path);
  const drawn = screen.taps.length - left;

  return (
    <article id={anchor} className={cn('rounded-xl border bg-card p-4 space-y-4 scroll-mt-20 min-w-0', wide && 'col-span-full', highlighted && 'ring-2 ring-primary/60')} data-print="keep">
      <header className="space-y-1">
        <h5 className="font-medium break-words">{name}</h5>
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
            <Link to={recordingRoute(ctx, screen.sample.sessionId, screen.sample.t)} className="underline decoration-primary/40 underline-offset-4 hover:text-primary hover:decoration-primary" data-print="hide">
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

function ScreensPanel({ task, focusScreen, limit }: { task: TaskReport; focusScreen: string | undefined; limit?: number }) {
  const firstClick = task.kind === 'first-click';
  // Al imprimir solo van las pantallas con más toques, en su orden original.
  const shown = useMemo(() => {
    if (!limit || task.screens.length <= limit) return task.screens;
    const top = new Set([...task.screens].sort((a, b) => b.taps.length - a.taps.length).slice(0, limit));
    return task.screens.filter((s) => top.has(s));
  }, [task.screens, limit]);
  const [mode, setMode] = useState<HeatMode>('heat');
  const [all, setAll] = useState(false);
  const anchor = (i: number): string => `pantalla-${task.taskId}-${i}`;
  const visible = limit || all ? shown : shown.slice(0, COLLAPSED);

  useEffect(() => {
    if (!focusScreen) return;
    const i = task.screens.findIndex((s) => s.path === focusScreen);
    if (i < 0) return;
    if (i >= COLLAPSED) setAll(true);
    const timer = setTimeout(() => document.getElementById(anchor(i))?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusScreen, task.taskId]);

  if (task.screens.length === 0) return <p className="text-sm text-muted-foreground">Todavía no hay pantallas visitadas en esta tarea.</p>;

  return (
    <div className="space-y-4">
      {firstClick ? (
        <div className="space-y-1">
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
          <div role="radiogroup" aria-label="Qué mostrar sobre las pantallas" className="flex w-fit max-w-full flex-wrap rounded-lg bg-muted p-1 gap-1" data-print="hide">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={mode === m.id}
                onClick={() => setMode(m.id)}
                className={cn(
                  'shrink-0 cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  mode === m.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
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
      <div className="tt-screens grid gap-5 grid-cols-[repeat(auto-fill,minmax(min(18.5rem,100%),1fr))]">
        {visible.map((s) => (
          <ScreenCard key={s.path} screen={s} task={task} mode={firstClick ? 'first-click' : mode} anchor={anchor(task.screens.indexOf(s))} highlighted={focusScreen === s.path} />
        ))}
      </div>
      {!limit && <ShowAll total={shown.length} open={all} onToggle={() => setAll((v) => !v)} noun="pantallas" />}
      {shown.length < task.screens.length && (
        <p className="text-xs text-muted-foreground">
          Se muestran las {shown.length} pantallas con más toques, de {task.screens.length}. El resto está en el reporte en pantalla.
        </p>
      )}
    </div>
  );
}

/** Cuántos elementos de una lista larga se ven antes de «Ver todos». */
const COLLAPSED = 5;

/** Botón «Ver todos (N)» / «Ver menos» para las listas largas del reporte. */
function ShowAll({ total, open, onToggle, noun }: { total: number; open: boolean; onToggle: () => void; noun: string }) {
  if (total <= COLLAPSED) return null;
  return (
    <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onToggle} data-print="hide">
      {open ? 'Ver menos' : `Ver todos los ${noun} (${total})`}
    </Button>
  );
}

/** Una sección dentro de una tarea: título, una línea de ayuda opcional y su contenido. */
export function TaskSection({ title, description, aside, keep, children }: { title: ReactNode; description?: ReactNode; aside?: ReactNode; keep?: boolean; children: ReactNode }) {
  return (
    <section className="space-y-4 min-w-0" {...(keep ? { 'data-print': 'keep' } : {})}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2" data-print="heading">
        <div className="min-w-0 space-y-1">
          <h3 className="font-display text-lg font-bold tracking-tight">{title}</h3>
          {description && <p className="max-w-prose text-sm text-muted-foreground leading-relaxed">{description}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

// ── Caminos ──

function PathChips({ pages }: { pages: string[] }) {
  const { screenName } = useReport();
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

function PathsPanel({ task, limit }: { task: TaskReport; limit?: number }) {
  const ctx = useReport();
  const [all, setAll] = useState(false);
  const paths = limit ? task.paths.slice(0, limit) : all ? task.paths : task.paths.slice(0, COLLAPSED);
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
    <div className="space-y-3">
      {task.expectedPath.length > 0 && (
        <div className="rounded-xl bg-muted/60 p-4 space-y-2" data-print="keep">
          <p className="text-sm font-medium">
            Camino esperado{' '}
            {task.expectedPathInferred && <span className="font-normal text-muted-foreground">(deducido: el más común de quienes lo lograron)</span>}
          </p>
          <PathChips pages={task.expectedPath} />
        </div>
      )}
      <ul className="space-y-2">
        {paths.map((p, i) => {
          const isExpected = samePages(p.pages, task.expectedPath);
          return (
            <li key={i} className="rounded-xl border border-border/70 bg-card p-4 space-y-2.5" data-print="keep">
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
      {!limit && <ShowAll total={task.paths.length} open={all} onToggle={() => setAll((v) => !v)} noun="caminos" />}
      {limit !== undefined && paths.length < task.paths.length && (
        <p className="text-xs text-muted-foreground">
          Se muestran los {paths.length} caminos más comunes, de {task.paths.length}.
        </p>
      )}
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

  const [all, setAll] = useState(false);
  if (task.results.length === 0) return <p className="text-sm text-muted-foreground">Nadie empezó esta tarea todavía.</p>;
  const rows = all ? task.results : task.results.slice(0, COLLAPSED);

  return (
    <div className="space-y-3">
    <ul className="divide-y rounded-xl border border-border/70 bg-card">
      {rows.map((r) => {
        const session = ctx.sessions.get(r.sessionId);
        const variant = variantName(r.variantId);
        return (
          <li key={r.sessionId} className="grid min-h-16 gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] sm:items-center" data-print="keep">
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
    <ShowAll total={task.results.length} open={all} onToggle={() => setAll((v) => !v)} noun="participantes" />
    </div>
  );
}

// ── La sección de una tarea ──

/**
 * El texto del elemento que pide la regla "Toca un elemento" («🛒»), para no mostrar un selector
 * CSS. Sale de un toque real de alguien que lo logró; null si todavía no se sabe.
 */
function useElementText(task: TaskReport, rule: SuccessRule | undefined): string | null {
  const selector = rule?.type === 'tapped' ? rule.selector : '';
  const sessionIds = useMemo(
    () => (selector ? task.results.filter((r) => r.outcome === 'direct' || r.outcome === 'indirect').slice(0, 2).map((r) => r.sessionId) : []),
    [selector, task.results],
  );
  const key = sessionIds.join(',');
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    setText(null);
    if (!selector || sessionIds.length === 0) return;
    let alive = true;
    (async () => {
      for (const id of sessionIds) {
        const session = await loadSession(id).catch(() => null);
        if (!alive) return;
        const tap = session?.taps.find((t) => t.target.text?.trim() && tapMatches(t, selector));
        if (tap?.target.text) {
          setText(tap.target.text.trim());
          return;
        }
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selector, key]);
  return text;
}

/**
 * Todo lo de una tarea o primer clic, una sección tras otra: números, embudo, mapas de calor,
 * caminos y participantes.
 */
export function TaskBody({ task, block, focusScreen }: { task: TaskReport; block: TaskBlock | undefined; focusScreen: string | undefined }) {
  const { printing, screenName } = useReport();
  const elementText = useElementText(task, block?.success);
  const selector = ruleSelector(block?.success);
  const firstClick = task.kind === 'first-click';

  if (task.participants === 0) {
    return (
      <div className="space-y-2">
        {block?.instruction && <p className="text-muted-foreground">“{block.instruction}”</p>}
        <p className="text-sm text-muted-foreground">Nadie empezó esta tarea todavía.</p>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {(block?.instruction || block?.success) && (
        <div className="space-y-1">
          {block.instruction && <p className="text-muted-foreground">“{block.instruction}”</p>}
          <p className="text-xs text-muted-foreground" data-testid="rule-text">
            <span title={selector ? `Selector: ${selector}` : undefined}>{ruleText(block.success, screenName, elementText)}</span>
            {selector && !elementText && (
              <>
                {' '}
                <span className="font-mono text-[0.6875rem] opacity-70 break-all" data-print="hide">
                  ({selector})
                </span>
              </>
            )}
          </p>
        </div>
      )}

      <TaskSection title="Resultado" keep>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl bg-muted/60 p-4 space-y-1">
          <dt className="text-xs text-muted-foreground">Puntaje</dt>
          <dd className="text-2xl">
            <ScoreChip score={task.score} />
          </dd>
        </div>
        <div className="rounded-xl bg-muted/60 p-4 space-y-1">
          <dt className="text-xs text-muted-foreground">{firstClick ? 'Acertaron' : 'Lo lograron'}</dt>
          <dd className="font-display text-2xl font-bold tabular-nums">{task.decided ? pct(task.successRate) : '—'}</dd>
          <dd className="text-xs text-muted-foreground">
            {task.decided
              ? `${task.outcomes.direct + task.outcomes.indirect} de ${task.decided}${task.outcomes.review > 0 ? ' ya decididos' : ''}`
              : 'Sin resultados decididos'}
            {task.outcomes.review > 0 && ` · ${task.outcomes.review} por revisar`}
          </dd>
        </div>
        <div className="rounded-xl bg-muted/60 p-4 space-y-1">
          <dt className="text-xs text-muted-foreground">Tiempo mediano</dt>
          <dd className="font-display text-2xl font-bold tabular-nums">{seconds(task.medianTimeMs)}</dd>
          <dd className="text-xs text-muted-foreground">{firstClick ? 'Hasta el primer toque, de quienes acertaron' : 'De quienes lo lograron'}</dd>
        </div>
        <div className="rounded-xl bg-muted/60 p-4 space-y-1">
          <dt className="text-xs text-muted-foreground">Misclicks</dt>
          <dd className="font-display text-2xl font-bold tabular-nums">{task.tapCount > 0 ? pct(task.misclickRate) : '—'}</dd>
          <dd className="text-xs text-muted-foreground">
            {task.tapCount > 0 ? `de ${plural(task.tapCount, 'toque', 'toques')} · ${task.avgMisclicks.toFixed(1).replace('.', ',')} por persona` : 'Sin toques'}
          </dd>
        </div>
      </dl>
      <OutcomeBar task={task} />
      </TaskSection>
      {!firstClick && <Funnel task={task} />}
      <VariantTable task={task} />

      {printing ? (
        <div className="space-y-6">
          {/* Versión compacta para el PDF: lo esencial de cada bloque. La lista de participantes está en el CSV. */}
          <div className="space-y-3">
            <h4 className="font-medium" data-print="heading">
              {firstClick ? 'Dónde tocaron' : 'Pantallas con más toques'}
            </h4>
            <ScreensPanel task={task} focusScreen={undefined} limit={2} />
          </div>
          {!firstClick && task.paths.length > 0 && (
            <div className="space-y-3">
              <h4 className="font-medium" data-print="heading">
                Caminos más comunes
              </h4>
              <PathsPanel task={task} limit={3} />
            </div>
          )}
        </div>
      ) : (
        <>
          <TaskSection title={firstClick ? 'Dónde tocaron' : 'Pantallas y mapas de calor'} description={`${plural(task.screens.length, 'pantalla', 'pantallas')} con toques en esta tarea.`}>
            <ScreensPanel task={task} focusScreen={focusScreen} />
          </TaskSection>
          {!firstClick && (
            <TaskSection title="Caminos" description="Por dónde pasó cada persona, del más común al menos común.">
              <PathsPanel task={task} />
            </TaskSection>
          )}
          <TaskSection title="Participantes" description="Cómo le fue a cada persona en esta tarea, con su grabación.">
            <ParticipantsPanel task={task} />
          </TaskSection>
        </>
      )}
    </div>
  );
}
