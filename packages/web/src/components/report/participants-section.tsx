import { useId, useMemo, useState } from 'react';
import { ChevronDown, PlayCircle, Users } from 'lucide-react';
import { NOT_STARTED_LABEL, type ParticipantAnswer, type ParticipantReport, type ParticipantTask, type StudyReport } from '@taptana/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label, NativeSelect } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/layout';
import { plural, seconds } from '@/lib/format';
import { cn, formatShortDate } from '@/lib/utils';
import { Link } from '@/router';
import { recordingRoute, useReport } from './context.tsx';
import { arrangePeople, OUTCOME_ORDER, type PeopleSort } from './logic.ts';
import { OUTCOME_BADGE, OUTCOME_COLOR, OUTCOME_HELP, outcomeLabel } from './task-section.tsx';

const SORTS: Array<{ id: PeopleSort; label: string }> = [
  { id: 'arrival', label: 'Orden de llegada' },
  { id: 'achieved', label: 'Más tareas logradas' },
  { id: 'duration', label: 'Más tiempo' },
];

type Outcome = ParticipantTask['outcome'];

function taskOutcomeLabel(task: ParticipantTask): string {
  return task.outcome === 'not-started' ? NOT_STARTED_LABEL : outcomeLabel(task.outcome, task.kind === 'first-click');
}

