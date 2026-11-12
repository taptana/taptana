import { useState, type ReactNode } from 'react';
import { ArrowRight, CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react';
import { REPORT_DEFINITIONS, type Insight, type StudyReport } from '@taptana/shared';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DotBoard, DotRow } from '@/components/brand/dot-board';
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

/** El color del tramo para los puntos del tablero (se pintan con `currentColor`). */
export const TONE_DOT: Record<ScoreTone, string> = {
  good: 'text-emerald-500',
  ok: 'text-lime-500',
  warn: 'text-amber-500',
  bad: 'text-red-500',
  none: 'text-muted-foreground/40',
};

/**
 * Una cifra con su unidad: el número en la tipografía de títulos y la unidad («%», «s») en mono,
 * más chica. `value` llega ya formateado («74 %», «53 s», «8», «—»).
 */
export function Figure({ value, className, unitClassName }: { value: string; className?: string; unitClassName?: string }) {
  const m = /^(.*\d)\s*([^\d\s]+)$/.exec(value);
  return (
    <span className={cn('font-display font-bold tabular-nums tracking-[-0.03em] leading-none', className)}>
      {m ? m[1] : value}
      {m && <span className={cn('num ml-[0.16em] text-[0.46em] font-medium tracking-normal text-muted-foreground', unitClassName)}>{m[2]}</span>}
    </span>
  );
}

/** Puntaje pequeño para encabezados de tarea e índice: el número y su fila de diez puntos. */
export function ScoreChip({ score, className }: { score: number | null; className?: string }) {
  const band = scoreBand(score);
  return (
    <span className={cn('inline-flex items-center gap-2 num font-medium text-foreground', className)} title={`Puntaje de usabilidad: ${band.label}`}>
      <DotRow value={score} className={TONE_DOT[band.tone]} />
      {score === null ? '—' : score}
    </span>
  );
}

/** Una celda del libro de cifras: etiqueta en mono, el número grande y una línea de explicación. Va dentro de una fila con reglas. */
export function Kpi({ label, value, sub, size = 'lg' }: { label: string; value: string; sub: ReactNode; size?: 'lg' | 'md' }) {
  return (
    <div
      className="min-w-0 space-y-3 border-b py-5 sm:border-b-0 sm:border-l sm:px-6 sm:py-1 sm:first:border-l-0 sm:first:pl-0 max-lg:sm:[&:nth-child(odd)]:border-l-0 max-lg:sm:[&:nth-child(odd)]:pl-0 max-lg:sm:[&:nth-child(-n+2)]:pb-6"
      data-print="keep"
    >
      <dt className="type-eyebrow truncate">{label}</dt>
      <dd>
        <Figure value={value} className={size === 'lg' ? 'text-[2.5rem] sm:text-[2.75rem]' : 'text-[2rem]'} />
      </dd>
      <dd className="text-sm text-muted-foreground leading-snug max-w-[34ch]">{sub}</dd>
    </div>
  );
}

