import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, BarChart3, Clock, MousePointerClick, Pencil, Users, CheckCircle2, Route as RouteIcon, Flame, Smartphone } from 'lucide-react';
import type { Prototype, StudyRecord, StudyReport, TaskReport, TaskOutcomeCounts } from '@taptana/shared';
import { getClient } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, Layout, PageHeader, RouteTabs } from '@/components/layout';
import { Heatmap } from '@/components/heatmap';
import { cn } from '@/lib/utils';
import { pct, screenName, seconds } from '@/lib/format';
import { Link, useRouter } from '@/router';

const OUTCOMES: Array<{ key: keyof TaskOutcomeCounts; label: string; color: string; help: string }> = [
  { key: 'direct', label: 'Éxito directo', color: 'bg-emerald-500', help: 'Lo logró siguiendo el camino esperado' },
  { key: 'indirect', label: 'Éxito indirecto', color: 'bg-emerald-300', help: 'Lo logró, pero dando vueltas' },
  { key: 'reported', label: 'Dijo que terminó', color: 'bg-amber-400', help: 'Tocó "Listo" sin cumplir la tarea' },
  { key: 'failed', label: 'No pudo', color: 'bg-red-500', help: 'Tocó "No pude"' },
  { key: 'incomplete', label: 'Sin terminar', color: 'bg-zinc-300', help: 'Abandonó a mitad' },
];

export function previewUrl(proto: Prototype | undefined, path: string): string | null {
  if (!proto?.url) return null;
  const base = proto.url.endsWith('/') ? proto.url : `${proto.url}/`;
  return `${base}${path.replace(/^\//, '')}?taptana-preview`;
}

export function StudyTabs({ id, active }: { id: string; active: 'design' | 'report' }) {
  return (
    <RouteTabs
      tabs={[
        { label: 'Diseño', to: { name: 'study', id }, active: active === 'design', icon: <Pencil className="size-3.5" /> },
        { label: 'Resultados', to: { name: 'report', id }, active: active === 'report', icon: <BarChart3 className="size-3.5" /> },
      ]}
    />
  );
}

export function ReportPage({ id }: { id: string }) {
  const [study, setStudy] = useState<StudyRecord | null | undefined>(undefined);
  const [report, setReport] = useState<StudyReport | null>(null);
  const [proto, setProto] = useState<Prototype | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const client = await getClient();
        const s = await client.getStudy(id);
        setStudy(s);
        if (!s) return;
        const [r, protos] = await Promise.all([client.getStudyReport(id), client.listPrototypes()]);
        setReport(r);
        setProto(protos.find((p) => p.id === s.prototypeId));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [id]);

  if (error) return <Layout><p className="text-destructive">{error}</p></Layout>;
  if (study === undefined || (study && !report)) return <Layout><p className="text-muted-foreground">Cargando resultados…</p></Layout>;
  if (study === null || !report) return <Layout><p>No existe este estudio.</p></Layout>;

  return (
    <Layout wide>
      <PageHeader
        back={
          <Button variant="ghost" size="icon" asChild className="mt-1">
            <Link to={{ name: 'studies' }}>
              <ArrowLeft />
            </Link>
          </Button>
        }
        title={study.name}
        description={study.description ?? `${study.tasks.length} tareas · prototipo ${proto?.name ?? study.prototypeId}`}
        actions={<StudyTabs id={id} active="report" />}
      />

      {report.participants === 0 ? (
        <EmptyState icon={<Users className="size-5" />} title="Todavía nadie hizo este estudio">
          Comparte el link del estudio (en Diseño) y los resultados aparecen aquí solos, por tarea y por pantalla.
        </EmptyState>
      ) : (
        <>
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
            <Kpi icon={<Users />} label="Participantes" value={String(report.participants)} sub={`${report.completed} terminaron todo`} />
            <Kpi icon={<CheckCircle2 />} label="Éxito promedio" value={pct(report.successRate)} sub="de todas las tareas" tone={report.successRate >= 0.7 ? 'good' : report.successRate >= 0.4 ? 'mid' : 'bad'} />
            <Kpi icon={<Clock />} label="Duración mediana" value={seconds(report.medianDurationMs)} sub="por participante" />
            <Kpi icon={<MousePointerClick />} label="Misclicks" value={pct(report.avgMisclickRate)} sub="de los toques no tocaron nada" tone={report.avgMisclickRate <= 0.15 ? 'good' : report.avgMisclickRate <= 0.3 ? 'mid' : 'bad'} />
          </div>

          {report.variants.length > 0 && <VariantsCard report={report} />}

          <div className="space-y-10">
            {report.tasks.map((t, i) => (
              <TaskSection key={t.taskId} index={i} task={t} proto={proto} />
            ))}
          </div>
        </>
      )}
    </Layout>
  );
}