/** Un cuadrito por tarea, del color de su resultado (el mismo de la barra de resultados). */
function OutcomeChip({ task, number }: { task: ParticipantTask; number: number }) {
  const label = `${number}. ${task.title}: ${taskOutcomeLabel(task)}`;
  return (
    <span
      title={label}
      className={cn(
        'grid size-7 shrink-0 place-items-center rounded-md text-[11px] font-semibold tabular-nums',
        task.outcome === 'not-started' ? 'border border-dashed border-border text-muted-foreground' : OUTCOME_COLOR[task.outcome],
        (task.outcome === 'direct' || task.outcome === 'failed') && 'text-white',
        (task.outcome === 'indirect' || task.outcome === 'review' || task.outcome === 'reported' || task.outcome === 'incomplete') && 'text-zinc-900/80',
      )}
    >
      <span aria-hidden="true">{number}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Los números de bloque son los del reporte: tareas y preguntas en orden, sin contexto. */
function numbered(p: ParticipantReport): Array<{ block: ParticipantReport['blocks'][number]; number: number }> {
  return p.blocks.map((block, i) => ({ block, number: i + 1 }));
}

function answerText(a: ParticipantAnswer, max: number | undefined): string {
  if (a.status === 'not-seen') return 'No llegó a esta pregunta';
  if (a.status === 'skipped' || a.answer === undefined) return 'La saltó';
  if (typeof a.answer === 'number') return max ? `${a.answer} de ${max}` : String(a.answer);
  if (Array.isArray(a.answer)) return a.answer.join(', ');
  return a.answer;
}

function PersonRow({ person, maxOf }: { person: ParticipantReport; maxOf: (blockId: string) => number | undefined }) {
  const ctx = useReport();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const name = ctx.names.get(person.sessionId) ?? person.label;
  const items = numbered(person);
  const tasks = items.filter((x): x is { block: ParticipantTask; number: number } => x.block.type === 'task');
  const meta = [person.deviceLabel ?? 'Dispositivo desconocido', formatShortDate(person.startedAt), person.variantName].filter(Boolean).join(' · ');

  return (
    <li className="rounded-xl border border-border/70 bg-card" data-testid="participant">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-6 sm:px-5">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
          className="-m-2 flex min-w-0 flex-1 flex-col gap-3 rounded-lg p-2 text-left outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring sm:flex-row sm:items-center sm:gap-6"
        >
          <span className="flex min-w-0 items-start gap-3 sm:w-64 sm:shrink-0">
            <ChevronDown className={cn('mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden="true" />
            <span className="min-w-0">
              <span className="block truncate font-medium">{name}</span>
              <span className="block truncate text-xs text-muted-foreground">{meta}</span>
            </span>
          </span>
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-6 gap-y-2 pl-7 sm:pl-0">
            {tasks.length > 0 && (
              <span className="flex flex-wrap gap-1.5">
                {tasks.map(({ block, number }) => (
                  <OutcomeChip key={block.blockId} task={block} number={number} />
                ))}
              </span>
            )}
            <span className="text-sm text-muted-foreground tabular-nums">
              {tasks.length > 0 && <span className="text-foreground font-medium">{person.achieved} de {tasks.length}</span>}
              {tasks.length > 0 && ' logradas · '}
              {seconds(person.durationMs)}
              {!person.finished && ' · no terminó'}
            </span>
          </span>
        </button>
        <Button variant="ghost" size="sm" asChild className="self-start pl-7 sm:self-center sm:pl-3">
          <Link to={recordingRoute(ctx, person.sessionId)} aria-label={`Ver la sesión de ${name}`}>
            <PlayCircle />
            Ver sesión
          </Link>
        </Button>
      </div>
      {open && (
        <div id={panelId} className="border-t border-border/70 px-4 py-5 sm:px-5">
          <ol className="space-y-5">
            {items.map(({ block, number }) => (
              <li key={block.blockId} className="flex gap-3">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold tabular-nums">{number}</span>
                {block.type === 'task' ? (
                  <TaskDetail task={block} sessionId={person.sessionId} name={name} />
                ) : (
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-sm text-muted-foreground break-words">{block.question}</p>
                    <p className={cn('break-words', block.status === 'answered' ? 'font-medium' : 'text-sm text-muted-foreground italic', block.kind === 'text' && block.status === 'answered' && 'whitespace-pre-line font-normal')}>
                      {block.kind === 'text' && block.status === 'answered' ? `«${answerText(block, undefined)}»` : answerText(block, maxOf(block.blockId))}
                    </p>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </li>
  );
}

function TaskDetail({ task, sessionId, name }: { task: ParticipantTask; sessionId: string; name: string }) {
  const ctx = useReport();
  const firstClick = task.kind === 'first-click';
  return (
    <div className="min-w-0 flex-1 space-y-2">
      <p className="font-medium break-words">{task.title}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {task.outcome === 'not-started' ? (
          <Badge variant="outline" className="text-muted-foreground">
            {NOT_STARTED_LABEL}
          </Badge>
        ) : (
          <>
            <Badge variant="outline" className={OUTCOME_BADGE[task.outcome]} title={OUTCOME_HELP[task.outcome]}>
              {outcomeLabel(task.outcome, firstClick)}
            </Badge>
            <span className="tabular-nums text-muted-foreground">{seconds(task.durationMs)}</span>
            {!firstClick && <span className="tabular-nums text-muted-foreground">{plural(task.misclicks, 'misclick', 'misclicks', 'sin misclicks')}</span>}
          </>
        )}
      </div>
      {task.startedAt !== undefined && (
        <div className="-ml-3 flex flex-wrap gap-1">
          <Button variant="ghost" size="sm" asChild>
            <Link to={recordingRoute(ctx, sessionId, task.startedAt)} aria-label={`Ver la grabación de ${name} desde el inicio de «${task.title}»`}>
              <PlayCircle />
              {task.outcome === 'review' ? 'Revisar grabación' : 'Ver esta tarea'}
            </Link>
          </Button>
          {task.goalAt !== undefined && !firstClick && (
            <Button variant="ghost" size="sm" asChild>
              <Link to={recordingRoute(ctx, sessionId, task.goalAt, 3000)} title="Abre la grabación 3 segundos antes de que se cumpliera la regla">
                Ver cuando lo logró
              </Link>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** Los colores de los cuadritos, solo con los resultados que aparecen. */
function Legend({ people }: { people: ParticipantReport[] }) {
  const seen = new Set<Outcome>(people.flatMap((p) => p.blocks.flatMap((b) => (b.type === 'task' ? [b.outcome] : []))));
  const keys = OUTCOME_ORDER.filter((k) => seen.has(k));
  if (keys.length === 0 && !seen.has('not-started')) return null;
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground" aria-label="Qué significa cada color">
      {keys.map((k) => (
        <li key={k} className="flex items-center gap-2" title={OUTCOME_HELP[k]}>
          <span className={cn('size-3 shrink-0 rounded-sm', OUTCOME_COLOR[k])} aria-hidden="true" />
          {outcomeLabel(k, false)}
        </li>
      ))}
      {seen.has('not-started') && (
        <li className="flex items-center gap-2">
          <span className="size-3 shrink-0 rounded-sm border border-dashed border-muted-foreground/60" aria-hidden="true" />
          {NOT_STARTED_LABEL}
        </li>
      )}
    </ul>
  );
}

/** Pestaña "Participantes": el recorrido completo de cada persona. */
export function ParticipantsSection({ report }: { report: StudyReport }) {
  const ctx = useReport();
  const people = useMemo(() => report.people ?? [], [report]);
  const [sort, setSort] = useState<PeopleSort>('arrival');
  const [onlyProblems, setOnlyProblems] = useState(false);
  const shown = useMemo(() => arrangePeople(people, sort, onlyProblems), [people, sort, onlyProblems]);
  const maxOf = (blockId: string): number | undefined => report.questions.find((q) => q.blockId === blockId)?.max;
  const withProblems = people.filter((p) => p.problems > 0).length;
  const excluded = report.excludedSessions ?? [];

  if (people.length === 0) {
    return (
      <EmptyState art="results" title="Todavía no hay participantes">
        Cuando alguien haga el estudio, aquí verás su recorrido completo.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-2">
            <Label htmlFor="orden-participantes" className="mb-0 font-normal text-muted-foreground">
              Ordenar por
            </Label>
            <NativeSelect id="orden-participantes" className="w-52" value={sort} onChange={(e) => setSort(e.target.value as PeopleSort)}>
              {SORTS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="solo-problemas" checked={onlyProblems} onCheckedChange={setOnlyProblems} />
            <Label htmlFor="solo-problemas" className="mb-0 font-normal">
              Solo con problemas <span className="text-muted-foreground tabular-nums">({withProblems})</span>
            </Label>
          </div>
        </div>
        <Legend people={people} />
      </div>

      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">Nadie tuvo problemas: todos lograron o siguen con sus tareas.</p>
      ) : (
        <ul className="space-y-3" aria-label="Participantes">
          {shown.map((p) => (
            <PersonRow key={p.sessionId} person={p} maxOf={maxOf} />
          ))}
        </ul>
      )}

      <div className="space-y-1 text-sm text-muted-foreground">
        <p>Toca a una persona para ver cada tarea y cada respuesta. «Con problemas»: alguna tarea en «No pudo» o «Dijo que terminó».</p>
        {report.bounced > 0 && <p>{report.bounced === 1 ? '1 persona entró y salió sin empezar' : `${report.bounced} personas entraron y salieron sin empezar`}; no están en la lista.</p>}
        {excluded.length > 0 && (
          <p>
            {plural(excluded.length, 'sesión excluida', 'sesiones excluidas')} del reporte:{' '}
            {excluded.map((x, i) => (
              <span key={x.sessionId}>
                {i > 0 && ', '}
                <Link to={{ name: 'player', id: x.sessionId }} className="underline decoration-primary/40 underline-offset-4 hover:text-primary hover:decoration-primary">
                  {ctx.names.get(x.sessionId) ?? x.label}
                </Link>
              </span>
            ))}
            .
          </p>
        )}
      </div>
    </div>
  );
}

/** Al imprimir: una tabla compacta, una fila por persona. */
export function ParticipantsPrint({ report }: { report: StudyReport }) {
  const ctx = useReport();
  const people = report.people ?? [];
  if (people.length === 0) return null;
  const tasks = (people[0] as ParticipantReport).blocks.flatMap((b, i) => (b.type === 'task' ? [{ id: b.blockId, number: i + 1, title: b.title }] : []));
  return (
    <section className="rounded-xl border bg-card p-4 sm:p-6 space-y-4" aria-labelledby="titulo-participantes" data-report-block>
      <h2 id="titulo-participantes" className="text-xl font-semibold tracking-tight" data-print="heading">
        Participantes
      </h2>
      <Table className="text-xs">
        <TableHeader>
          <TableRow>
            <TableHead>Participante</TableHead>
            <TableHead>Dispositivo · fecha</TableHead>
            {tasks.map((t) => (
              <TableHead key={t.id} title={t.title}>
                {t.number}. {t.title}
              </TableHead>
            ))}
            <TableHead className="text-right">Tiempo</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {people.map((p) => (
            <TableRow key={p.sessionId}>
              <TableCell className="font-medium">{ctx.names.get(p.sessionId) ?? p.label}</TableCell>
              <TableCell>
                {p.deviceLabel ?? '—'} · {formatShortDate(p.startedAt)}
              </TableCell>
              {p.blocks.map((b) =>
                b.type === 'task' ? (
                  <TableCell key={b.blockId}>
                    <span className="inline-flex items-center gap-1.5">
                      <span className={cn('size-2.5 shrink-0 rounded-sm', b.outcome === 'not-started' ? 'border border-dashed border-border' : OUTCOME_COLOR[b.outcome])} aria-hidden="true" />
                      {taskOutcomeLabel(b)}
                    </span>
                  </TableCell>
                ) : null,
              )}
              <TableCell className="text-right tabular-nums">{seconds(p.durationMs)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