/** El puntaje en su tablero de 100 puntos y, debajo, los cuatro números del estudio en una sola fila con reglas. */
export function Overview({ report }: { report: StudyReport }) {
  const [how, setHow] = useState(false);
  // `bounced` llega con la versión nueva del reporte; un servidor anterior no lo manda.
  const bounced = (report as StudyReport & { bounced?: number }).bounced ?? 0;
  const band = scoreBand(report.score);
  const withData = report.tasks.filter((t) => t.decided > 0).length;
  return (
    <section aria-label="Resumen del estudio">
      <div className="flex flex-wrap items-center gap-x-10 gap-y-6 pb-8 sm:pb-10" data-print="keep">
        <div role="img" aria-label={report.score === null ? 'Sin puntaje' : `${report.score} de 100`} className="shrink-0">
          <DotBoard value={report.score} className={cn('size-36 sm:size-44', TONE_DOT[band.tone])} />
        </div>
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {/* Sin mayúsculas por CSS: las pruebas leen este rótulo tal cual. */}
            <span className="type-eyebrow normal-case tracking-normal text-[13px]">Puntaje de usabilidad</span>
            <button type="button" className="link-ink cursor-pointer rounded-sm text-sm text-muted-foreground outline-none focus-ink" onClick={() => setHow(true)} data-print="hide">
              Cómo se calcula
            </button>
          </div>
          <p className="flex items-baseline gap-3">
            <span className="font-display text-[5rem] sm:text-[6.5rem] font-extrabold tabular-nums tracking-[-0.045em] leading-[0.8]" data-testid="study-score">
              {report.score === null ? '—' : report.score}
            </span>
            <span className="num text-sm text-muted-foreground">de 100</span>
          </p>
          <p className="flex items-center gap-2.5 text-lg font-semibold">
            <span className={cn('size-2.5 rounded-full', TONE_BG[band.tone])} aria-hidden />
            {band.label}
          </p>
          <p className="text-sm text-muted-foreground max-w-[52ch]">
            {report.score === null
              ? 'Aparece cuando al menos una tarea tenga resultados decididos.'
              : `Promedio de ${plural(withData, 'tarea', 'tareas')} con resultados. 80 o más: muy bien. Menos de 40: problemas serios.`}
          </p>
        </div>
      </div>

      <dl className="grid border-t border-foreground sm:grid-cols-2 sm:border-b sm:py-6 lg:grid-cols-4">
        <Kpi
          label="Participantes"
          value={String(report.participants)}
          sub={
            <>
              <span className="block">
                {report.participants > 0 ? (report.completed === report.participants ? 'Todos llegaron al final' : `${report.completed} de ${report.participants} llegaron al final`) : 'Todavía nadie'}
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
        <Kpi label="Tareas logradas" value={withData ? pct(report.successRate) : '—'} sub={withData ? 'De todos los intentos ya decididos' : 'Sin resultados decididos'} />
        <Kpi label="Duración mediana" value={seconds(report.medianDurationMs)} sub="Del estudio completo, por participante" />
        <Kpi label="Misclicks" value={pct(report.avgMisclickRate)} sub="De los toques de las tareas cayeron donde no pasa nada" />
      </dl>

      <HowDialog open={how} onOpenChange={setHow} />
    </section>
  );
}

function HowDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Cómo se calcula</DialogTitle>
          <DialogDescription>Las definiciones de cada número de este reporte.</DialogDescription>
        </DialogHeader>
        <dl className="space-y-4 text-sm">
          {REPORT_DEFINITIONS.map((d) => (
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

/** La cifra que decide una frase («6 de 8 personas», «75 %»), para pasarle el resaltador. Solo la primera. */
const KEY_NUMBER = /\d+ de \d+(?: personas?)?|\d+(?:[.,]\d+)? ?%|\d+ (?:resultados?|toques|personas?|veces|sesiones)/;

function Marked({ text }: { text: string }) {
  const m = KEY_NUMBER.exec(text);
  if (!m) return <>{text}</>;
  return (
    <>
      {text.slice(0, m.index)}
      <span className="mark font-medium">{m[0]}</span>
      {text.slice(m.index + m[0].length)}
    </>
  );
}

/** "Lo más importante": las frases del resumen como lista numerada con reglas; cada una lleva a su bloque o pantalla. */
export function InsightsCard({ insights, onJump }: { insights: Insight[]; onJump: (blockId: string, screen?: string) => void }) {
  if (insights.length === 0) return null;
  return (
    <section className="border-t border-foreground pt-5" data-print="keep">
      <div className="space-y-1.5 pb-5">
        <h2 className="type-section">Lo más importante</h2>
        <p className="text-muted-foreground max-w-[65ch]">Qué arreglar primero y qué salió bien, según los datos.</p>
      </div>
      <ol className="border-t">
        {insights.map((insight, i) => {
          const style = INSIGHT_STYLE[insight.level];
          const body = (
            <>
              <span className="num w-7 shrink-0 pt-[3px] text-sm text-muted-foreground" aria-hidden>
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className={cn('mt-[3px] shrink-0 [&_svg]:size-5', style.className)} title={style.label}>
                {style.icon}
                <span className="sr-only">{style.label}: </span>
              </span>
              <span className="flex-1 min-w-0 text-base leading-relaxed max-w-[70ch]">
                <Marked text={insight.text} />
              </span>
            </>
          );
          return (
            <li key={i} className="border-b">
              {insight.blockId ? (
                <button
                  type="button"
                  onClick={() => onJump(insight.blockId as string, insight.screen)}
                  className="group flex w-full items-start gap-3 py-4 sm:py-5 text-left cursor-pointer rounded-sm outline-none focus-ink"
                >
                  {body}
                  <span className="ml-auto mt-0.5 shrink-0 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground group-hover:text-foreground group-hover:underline underline-offset-4" data-print="hide">
                    Ver <ArrowRight className="size-3.5" />
                  </span>
                </button>
              ) : (
                <div className="flex items-start gap-3 py-4 sm:py-5">{body}</div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Comparación A/B del estudio completo. */
export function VariantsCard({ report }: { report: StudyReport }) {
  if (report.variants.length === 0) return null;
  const best = Math.max(...report.variants.map((v) => v.score ?? -1));
  return (
    <section className="border-t border-foreground pt-5" data-print="keep">
      <div className="space-y-1.5 pb-5">
        <h2 className="type-section">Comparación A/B</h2>
        <p className="text-muted-foreground max-w-[65ch]">Cada participante vio una sola variante, elegida al azar. Con pocos participantes, las diferencias chicas no dicen mucho.</p>
      </div>
      <div className="grid border-t sm:grid-cols-2 xl:grid-cols-3">
        {report.variants.map((v) => (
          <div key={v.id} className="space-y-3 border-b py-5 sm:px-6 sm:border-l sm:first:border-l-0 sm:first:pl-0">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold truncate">{v.name}</span>
              {v.score !== null && v.score === best && report.variants.length > 1 && <span className="mark shrink-0 text-sm font-medium">Mejor puntaje</span>}
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
    </section>
  );
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="num font-medium">{value}</dd>
    </div>
  );
}
