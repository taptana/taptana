import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, ClipboardCheck, Copy, Download, Pencil, Presentation, Printer, Users } from 'lucide-react';
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Label, NativeSelect } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import { EmptyState, ErrorState, Layout, Notice, PageHeader, PageSkeleton } from '@/components/layout';
import { BlockPicker, blockAnchor, type IndexEntry } from '@/components/report/block-index';
import { ReportContext, type ReportContextValue } from '@/components/report/context';
import { InsightsCard, Overview, ScoreChip, VariantsCard } from '@/components/report/overview';
import { ParticipantsPrint, ParticipantsSection } from '@/components/report/participants-section';
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
import { Link, type Route } from '@/router';
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

/** Pestañas del reporte. Van en la dirección (`?tab=`) para que un link o una recarga vuelvan al mismo lugar. */
type ReportTab = 'resumen' | 'tareas' | 'preguntas' | 'participantes';
const REPORT_TABS: ReportTab[] = ['resumen', 'tareas', 'preguntas', 'participantes'];

function readTabParams(): { tab: ReportTab; task: string | null } {
  const q = new URLSearchParams(location.search);
  const raw = q.get('tab');
  return { tab: REPORT_TABS.includes(raw as ReportTab) ? (raw as ReportTab) : 'resumen', task: q.get('tarea') };
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
  const [tab, setTab] = useState<ReportTab>(() => readTabParams().tab);
  const [taskId, setTaskId] = useState<string | null>(() => readTabParams().task);
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
        kind: item.kind,
        kindLabel: BLOCK_KIND_LABELS[item.kind],
      };
      if (task) entry.score = task.score;
      if (question) entry.hint = question.kind === 'scale' && typeof question.average === 'number' ? `${question.average.toFixed(1).replace('.', ',')} de ${question.max ?? ''}`.trim() : plural(question.responses, 'respuesta', 'respuestas');
      out.push(entry);
    }
    return out;
  }, [base, report]);

  const taskEntries = useMemo(() => entries.filter((e) => report?.tasks.some((t) => t.taskId === e.id)), [entries, report]);
  const questionEntries = useMemo(() => entries.filter((e) => report?.questions.some((q) => q.blockId === e.id)), [entries, report]);

  // La pestaña y la tarea elegida quedan en la dirección, sin agregar pasos al historial.
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (tab === 'resumen') q.delete('tab');
    else q.set('tab', tab);
    if (tab === 'tareas' && taskId) q.set('tarea', taskId);
    else q.delete('tarea');
    const search = q.toString();
    const next = `${location.pathname}${search ? `?${search}` : ''}`;
    if (next !== `${location.pathname}${location.search}`) history.replaceState(history.state, '', next);
  }, [tab, taskId]);

  /** Lleva a un bloque (desde «Lo más importante»): cambia a su pestaña y lo muestra. */
  const jump = useCallback(
    (blockId: string, screen?: string): void => {
      setFocus((f) => ({ blockId, ...(screen ? { screen } : {}), n: (f?.n ?? 0) + 1 }));
      if (report?.tasks.some((t) => t.taskId === blockId)) {
        setTab('tareas');
        setTaskId(blockId);
      } else setTab('preguntas');
      setTimeout(() => document.getElementById(blockAnchor(blockId))?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    },
    [report],
  );

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
          art="lost"
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

  /** La presentación, con el mismo filtro que se está viendo. */
  const presentation: Route = { name: 'presentation', id, ...(filter.variantId ? { variant: filter.variantId } : {}), ...(filter.device ? { device: filter.device } : {}) };

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

  const toolbar = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3" data-print="hide">
      {(study.variants?.length ?? 0) > 0 && (
        <div className="flex items-center gap-2">
          <Label htmlFor="filtro-variante" className="mb-0 text-muted-foreground font-normal">
            Variante
          </Label>
          <NativeSelect
            id="filtro-variante"
            className="w-36"
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
      <div className="flex items-center gap-2">
        <Label htmlFor="filtro-dispositivo" className="mb-0 text-muted-foreground font-normal">
          Dispositivo
        </Label>
        <NativeSelect
          id="filtro-dispositivo"
          className="w-48"
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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" disabled={preparingPrint}>
            <Download />
            {preparingPrint ? 'Preparando…' : 'Exportar'}
            <ChevronDown className="opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => void exportCsv()} disabled={report.participants === 0 && !filtered}>
            <Download />
            Exportar CSV
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void print()} disabled={report.participants === 0}>
            <Printer />
            Imprimir / PDF
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to={presentation}>
              <Presentation />
              Crear presentación
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  /** Un bloque del reporte (tarea o pregunta) con su encabezado. */
  const renderBlock = (entry: IndexEntry): React.ReactNode => {
    const task = report.tasks.find((t) => t.taskId === entry.id);
    const question = report.questions.find((q) => q.blockId === entry.id);
    return (
      <section
        key={entry.id}
        id={blockAnchor(entry.id)}
        data-report-block
        aria-labelledby={`titulo-${entry.id}`}
        className={cn('scroll-mt-6 min-w-0', printing ? 'border-t border-foreground pt-4 space-y-5' : 'space-y-8')}
      >
        <header className="flex items-start gap-4" data-print="heading">
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="type-eyebrow">
              {String(entry.number).padStart(2, '0')} — {entry.kindLabel}
            </p>
            <h2 id={`titulo-${entry.id}`} className="type-section break-words">
              {entry.title}
            </h2>
          </div>
          {task && task.participants > 0 && (
            <div className="shrink-0 space-y-1 text-right">
              <p className="type-eyebrow">Puntaje</p>
              <ScoreChip score={task.score} className="text-2xl" />
              <p className="num text-xs text-muted-foreground">{plural(task.participants, 'participante', 'participantes')}</p>
            </div>
          )}
        </header>
        {task && <TaskBody task={task} block={tasks.find((b) => b.id === task.taskId)} focusScreen={focus?.blockId === task.taskId ? focus.screen : undefined} />}
        {question && <QuestionBody question={question} />}
      </section>
    );
  };

  const summary = (
    <>
      <Overview report={report} />
      {report.pendingReview > 0 && (
        <div data-print="keep">
          <Notice
            icon={<ClipboardCheck />}
            title={`${plural(report.pendingReview, 'resultado por revisar', 'resultados por revisar')}.`}
            action={
              <Button size="sm" onClick={() => setReviewOpen(true)} data-print="hide">
                Revisar pendientes
              </Button>
            }
          >
            <p>Son tareas que decides tú; no cuentan en el éxito ni en el puntaje hasta que las marques.</p>
          </Notice>
        </div>
      )}
      <InsightsCard insights={report.insights} onJump={jump} />
      <VariantsCard report={report} />
      <section aria-labelledby="titulo-presentacion" className="flex flex-col gap-4 border-t border-foreground pt-5 sm:flex-row sm:items-end sm:justify-between" data-print="hide">
        <div className="space-y-1.5">
          <h2 id="titulo-presentacion" className="type-section">
            Presentación lista para compartir
          </h2>
          <p className="text-sm text-muted-foreground max-w-[65ch]">Las diapositivas con lo más importante, armadas solas con estos resultados. Preséntalas o descárgalas en PowerPoint o PDF.</p>
        </div>
        <Button asChild variant="outline" className="shrink-0">
          <Link to={presentation}>
            <Presentation />
            Crear presentación
          </Link>
        </Button>
      </section>
    </>
  );

  const noBlocks = (
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
  );
  const sessionsLink = (
    <p className="text-sm text-muted-foreground" data-print="hide">
      ¿Buscas una grabación completa?{' '}
      <Link to={{ name: 'recordings', study: id }} className="link-ink text-foreground">
        Ver las sesiones de este estudio
      </Link>
    </p>
  );
  const selectedTask = taskEntries.find((e) => e.id === taskId) ?? taskEntries[0];
  const activeTab: ReportTab = tab === 'preguntas' && questionEntries.length === 0 ? 'resumen' : tab;

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
          eyebrow={<>Resultados · {plural(tasks.length, 'tarea', 'tareas')}</>}
          description={
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>Prototipo: {proto?.name ?? study.prototypeId}</span>
              {study.closed && <Badge variant="outline">Cerrado: ya no recibe respuestas</Badge>}
            </span>
          }
          actions={<StudyTabs id={id} active="report" />}
        />

        {filtered && (
          <p className="hidden print:block text-sm text-muted-foreground">
            Filtro: {[variantName && `variante ${variantName}`, filter.device === 'touch' && 'celular o tablet', filter.device === 'desktop' && 'escritorio'].filter(Boolean).join(' · ')}
          </p>
        )}

        {report.participants === 0 ? (
          <>
            {toolbar}
            {filtered ? (
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
            )}
          </>
        ) : (
          <div className={cn('transition-opacity', refreshing && 'opacity-60')} aria-busy={refreshing}>
            {printing ? (
              // Al imprimir va todo el reporte, todas las pestañas una tras otra.
              <div className="space-y-8">
                {summary}
                {entries.map(renderBlock)}
                {entries.length === 0 && noBlocks}
                <ParticipantsPrint report={report} />
              </div>
            ) : (
              <Tabs value={activeTab} onValueChange={(v) => setTab(v as ReportTab)} className="gap-10">
                <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b">
                  <TabsList
                    aria-label="Partes del reporte"
                    className="h-auto -mb-px w-full sm:w-fit flex-nowrap gap-x-5 overflow-x-auto overflow-y-hidden border-b-0 sm:gap-x-7 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden max-sm:[mask-image:linear-gradient(to_right,#000_85%,transparent)] max-sm:pr-6"
                  >
                    {(
                      [
                        { id: 'resumen', label: 'Resumen', count: null },
                        { id: 'tareas', label: 'Tareas', count: taskEntries.length },
                        ...(questionEntries.length > 0 ? [{ id: 'preguntas', label: 'Preguntas', count: questionEntries.length }] : []),
                        { id: 'participantes', label: 'Participantes', count: (report.people ?? []).length },
                      ] as Array<{ id: ReportTab; label: string; count: number | null }>
                    ).map((t) => (
                      <TabsTrigger
                        key={t.id}
                        value={t.id}
                        className="mb-0 min-h-11 px-0.5 pt-1 pb-3 text-[15px] data-[state=active]:font-semibold"
                      >
                        {t.label}
                        {t.count !== null && <span className="num text-2xs font-medium text-muted-foreground">{String(t.count).padStart(2, '0')}</span>}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  <div className="order-first w-full pb-1 lg:order-none lg:w-auto lg:pb-3">{toolbar}</div>
                </div>

                <TabsContent value="resumen" className="space-y-10 lg:space-y-14">
                  {summary}
                  {sessionsLink}
                </TabsContent>

                <TabsContent value="tareas" className="space-y-10 lg:space-y-12">
                  <BlockPicker entries={taskEntries} current={selectedTask?.id} onSelect={(blockId) => setTaskId(blockId)} label="Tareas del estudio" />
                  {selectedTask ? renderBlock(selectedTask) : entries.length === 0 ? noBlocks : <p className="text-muted-foreground">Este estudio no tiene tareas, solo preguntas.</p>}
                  {sessionsLink}
                </TabsContent>

                <TabsContent value="preguntas" className="space-y-12">
                  {questionEntries.map((entry, i) => (
                    <div key={entry.id} className={cn(i > 0 && 'border-t pt-12')}>
                      {renderBlock(entry)}
                    </div>
                  ))}
                </TabsContent>

                <TabsContent value="participantes" className="space-y-10">
                  <ParticipantsSection report={report} />
                </TabsContent>
              </Tabs>
            )}
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
      art="results"
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
          <p className="border-y py-2 font-mono text-sm break-all select-all text-foreground">{link}</p>
          {qr && <img src={qr} alt="Código QR del link del estudio" className="size-40 rounded-sm border bg-white p-2" />}
          <p className="text-sm">{IS_DEMO ? 'En esta demo el link solo funciona en este mismo navegador.' : 'El celular del participante tiene que estar en la misma red Wi-Fi que esta computadora.'}</p>
        </>
      ) : (
        <p>Este estudio no tiene un prototipo disponible aquí. Elige uno en Diseño para obtener el link que se comparte.</p>
      )}
      {excluded > 0 && <p>Hay {plural(excluded, 'sesión excluida', 'sesiones excluidas')} del reporte. Puedes volver a incluirlas desde Sesiones.</p>}
    </EmptyState>
  );
}
