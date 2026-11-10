import { useState, type ReactNode } from 'react';
import { ArrowRight, CircleAlert, CircleCheck, CircleHelp, Clock, MousePointerClick, Target, TriangleAlert, Users } from 'lucide-react';
import type { Insight, StudyReport } from '@taptana/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { pct, plural, seconds } from '@/lib/format';
import { scoreBand, type ScoreTone } from './logic.ts';

export const TONE_TEXT: Record<ScoreTone, string> = {
  good: 'text-emerald-600 dark:text-emerald-400',
  ok: 'text-lime-600 dark:text-lime-400',
  warn: 'text-amber-600 dark:text-amber-400',
  bad: 'text-red-600 dark:text-red-400',
  none: 'text-muted-foreground',
};

export const TONE_BG: Record<ScoreTone, string> = {
  good: 'bg-emerald-500',
  ok: 'bg-lime-500',
  warn: 'bg-amber-500',
  bad: 'bg-red-500',
  none: 'bg-muted-foreground/30',
};

/** Puntaje pequeño con su color, para encabezados de tarea e índice. */
export function ScoreChip({ score, className }: { score: number | null; className?: string }) {
  const band = scoreBand(score);
  return (
    <span className={cn('inline-flex items-center gap-1.5 tabular-nums font-semibold', TONE_TEXT[band.tone], className)} title={`Puntaje de usabilidad: ${band.label}`}>
      <span className={cn('size-2 rounded-full', TONE_BG[band.tone])} aria-hidden="true" />
      {score === null ? '—' : score}
    </span>
  );
}

function Kpi({ icon, label, value, sub }: { icon: ReactNode; label: string; value: string; sub: ReactNode }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card p-5 sm:p-6 space-y-2 min-w-0" data-print="keep">
      <div className="flex items-center gap-2 text-muted-foreground text-sm [&_svg]:size-4 [&_svg]:shrink-0">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="text-2xl sm:text-3xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground leading-relaxed">{sub}</div>
    </div>
  );
}

/** Puntaje grande + los cuatro números del estudio. */
export function Overview({ report }: { report: StudyReport }) {
  const [how, setHow] = useState(false);
  // `bounced` llega con la versión nueva del reporte; un servidor anterior no lo manda.
  const bounced = (report as StudyReport & { bounced?: number }).bounced ?? 0;
  const band = scoreBand(report.score);
  const withData = report.tasks.filter((t) => t.decided > 0).length;
  return (
    <section aria-label="Resumen del estudio" className="grid gap-4 sm:gap-5 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
      <Card data-print="keep">
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">Puntaje de usabilidad</span>
            <Button variant="ghost" size="sm" className="-mr-2 text-muted-foreground" onClick={() => setHow(true)} data-print="hide">
              <CircleHelp />
              Cómo se calcula
            </Button>
          </div>
          <div className="flex items-baseline gap-2">
            <span className={cn('text-6xl font-semibold tabular-nums tracking-tight', TONE_TEXT[band.tone])} data-testid="study-score">
              {report.score === null ? '—' : report.score}
            </span>
            <span className="text-muted-foreground">de 100</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden" role="img" aria-label={report.score === null ? 'Sin puntaje' : `${report.score} de 100`}>
            <div className={cn('h-full rounded-full', TONE_BG[band.tone])} style={{ width: `${report.score ?? 0}%` }} />
          </div>
          <p className={cn('text-sm font-medium', TONE_TEXT[band.tone])}>{band.label}</p>
          <p className="text-xs text-muted-foreground">
            {report.score === null
              ? 'Aparece cuando al menos una tarea tenga resultados decididos.'
              : `Promedio de ${plural(withData, 'tarea', 'tareas')} con resultados. 80 o más: muy bien. Menos de 40: problemas serios.`}
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:gap-5 grid-cols-2">
        <Kpi
          icon={<Users />}
          label="Participantes"
          value={String(report.participants)}
          sub={
            <>
              <span className="block">
                {plural(report.participants, 'participante', 'participantes')}
                {report.participants > 0 && (report.completed === report.participants ? ' · todos llegaron al final' : ` · ${report.completed} de ${report.participants} llegaron al final`)}
              </span>
              {bounced > 0 && (
                <span className="block" data-testid="bounced">
                  {bounced === 1 ? '1 entró y salió sin empezar' : `${bounced} entraron y salieron sin empezar`}
                </span>
              )}
              {report.excluded > 0 && <span className="block">{plural(report.excluded, 'sesión excluida', 'sesiones excluidas')}</span>}
            </>
          }
        />
        <Kpi
          icon={<Target />}
          label="Tareas logradas"
          value={withData ? pct(report.successRate) : '—'}
          sub={withData ? 'De todos los intentos ya decididos' : 'Sin resultados decididos'}
        />
        <Kpi icon={<Clock />} label="Duración mediana" value={seconds(report.medianDurationMs)} sub="Del estudio completo, por participante" />
        <Kpi icon={<MousePointerClick />} label="Misclicks" value={pct(report.avgMisclickRate)} sub="De los toques de las tareas cayeron donde no pasa nada" />
      </div>

      <HowDialog open={how} onOpenChange={setHow} />
    </section>
  );
}

