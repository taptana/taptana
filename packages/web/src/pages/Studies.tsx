/**
 * Lista de estudios: una tarjeta por estudio con su estado, participantes y puntaje, y las
 * acciones para ver resultados, editar, duplicar, exportar y borrar. Desde aquí también se crea
 * uno nuevo o se importa un study.json (archivo o JSON pegado).
 */
import { useEffect, useState } from 'react';
import { BarChart3, Copy, Download, Ellipsis, FlaskConical, PencilRuler, Plus, Trash2, TriangleAlert, Upload } from 'lucide-react';
import { isQuestionBlock, isTaskBlock, studyBlocks, type Prototype, type SessionSummary, type Study, type StudyRecord, type StudyReport } from '@taptana/shared';
import { getClient } from '@/api/client';
import { ImportDialog } from '@/components/builder/dialogs';
import { studyFileName, toDraft } from '@/components/builder/draft';
import { DotRow } from '@/components/brand/dot-board';
import { scoreBand } from '@/components/report/logic.ts';
import { TONE_DOT } from '@/components/report/overview';
import { EmptyState, ErrorState, Layout, ListSkeleton, PageHeader } from '@/components/layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/toast';
import { downloadText } from '@/lib/download';
import { friendlyError } from '@/lib/errors';
import { plural } from '@/lib/format';
import { formatRelative } from '@/lib/utils';
import { Link, useRouter } from '@/router';

function contents(study: StudyRecord): string {
  const blocks = studyBlocks(study);
  const tasks = blocks.filter(isTaskBlock).length;
  const questions = blocks.filter(isQuestionBlock).length;
  const parts = [plural(tasks, 'tarea', 'tareas', 'sin tareas')];
  if (questions > 0) parts.push(plural(questions, 'pregunta', 'preguntas'));
  return parts.join(' · ');
}