function Kpi({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: string; sub: string; tone?: 'good' | 'mid' | 'bad' }) {
  return (
    <Card className="py-5 gap-2">
      <CardContent className="px-5 space-y-2">
        <div className="flex items-center gap-2 text-muted-foreground text-sm [&_svg]:size-4">
          {icon}
          {label}
        </div>
        <div className={cn('text-3xl font-semibold tabular-nums', tone === 'good' && 'text-emerald-600', tone === 'mid' && 'text-amber-600', tone === 'bad' && 'text-red-600')}>{value}</div>
        <div className="text-xs text-muted-foreground">{sub}</div>
      </CardContent>
    </Card>
  );
}

function VariantsCard({ report }: { report: StudyReport }) {
  const best = [...report.variants].sort((a, b) => b.successRate - a.successRate)[0];
  return (
    <Card className="py-6 gap-4">
      <CardHeader className="px-6">
        <CardTitle>Comparación A/B</CardTitle>
        <CardDescription>Mismas tareas, distinta variante. Con pocos participantes, tómalo como señal y no como certeza.</CardDescription>
      </CardHeader>
      <CardContent className="px-6 grid gap-4 sm:grid-cols-2">
        {report.variants.map((v) => (
          <div key={v.id} className={cn('rounded-xl border p-5 space-y-3', v.id === best?.id && v.participants > 0 && 'border-emerald-500/60 bg-emerald-500/5')}>
            <div className="flex items-center justify-between">
              <span className="font-semibold">
                {v.id} · {v.name}
              </span>
              <Badge variant="secondary">{v.participants} participantes</Badge>
            </div>
            <Bar value={v.successRate} label="Éxito" />
            <Bar value={v.directRate} label="Éxito directo" />
            <div className="text-sm text-muted-foreground">Tiempo mediano por tarea: {seconds(v.medianTimeMs)}</div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function Bar({ value, label }: { value: number; label: string }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="tabular-nums font-medium">{pct(value)}</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className="h-full bg-emerald-500 rounded-full" style={{ width: pct(value) }} />
      </div>
    </div>
  );
}

function TaskSection({ index, task, proto }: { index: number; task: TaskReport; proto: Prototype | undefined }) {
  const [tab, setTab] = useState<'screens' | 'paths' | 'people'>('screens');
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="size-8 rounded-lg bg-primary text-primary-foreground grid place-items-center text-sm font-semibold">{index + 1}</span>
        <h2 className="text-xl font-semibold tracking-tight">{task.title}</h2>
        {task.kind === 'first-click' && <Badge variant="secondary">First click</Badge>}
        <span className="text-muted-foreground text-sm">{task.participants} participantes</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card className="py-6 gap-5">
          <CardContent className="px-6 space-y-5">
            <div className="flex items-end gap-6 flex-wrap">
              <div>
                <div className="text-sm text-muted-foreground">Tasa de éxito</div>
                <div className="text-4xl font-semibold tabular-nums">{pct(task.successRate)}</div>
              </div>
              <Metric label="Directo" value={pct(task.directRate)} />
              <Metric label="Tiempo mediano" value={seconds(task.medianTimeMs)} />
              <Metric label="Misclicks por persona" value={task.avgMisclicks.toFixed(1)} />
            </div>
            <div className="flex h-4 rounded-full overflow-hidden bg-muted">
              {OUTCOMES.map((o) =>
                task.outcomes[o.key] ? (
                  <div key={o.key} className={o.color} style={{ width: `${(task.outcomes[o.key] / Math.max(task.participants, 1)) * 100}%` }} title={`${o.label}: ${task.outcomes[o.key]}`} />
                ) : null,
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
              {OUTCOMES.map((o) => (
                <div key={o.key} className="flex items-start gap-2 text-sm" title={o.help}>
                  <span className={cn('size-3 rounded-sm mt-1 shrink-0', o.color)} />
                  <span>
                    {o.label} <span className="text-muted-foreground tabular-nums">· {task.outcomes[o.key]}</span>
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="py-6 gap-4">
          <CardHeader className="px-6">
            <CardTitle className="text-base flex items-center gap-2">
              <RouteIcon className="size-4" /> Embudo del camino esperado
            </CardTitle>
            <CardDescription>
              {task.expectedPath.length === 0
                ? 'Nadie lo logró todavía, así que no hay camino esperado. Puedes definirlo en Diseño.'
                : task.expectedPathInferred
                  ? 'Deducido del camino más corto de quienes lo lograron. Puedes fijarlo en Diseño.'
                  : 'Definido en el diseño del estudio.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="px-6 space-y-2.5">
            {task.funnel.map((step, i) => {
              const ratio = task.participants ? step.reached / task.participants : 0;
              const prev = i === 0 ? task.participants : task.funnel[i - 1]!.reached;
              const drop = prev - step.reached;
              return (
                <div key={step.path + i} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">
                      {i + 1}. {screenName(step.path)}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {step.reached} · {pct(ratio)}
                      {drop > 0 && i > 0 && <span className="text-red-600 ml-2">−{drop}</span>}
                    </span>
                  </div>
                  <div className="h-7 rounded-md bg-muted overflow-hidden">
                    <div className="h-full rounded-md bg-primary/80 transition-all" style={{ width: pct(ratio) }} />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <Card className="py-6 gap-5">
        <CardHeader className="px-6 flex flex-row flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-lg bg-muted p-1 gap-1">
            {(
              [
                ['screens', 'Pantallas y mapas de calor', <Flame key="f" className="size-3.5" />],
                ['paths', 'Caminos', <RouteIcon key="r" className="size-3.5" />],
                ['people', 'Participantes', <Users key="u" className="size-3.5" />],
              ] as const
            ).map(([key, label, icon]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={cn('inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium', tab === key ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground')}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="px-6">
          {tab === 'screens' && <Screens task={task} proto={proto} />}
          {tab === 'paths' && <Paths task={task} />}
          {tab === 'people' && <People task={task} />}
        </CardContent>
      </Card>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Screens({ task, proto }: { task: TaskReport; proto: Prototype | undefined }) {
  const [mode, setMode] = useState<'heat' | 'dots' | 'misclicks'>('heat');
  if (task.screens.length === 0) return <p className="text-muted-foreground text-sm">Sin pantallas registradas.</p>;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-muted-foreground">Ver:</span>
        {(
          [
            ['heat', 'Mapa de calor'],
            ['dots', 'Cada toque'],
            ['misclicks', 'Solo misclicks'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setMode(k)} className={cn('rounded-full border px-3 py-1', mode === k ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-accent')}>
            {label}
          </button>
        ))}
        {mode !== 'heat' && (
          <span className="flex items-center gap-3 text-xs text-muted-foreground ml-auto">
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-blue-600" /> tocó algo</span>
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-red-600" /> misclick</span>
          </span>
        )}
      </div>
      <div className="flex gap-6 overflow-x-auto pb-3 -mx-1 px-1">
        {task.screens.map((s, i) => {
          const onPath = task.expectedPath.includes(s.path);
          return (
            <div key={s.path} className="shrink-0 space-y-3" style={{ width: 260 }}>
              <div className="flex items-center gap-2">
                {onPath && <span className="size-5 rounded-full bg-primary text-primary-foreground grid place-items-center text-[11px] font-semibold">{task.expectedPath.indexOf(s.path) + 1}</span>}
                <span className="font-medium truncate">{screenName(s.path)}</span>
                {!onPath && <Badge variant="outline" className="text-xs">fuera del camino</Badge>}
              </div>
              <Heatmap key={`${s.path}-${i}`} src={previewUrl(proto, s.path)} points={s.taps} viewportWidth={s.viewportWidth} mode={mode} />
              <dl className="grid grid-cols-3 gap-2 text-center">
                <Stat label="visitas" value={String(s.visitors)} />
                <Stat label="tiempo prom." value={seconds(s.avgTimeMs)} />
                <Stat label="misclicks" value={String(s.misclicks)} warn={s.misclicks > 0} />
              </dl>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-lg bg-muted/60 py-2">
      <dd className={cn('font-semibold tabular-nums', warn && 'text-red-600')}>{value}</dd>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
    </div>
  );
}

function Paths({ task }: { task: TaskReport }) {
  const expected = task.expectedPath.join('>');
  return (
    <div className="space-y-3">
      {task.paths.map((p) => (
        <div key={p.pages.join('>')} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
          <span className="tabular-nums font-semibold w-14">{pct(p.count / Math.max(task.participants, 1))}</span>
          <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-0">
            {p.pages.map((page, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <ArrowRight className="size-3.5 text-muted-foreground" />}
                <Badge variant="secondary" className="font-normal">{screenName(page)}</Badge>
              </span>
            ))}
          </div>
          <span className="text-sm text-muted-foreground">
            {p.count} {p.count === 1 ? 'persona' : 'personas'} · {p.successes} lo lograron
          </span>
          {p.pages.join('>') === expected && <Badge className="bg-emerald-600">camino esperado</Badge>}
        </div>
      ))}
    </div>
  );
}

function People({ task }: { task: TaskReport }) {
  const { navigate } = useRouter();
  const label = useMemo(() => Object.fromEntries(OUTCOMES.map((o) => [o.key, o])), []);
  return (
    <div className="divide-y rounded-lg border">
      {task.results.map((r) => (
        <button key={r.sessionId} type="button" onClick={() => navigate({ name: 'player', id: r.sessionId })} className="w-full flex flex-wrap items-center gap-3 p-3 text-left hover:bg-accent/50">
          <Smartphone className="size-4 text-muted-foreground" />
          <span className="font-mono text-xs text-muted-foreground w-28 truncate">{r.sessionId}</span>
          <span className="flex items-center gap-1.5 text-sm">
            <span className={cn('size-2.5 rounded-full', label[r.outcome]?.color)} />
            {label[r.outcome]?.label}
          </span>
          {r.variantId && <Badge variant="outline">{r.variantId}</Badge>}
          <span className="text-sm text-muted-foreground ml-auto">
            {seconds(r.durationMs)} · {r.misclicks} misclicks · {r.pages.length} pantallas
          </span>
          <span className="text-sm text-primary">Ver grabación →</span>
        </button>
      ))}
    </div>
  );
}
