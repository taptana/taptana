import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ClipboardCheck, Copy, Download, Pencil, Printer, Users } from 'lucide-react';
import {
  BLOCK_KIND_LABELS,
  blockTitle,
  studyBlocks,
  taskBlocks,
  type Prototype,
  type ReportFilter,
  type ScreenInfo,
  type ServerInfo,
  type SessionSummary,
  type StudyRecord,
  type StudyReport,
} from '@taptana/shared';
import { getClient, IS_DEMO } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label, NativeSelect } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { EmptyState, ErrorState, Layout, PageHeader, PageSkeleton } from '@/components/layout';
import { BlockIndex, blockAnchor, type IndexEntry } from '@/components/report/block-index';
import { ReportContext, type ReportContextValue } from '@/components/report/context';
import { InsightsCard, Overview, ScoreChip, VariantsCard } from '@/components/report/overview';
import { QuestionBody } from '@/components/report/question-section';
import { ReviewDialog } from '@/components/report/review-dialog';
import { clearSnapshotCache, whenSnapshotsReady } from '@/components/report/snapshot-view';
import { StudyTabs } from '@/components/report/study-tabs';
import { TaskBody } from '@/components/report/task-section';
import { copyText, downloadText } from '@/lib/download';
import { friendlyError } from '@/lib/errors';
import { plural } from '@/lib/format';
import { participantUrl } from '@/lib/links';
import { screenNamer } from '@/lib/screens';
import { fileSlug, sessionName } from '@/lib/sessions';
import { cn } from '@/lib/utils';
import { Link } from '@/router';
import '@/report.css';

export { StudyTabs };

interface Base {
  study: StudyRecord;
  proto: Prototype | undefined;
  info: ServerInfo | null;
  sessions: SessionSummary[];
  /** Pantallas del prototipo según la API: de aquí sale el nombre de cada pantalla. */
  screens: ScreenInfo[];
}

/** true mientras se imprime (o se emula la impresión): el reporte dibuja todo. */
function usePrinting(): [boolean, (value: boolean) => void] {
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('print');
    const onMedia = (): void => setPrinting(media.matches);
    const on = (): void => setPrinting(true);
    const off = (): void => setPrinting(false);
    if (media.matches) setPrinting(true);
    media.addEventListener('change', onMedia);
    window.addEventListener('beforeprint', on);
    window.addEventListener('afterprint', off);
    return () => {
      media.removeEventListener('change', onMedia);
      window.removeEventListener('beforeprint', on);
      window.removeEventListener('afterprint', off);
    };
  }, []);
  return [printing, setPrinting];
}