export function StudiesPage() {
  const [studies, setStudies] = useState<StudyRecord[] | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [protos, setProtos] = useState<Prototype[]>([]);
  const [reports, setReports] = useState<Record<string, StudyReport | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [toDelete, setToDelete] = useState<StudyRecord | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { navigate } = useRouter();

  const load = async (): Promise<void> => {
    setError(null);
    try {
      const client = await getClient();
      const [st, se, pr] = await Promise.all([client.listStudies(), client.listSessions(), client.listPrototypes()]);
      setStudies(st);
      setSessions(se);
      setProtos(pr);
      // El puntaje sale del reporte; solo se pide para los estudios que ya tienen sesiones.
      const withSessions = st.filter((s) => se.some((x) => x.studyId === s.id));
      const entries = await Promise.all(withSessions.map(async (s) => [s.id, await client.getStudyReport(s.id).catch(() => null)] as const));
      setReports(Object.fromEntries(entries));
    } catch (e) {
      setError(friendlyError(e, 'No pudimos leer tus estudios.'));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const onImport = async (study: Study): Promise<void> => {
    const client = await getClient();
    const saved = await client.saveStudy(study);
    toast.success('Estudio importado. Revísalo antes de compartir.');
    navigate({ name: 'study', id: saved.id });
  };

  const onDuplicate = async (study: StudyRecord): Promise<void> => {
    setBusyId(study.id);
    try {
      const client = await getClient();
      const copy = await client.duplicateStudy(study.id);
      toast.success(`Se creó "${copy.name}".`);
      await load();
    } catch (e) {
      toast.error(friendlyError(e, 'No se pudo duplicar el estudio.'));
    } finally {
      setBusyId(null);
    }
  };

  const onExport = (study: StudyRecord): void => {
    downloadText(studyFileName(study.name), JSON.stringify(toDraft(study), null, 2));
  };

  const onDelete = async (study: StudyRecord): Promise<void> => {
    try {
      const client = await getClient();
      await client.deleteStudy(study.id);
      toast.success('Estudio borrado.');
      await load();
    } catch (e) {
      toast.error(friendlyError(e, 'No se pudo borrar el estudio.'));
    }
  };

  const actions = (
    <>
      <Button asChild>
        <Link to={{ name: 'study', id: null }}>
          <Plus /> Nuevo estudio
        </Link>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label="Más acciones">
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setImportOpen(true)}>
            <Upload /> Importar estudio
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
  const deleteCount = toDelete ? sessions.filter((s) => s.studyId === toDelete.id).length : 0;

  return (
    <Layout>
      <PageHeader eyebrow={studies && studies.length > 0 ? plural(studies.length, 'estudio', 'estudios') : undefined} title="Estudios" description="Tareas y preguntas sobre tu prototipo. Compartes un link y ves cómo le fue a cada persona." actions={actions} />

      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : studies === null ? (
        <ListSkeleton />
      ) : studies.length === 0 ? (
        <EmptyState
          art="studies"
          title="Crea tu primer estudio"
          action={
            <>
              <Button asChild>
                <Link to={{ name: 'study', id: null }}>
                  <Plus /> Nuevo estudio
                </Link>
              </Button>
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                <Upload /> Importar estudio
              </Button>
            </>
          }
        >
          <p>Agrega tareas y preguntas bloque por bloque, o pídele a una IA que las arme: en el constructor está el botón "Armar con IA".</p>
          {protos.length === 0 && <p>Antes necesitas un prototipo: súbelo en la sección Prototipos.</p>}
        </EmptyState>
      ) : (
        <ul className="border-t border-foreground" aria-label="Estudios">
          {studies.map((s) => {
            const proto = protos.find((p) => p.id === s.prototypeId);
            const report = reports[s.id] ?? null;
            const participants = report?.participants ?? sessions.filter((x) => x.studyId === s.id).length;
            const score = report?.score ?? null;
            return (
              <li key={s.id} className="min-w-0 border-b py-6 sm:py-7">
                <div className="flex flex-col gap-5 md:flex-row md:items-center md:gap-8">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <Link to={{ name: 'study', id: s.id }} className="font-display text-[1.375rem] font-semibold tracking-[-0.015em] leading-snug break-words underline-offset-4 decoration-1 hover:underline rounded-sm outline-none focus-ink">
                        {s.name}
                      </Link>
                      {s.closed ? (
                        <Badge variant="secondary">Cerrado</Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1.5">
                          <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden /> Recibe respuestas
                        </Badge>
                      )}
                      {s.variants?.length ? <Badge variant="outline">A/B</Badge> : null}
                    </div>
                    {s.description && <p className="line-clamp-1 max-w-[65ch] text-[15px] text-foreground/80">{s.description}</p>}
                    <p className="text-sm text-muted-foreground">
                      {contents(s)} ·{' '}
                      {proto ? (
                        <>
                          Prototipo: <span className="text-foreground">{proto.name}</span>
                        </>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                          <TriangleAlert className="size-3.5" /> Su prototipo ya no está: elige otro en Diseño
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">Actualizado {formatRelative(s.updatedAt)}</p>
                  </div>
                  <dl className="flex shrink-0 gap-8">
                    <div className="flex flex-col-reverse gap-1.5">
                      <dd className="font-display text-[1.75rem] font-bold tabular-nums tracking-[-0.03em] leading-none">{participants}</dd>
                      <dt className="type-eyebrow">{participants === 1 ? 'Participante' : 'Participantes'}</dt>
                    </div>
                    <div className="flex flex-col-reverse gap-1.5">
                      <dd className="flex items-center gap-2.5 font-display text-[1.75rem] font-bold tabular-nums tracking-[-0.03em] leading-none">
                        {score === null ? '—' : score}
                        {score !== null && <DotRow value={score} className={TONE_DOT[scoreBand(score).tone]} />}
                      </dd>
                      <dt className="type-eyebrow">{score === null && participants > 0 ? 'Puntaje: faltan resultados' : 'Puntaje'}</dt>
                    </div>
                  </dl>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button variant="outline" className="flex-1 md:flex-none" asChild>
                      <Link to={{ name: 'report', id: s.id }}>
                        Ver resultados
                      </Link>
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" disabled={busyId === s.id} aria-label={`Más acciones de "${s.name}"`}>
                          <Ellipsis />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link to={{ name: 'study', id: s.id }}>
                            <PencilRuler /> Diseño
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => void onDuplicate(s)}>
                          <Copy /> Duplicar
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onExport(s)}>
                          <Download /> Exportar study.json
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem destructive onSelect={() => setToDelete(s)}>
                          <Trash2 /> Borrar
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ImportDialog open={importOpen} onOpenChange={setImportOpen} protos={protos} onImport={onImport} />
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`¿Borrar el estudio "${toDelete?.name ?? ''}"?`}
        description={
          deleteCount > 0
            ? `${deleteCount === 1 ? 'Su sesión grabada se conserva' : `Sus ${deleteCount} sesiones grabadas se conservan`} en Sesiones, pero ya sin reporte. Esto no se puede deshacer.`
            : 'Esto no se puede deshacer.'
        }
        confirmLabel="Borrar estudio"
        destructive
        onConfirm={async () => {
          if (toDelete) await onDelete(toDelete);
        }}
      />
    </Layout>
  );
}