const DEFINITIONS: Array<{ term: string; text: string }> = [
  {
    term: 'Participantes',
    text: 'Las personas que abrieron el link del estudio, aceptaron que se grabe y empezaron al menos un bloque. Quienes aceptaron y salieron sin empezar se cuentan aparte ("entraron y salieron sin empezar"). Las sesiones que marcaste como "Excluir del reporte" no cuentan. En cada tarea solo cuentan quienes la empezaron.',
  },
  {
    term: 'Éxito directo e indirecto',
    text: 'Hay éxito cuando se cumple la regla de la tarea o cuando tú lo marcas. Es directo si la persona siguió exactamente el camino esperado, e indirecto si llegó dando vueltas. Si la tarea no tiene camino esperado, se usa el camino más común de quienes lo lograron.',
  },
  {
    term: 'Dijo que terminó, No pudo, Sin terminar',
    text: '"Dijo que terminó": tocó "Listo" pero la regla no se cumplió. "No pudo": tocó "No pude". "Sin terminar": dejó el estudio a mitad de la tarea.',
  },
  {
    term: 'Por revisar',
    text: 'En las tareas que decide el moderador, tocar "Listo" deja el resultado por revisar. No cuenta en el éxito ni en el puntaje hasta que lo marques como logrado o no logrado.',
  },
  {
    term: 'Tiempo',
    text: 'Desde que toca "Empezar tarea" hasta que se cumple la regla (o hasta "Listo" o "No pude" si no se cumplió). Leer la instrucción no cuenta. El tiempo mediano es solo de quienes lo lograron.',
  },
  {
    term: 'Primer clic',
    text: 'La tarea termina en el primer toque. Acierta si toca el elemento correcto, o si ese toque lleva a la pantalla correcta en los 2 segundos siguientes.',
  },
  {
    term: 'Misclick (toque sin efecto)',
    text: 'Un toque sobre algo que no es tocable y que no produjo ningún cambio. Muchos misclicks en un mismo lugar indican que algo parece un botón y no lo es. La tasa de misclicks de una tarea son sus toques sin efecto divididos entre todos los toques hechos durante esa tarea (no entre personas). Las grabaciones antiguas sin este dato no cuentan.',
  },
  {
    term: 'Puntaje de una tarea (0 a 100)',
    text: '100 × éxito directo + 50 × éxito indirecto − 50 × tasa de misclicks − penalización por lentitud (hasta 10 puntos cuando se tarda más de 5 segundos por pantalla). Las tasas se calculan sobre los intentos ya decididos. En primer clic: el porcentaje de aciertos.',
  },
  {
    term: 'Puntaje del estudio',
    text: 'El promedio del puntaje de las tareas que ya tienen resultados decididos. "Tareas logradas" junta los intentos de todas las tareas: intentos logrados (directo + indirecto) divididos entre todos los intentos ya decididos. Los que están por revisar o sin terminar no entran.',
  },
  {
    term: 'Mapas de calor',
    text: 'El fondo es lo que vio una persona real con el tamaño de pantalla más común. Solo se dibujan los toques de pantallas de ancho parecido (±20 %); debajo de cada mapa dice cuántos quedaron fuera.',
  },
];

function HowDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Cómo se calcula</DialogTitle>
          <DialogDescription>Las definiciones de cada número de este reporte.</DialogDescription>
        </DialogHeader>
        <dl className="space-y-4 text-sm">
          {DEFINITIONS.map((d) => (
            <div key={d.term} className="space-y-1">
              <dt className="font-medium">{d.term}</dt>
              <dd className="text-muted-foreground">{d.text}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}

const INSIGHT_STYLE: Record<Insight['level'], { icon: ReactNode; className: string; label: string }> = {
  bad: { icon: <CircleAlert />, className: 'text-red-600 dark:text-red-400', label: 'Problema' },
  warn: { icon: <TriangleAlert />, className: 'text-amber-600 dark:text-amber-400', label: 'Atención' },
  good: { icon: <CircleCheck />, className: 'text-emerald-600 dark:text-emerald-400', label: 'Salió bien' },
};

/** "Lo más importante": las frases del resumen, cada una lleva a su bloque o pantalla. */
export function InsightsCard({ insights, onJump }: { insights: Insight[]; onJump: (blockId: string, screen?: string) => void }) {
  if (insights.length === 0) return null;
  return (
    <Card data-print="keep">
      <CardHeader>
        <CardTitle>Lo más importante</CardTitle>
        <CardDescription>Qué arreglar primero y qué salió bien, según los datos.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y -my-2">
          {insights.map((insight, i) => {
            const style = INSIGHT_STYLE[insight.level];
            const body = (
              <>
                <span className={cn('mt-0.5 shrink-0 [&_svg]:size-4.5', style.className)} title={style.label}>
                  {style.icon}
                  <span className="sr-only">{style.label}: </span>
                </span>
                <span className="flex-1 min-w-0 text-sm sm:text-base">{insight.text}</span>
              </>
            );
            return (
              <li key={i}>
                {insight.blockId ? (
                  <button
                    type="button"
                    onClick={() => onJump(insight.blockId as string, insight.screen)}
                    className="group flex w-full items-start gap-3 py-3 text-left cursor-pointer rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    {body}
                    <span className="mt-0.5 shrink-0 inline-flex items-center gap-1 text-xs text-muted-foreground group-hover:text-foreground" data-print="hide">
                      Ver <ArrowRight className="size-3.5" />
                    </span>
                  </button>
                ) : (
                  <div className="flex items-start gap-3 py-3">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

/** Comparación A/B del estudio completo. */
export function VariantsCard({ report }: { report: StudyReport }) {
  if (report.variants.length === 0) return null;
  const best = Math.max(...report.variants.map((v) => v.score ?? -1));
  return (
    <Card data-print="keep">
      <CardHeader>
        <CardTitle>Comparación A/B</CardTitle>
        <CardDescription>Cada participante vio una sola variante, elegida al azar. Con pocos participantes, las diferencias chicas no dicen mucho.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {report.variants.map((v) => (
            <div key={v.id} className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium truncate">{v.name}</span>
                {v.score !== null && v.score === best && report.variants.length > 1 && <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium shrink-0">Mejor puntaje</span>}
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <Stat label="Puntaje" value={<ScoreChip score={v.score} />} />
                <Stat label="Participantes" value={v.participants} />
                <Stat label="Tareas logradas" value={v.participants ? pct(v.successRate) : '—'} />
                <Stat label="Éxito directo" value={v.participants ? pct(v.directRate) : '—'} />
                <Stat label="Tiempo por tarea" value={seconds(v.medianTimeMs)} />
              </dl>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}