export function ReportPage({ id }: { id: string }) {
  const [base, setBase] = useState<Base | null | undefined>(undefined);
  const [report, setReport] = useState<StudyReport | null>(null);
  const [filter, setFilter] = useState<ReportFilter>({});
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [focus, setFocus] = useState<{ blockId: string; screen?: string; n: number } | null>(null);
  const [printing, setPrinting] = usePrinting();
  const [preparingPrint, setPreparingPrint] = useState(false);
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const request = useRef(0);

  /** Pide estudio, sesiones y reporte. Si llega una respuesta vieja (cambió el filtro), se descarta. */
  const load = useCallback(
    async (next: ReportFilter, opts: { first?: boolean } = {}): Promise<void> => {
      const mine = ++request.current;
      if (opts.first) {
        setBase(undefined);
        setError(null);
      } else setRefreshing(true);
      try {
        const client = await getClient();
        const study = await client.getStudy(id);
        if (mine !== request.current) return;
        if (!study) {
          setBase(null);
          return;
        }
        const [r, protos, sessions, info, screens] = await Promise.all([
          client.getStudyReport(id, next),
          client.listPrototypes(),
          client.listSessions(id),
          client.info().catch(() => null),
          client.listPrototypeScreens(study.prototypeId).catch((): ScreenInfo[] => []),
        ]);
        if (mine !== request.current) return;
        setBase({ study, proto: protos.find((p) => p.id === study.prototypeId), info, sessions, screens });
        setReport(r);
        setError(null);
      } catch (e) {
        if (mine !== request.current) return;
        const message = friendlyError(e, 'No pudimos cargar los resultados. Revisa que el servidor de Taptana siga abierto y vuelve a intentarlo.');
        if (opts.first) setError(message);
        else toast.error(message);
      } finally {
        if (mine === request.current) setRefreshing(false);
      }
    },
    [id],
  );

  useEffect(() => {
    void load({}, { first: true });
    return () => {
      request.current++;
      clearSnapshotCache();
    };
  }, [load]);

  const changeFilter = (next: ReportFilter): void => {
    setFilter(next);
    void load(next);
  };

  const reload = useCallback(() => load(filterRef.current), [load]);

  const context = useMemo((): ReportContextValue | null => {
    if (!base) return null;
    const ordered = [...base.sessions].sort((a, b) => a.startedAt - b.startedAt);
    const names = new Map<string, string>();
    ordered.forEach((s, i) => names.set(s.id, sessionName(s) ?? `Participante ${i + 1}`));
    // Un solo nombre por pantalla: el de la API; si la pantalla no está ahí, el título del reporte.
    // `screenNames` llega con la versión nueva del reporte; un servidor anterior no lo manda.
    const named = Object.entries((report as (StudyReport & { screenNames?: Record<string, string> }) | null)?.screenNames ?? {}).map(([id, name]) => ({ id, name }));
    const fromReport = (report?.tasks ?? []).flatMap((t) => t.screens.map((s) => ({ id: s.path, title: s.title })));
    const screenName = screenNamer([...named, ...base.screens, ...fromReport]);
    return { study: base.study, proto: base.proto, sessions: new Map(base.sessions.map((s) => [s.id, s])), names, screenName, printing, reload };
  }, [base, report, printing, reload]);

  const entries = useMemo((): IndexEntry[] => {
    if (!base || !report) return [];
    const blocks = new Map(studyBlocks(base.study).map((b) => [b.id, b]));
    const out: IndexEntry[] = [];
    for (const item of report.order) {
      if (item.kind === 'context') continue;
      const block = blocks.get(item.blockId);
      const task = report.tasks.find((t) => t.taskId === item.blockId);
      const question = report.questions.find((q) => q.blockId === item.blockId);
      if (!task && !question) continue;
      const entry: IndexEntry = {
        id: item.blockId,
        number: out.length + 1,
        title: task?.title || question?.question || (block ? blockTitle(block) : '') || 'Sin título',
        kindLabel: BLOCK_KIND_LABELS[item.kind],
      };
      if (task) entry.score = task.score;
      if (question) entry.hint = question.kind === 'scale' && typeof question.average === 'number' ? `${question.average.toFixed(1).replace('.', ',')} de ${question.max ?? ''}`.trim() : plural(question.responses, 'respuesta', 'respuestas');
      out.push(entry);
    }
    return out;
  }, [base, report]);

  const jump = useCallback((blockId: string, screen?: string): void => {
    setFocus((f) => ({ blockId, ...(screen ? { screen } : {}), n: (f?.n ?? 0) + 1 }));
    document.getElementById(blockAnchor(blockId))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  if (error) {
    return (
      <Layout wide>
        <ErrorState message={error} onRetry={() => void load(filter, { first: true })} home />
      </Layout>
    );
  }
  if (base === undefined || (base && !report)) {
    return (
      <Layout wide>
        <PageSkeleton variant="cards" />
      </Layout>
    );
  }
  if (base === null || !report || !context) {
    return (
      <Layout>
        <EmptyState
          icon={<Users className="size-5" />}
          title="Este estudio no existe"
          action={
            <Button asChild>
              <Link to={{ name: 'studies' }}>Ver mis estudios</Link>
            </Button>
          }
        >
          Puede que lo hayan borrado o que el link esté incompleto.
        </EmptyState>
      </Layout>
    );
  }

  const { study, proto } = base;
  const filtered = Boolean(filter.variantId || filter.device);
  const tasks = taskBlocks(study);
  const variantName = filter.variantId ? (study.variants?.find((v) => v.id === filter.variantId)?.name ?? filter.variantId) : null;

  const exportCsv = async (): Promise<void> => {
    try {
      const client = await getClient();
      const csv = await client.exportStudyCsv(id);
      if (csv === null) throw new Error('El estudio ya no existe.');
      downloadText(`${fileSlug(study.name) || 'estudio'}-resultados.csv`, csv, 'text/csv;charset=utf-8');
      toast.success('CSV descargado: una fila por participante.');
    } catch (e) {
      toast.error(friendlyError(e, 'No se pudo exportar el CSV. Inténtalo de nuevo.'));
    }
  };

  const print = async (): Promise<void> => {
    // Primero se dibujan todas las pestañas y todos los mapas; después se abre el diálogo.
    setPreparingPrint(true);
    setPrinting(true);
    await new Promise((r) => setTimeout(r, 200));
    await whenSnapshotsReady();
    setPreparingPrint(false);
    window.print();
    if (!window.matchMedia('print').matches) setPrinting(false);
  };

  return (
    <ReportContext.Provider value={context}>
      <Layout wide>
        <PageHeader
          back={
            <Button variant="ghost" size="icon" asChild className="mt-1 print:hidden">
              <Link to={{ name: 'studies' }} aria-label="Volver a estudios">
                <ArrowLeft />
              </Link>
            </Button>
          }
          title={study.name}
          description={
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>
                Resultados · {plural(tasks.length, 'tarea', 'tareas')} · prototipo {proto?.name ?? study.prototypeId}
              </span>
              {study.closed && <Badge variant="outline">Cerrado: ya no recibe respuestas</Badge>}
            </span>
          }
          actions={<StudyTabs id={id} active="report" />}
        />

        <div className="flex flex-wrap items-end justify-between gap-3" data-print="hide">
          <div className="flex flex-wrap items-end gap-3">
            {(study.variants?.length ?? 0) > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="filtro-variante">Variante</Label>
                <NativeSelect
                  id="filtro-variante"
                  className="w-44"
                  value={filter.variantId ?? ''}
                  onChange={(e) => changeFilter({ ...(e.target.value ? { variantId: e.target.value } : {}), ...(filter.device ? { device: filter.device } : {}) })}
                >
                  <option value="">Todas</option>
                  {study.variants?.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="filtro-dispositivo">Dispositivo</Label>
              <NativeSelect
                id="filtro-dispositivo"
                className="w-52"
                value={filter.device ?? ''}
                onChange={(e) => {
                  const device = e.target.value as '' | 'touch' | 'desktop';
                  changeFilter({ ...(filter.variantId ? { variantId: filter.variantId } : {}), ...(device ? { device } : {}) });
                }}
              >
                <option value="">Todos ({report.devices.touch + report.devices.desktop})</option>
                <option value="touch">Celular o tablet ({report.devices.touch})</option>
                <option value="desktop">Escritorio ({report.devices.desktop})</option>
              </NativeSelect>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void exportCsv()} disabled={report.participants === 0 && !filtered}>
              <Download />
              Exportar CSV
            </Button>
            <Button variant="outline" onClick={() => void print()} disabled={preparingPrint || report.participants === 0}>
              <Printer />
              {preparingPrint ? 'Preparando…' : 'Imprimir / PDF'}
            </Button>
          </div>
        </div>

        {filtered && (
          <p className="hidden print:block text-sm text-muted-foreground">
            Filtro: {[variantName && `variante ${variantName}`, filter.device === 'touch' && 'celular o tablet', filter.device === 'desktop' && 'escritorio'].filter(Boolean).join(' · ')}
          </p>
        )}

        {report.participants === 0 ? (
          filtered ? (
            <EmptyState
              icon={<Users className="size-5" />}
              title="Nadie coincide con este filtro"
              action={
                <Button variant="outline" onClick={() => changeFilter({})}>
                  Quitar filtros
                </Button>
              }
            >
              Prueba con otra variante u otro dispositivo.
            </EmptyState>
          ) : (
            <NoParticipants base={base} excluded={report.excluded} />
          )
        ) : (
          <div className={cn('space-y-8 transition-opacity', refreshing && 'opacity-60')} aria-busy={refreshing}>
            <Overview report={report} />

            {report.pendingReview > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-600/30 bg-sky-500/10 px-4 py-3" data-print="keep">
                <p className="flex items-start gap-2.5 text-sm min-w-0">
                  <ClipboardCheck className="size-4.5 mt-0.5 shrink-0 text-sky-700 dark:text-sky-400" />
                  <span>
                    <span className="font-medium">{plural(report.pendingReview, 'resultado por revisar', 'resultados por revisar')}.</span> Son tareas que decides tú; no cuentan en el éxito ni en el puntaje
                    hasta que las marques.
                  </span>
                </p>
                <Button size="sm" onClick={() => setReviewOpen(true)} data-print="hide">
                  Revisar pendientes
                </Button>
              </div>
            )}

            <InsightsCard insights={report.insights} onJump={jump} />
            <VariantsCard report={report} />

            <BlockIndex entries={entries} onJump={jump} variant="bar" />
            <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_15rem] xl:gap-8 print:block">
              <div className="space-y-8 min-w-0">
                {entries.map((entry) => {
                  const task = report.tasks.find((t) => t.taskId === entry.id);
                  const question = report.questions.find((q) => q.blockId === entry.id);
                  return (
                    <section
                      key={entry.id}
                      id={blockAnchor(entry.id)}
                      data-report-block
                      aria-labelledby={`titulo-${entry.id}`}
                      className="scroll-mt-16 xl:scroll-mt-6 rounded-xl border bg-card p-4 sm:p-6 space-y-5 min-w-0"
                    >
                      <header className="flex items-start gap-3" data-print="heading">
                        <span className="size-8 shrink-0 rounded-full bg-primary text-primary-foreground grid place-items-center text-sm font-semibold tabular-nums">{entry.number}</span>
                        <div className="min-w-0 flex-1 space-y-1">
                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{entry.kindLabel}</p>
                          <h2 id={`titulo-${entry.id}`} className="text-xl font-semibold tracking-tight break-words">
                            {entry.title}
                          </h2>
                        </div>
                        {task && task.participants > 0 && (
                          <div className="text-right shrink-0">
                            <ScoreChip score={task.score} className="text-2xl" />
                            <p className="text-xs text-muted-foreground">{plural(task.participants, 'participante', 'participantes')}</p>
                          </div>
                        )}
                      </header>
                      {task && <TaskBody task={task} block={tasks.find((b) => b.id === task.taskId)} focusScreen={focus?.blockId === task.taskId ? focus.screen : undefined} />}
                      {question && <QuestionBody question={question} />}
                    </section>
                  );
                })}
                {entries.length === 0 && (
                  <EmptyState
                    icon={<Pencil className="size-5" />}
                    title="Este estudio no tiene tareas ni preguntas"
                    action={
                      <Button asChild>
                        <Link to={{ name: 'study', id }}>Ir a Diseño</Link>
                      </Button>
                    }
                  >
                    Agrega bloques en Diseño para ver resultados aquí.
                  </EmptyState>
                )}
                <p className="text-sm text-muted-foreground" data-print="hide">
                  ¿Buscas una grabación completa?{' '}
                  <Link to={{ name: 'recordings', study: id }} className="underline underline-offset-4 hover:text-foreground">
                    Ver las sesiones de este estudio
                  </Link>
                </p>
              </div>
              <BlockIndex entries={entries} onJump={jump} variant="side" />
            </div>
            <ReviewDialog report={report} open={reviewOpen} onOpenChange={setReviewOpen} />
          </div>
        )}
      </Layout>
    </ReportContext.Provider>
  );
}

/** Todavía sin participantes: cómo compartir el estudio. */
function NoParticipants({ base, excluded }: { base: Base; excluded: number }) {
  const { study, proto, info } = base;
  const link = info && proto ? participantUrl(info, proto, study.id) : null;
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    if (!link) return;
    let alive = true;
    void getClient().then((c) => alive && setQr(c.qrImageUrl(link)));
    return () => {
      alive = false;
    };
  }, [link]);

  const copy = async (): Promise<void> => {
    if (!link) return;
    if (await copyText(link)) toast.success('Link copiado.');
    else toast.error('No se pudo copiar. Selecciona el link y cópialo a mano.');
  };

  return (
    <EmptyState
      icon={<Users className="size-5" />}
      title="Todavía nadie hizo este estudio"
      action={
        <>
          {link && (
            <Button onClick={() => void copy()}>
              <Copy />
              Copiar link
            </Button>
          )}
          <Button variant="outline" asChild>
            <Link to={{ name: 'study', id: study.id }}>Ir a Diseño</Link>
          </Button>
        </>
      }
    >
      {study.closed ? (
        <p>El estudio está cerrado y no recibe respuestas. Ábrelo de nuevo desde Diseño para compartirlo.</p>
      ) : link ? (
        <>
          <p>Comparte este link con tus participantes (o muéstrales el código QR). Cuando alguien termine, los resultados aparecen aquí solos.</p>
          <p className="rounded-md border bg-muted/50 px-3 py-2 font-mono text-xs break-all select-all text-foreground">{link}</p>
          {qr && <img src={qr} alt="Código QR del link del estudio" className="mx-auto size-40 rounded-lg border bg-white p-2" />}
          <p className="text-xs">{IS_DEMO ? 'En esta demo el link solo funciona en este mismo navegador.' : 'El celular del participante tiene que estar en la misma red Wi-Fi que esta computadora.'}</p>
        </>
      ) : (
        <p>Este estudio no tiene un prototipo disponible aquí. Elige uno en Diseño para obtener el link que se comparte.</p>
      )}
      {excluded > 0 && <p>Hay {plural(excluded, 'sesión excluida', 'sesiones excluidas')} del reporte. Puedes volver a incluirlas desde Sesiones.</p>}
    </EmptyState>
  );
}
