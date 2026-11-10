/**
 * Lista de estudios: una tarjeta por estudio con su estado, participantes y puntaje, y las
 * acciones para ver resultados, editar, duplicar, exportar y borrar. Desde aquí también se crea
 * uno nuevo o se importa un study.json (archivo o JSON pegado).
 */
import { useEffect, useState } from 'react';
import { BarChart3, ChevronDown, Copy, Download, FlaskConical, PencilRuler, Plus, Trash2, TriangleAlert, Upload } from 'lucide-react';
import { isQuestionBlock, isTaskBlock, studyBlocks, type Prototype, type SessionSummary, type Study, type StudyRecord, type StudyReport } from '@taptana/shared';
import { getClient } from '@/api/client';
import { ImportDialog } from '@/components/builder/dialogs';
import { studyFileName, toDraft } from '@/components/builder/draft';
import { EmptyState, ErrorState, Layout, ListSkeleton, PageHeader } from '@/components/layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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

function scoreTone(score: number): string {
  if (score >= 70) return 'text-emerald-700 dark:text-emerald-400';
  if (score >= 40) return 'text-amber-700 dark:text-amber-400';
  return 'text-red-700 dark:text-red-400';
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
      <Button variant="outline" onClick={() => setImportOpen(true)}>
        <Upload /> Importar study.json
      </Button>
      <Button asChild>
        <Link to={{ name: 'study', id: null }}>
          <Plus /> Nuevo estudio
        </Link>
      </Button>
    </>
  );
  const deleteCount = toDelete ? sessions.filter((s) => s.studyId === toDelete.id).length : 0;

  return (
    <Layout>
      <PageHeader title="Estudios" description="Un estudio es una lista de tareas y preguntas sobre tu prototipo. Lo compartes con un link y ves cómo le fue a cada participante." actions={actions} />

      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : studies === null ? (
        <ListSkeleton variant="cards" />
      ) : studies.length === 0 ? (
        <EmptyState
          icon={<FlaskConical className="size-6" />}
          title="Crea tu primer estudio"
          action={
            <>
              <Button asChild>
                <Link to={{ name: 'study', id: null }}>
                  <Plus /> Nuevo estudio
                </Link>
              </Button>
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                <Upload /> Importar study.json
              </Button>
            </>
          }
        >
          <p>Agrega tareas y preguntas bloque por bloque, o pídele a una IA que las arme: en el constructor está el botón "Armar con IA".</p>
          {protos.length === 0 && <p>Antes necesitas un prototipo: súbelo en la sección Prototipos.</p>}
        </EmptyState>
      ) : (
        <ul className="grid gap-5 sm:grid-cols-2" aria-label="Estudios">
          {studies.map((s) => {
            const proto = protos.find((p) => p.id === s.prototypeId);
            const report = reports[s.id] ?? null;
            const participants = report?.participants ?? sessions.filter((x) => x.studyId === s.id).length;
            const score = report?.score ?? null;
            return (
              <li key={s.id} className="min-w-0">
                <Card className="h-full gap-5 py-6 transition-shadow hover:shadow-md">
                  <CardHeader>
                    <div className="flex flex-wrap items-center gap-2">
                      {s.closed ? (
                        <Badge variant="secondary">Cerrado</Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1.5">
                          <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden /> Recibe respuestas
                        </Badge>
                      )}
                      {s.variants?.length ? <Badge variant="outline">A/B</Badge> : null}
                    </div>
                    <CardTitle className="mt-1 text-lg leading-snug break-words">{s.name}</CardTitle>
                    <CardDescription className="line-clamp-2">{s.description || contents(s)}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col gap-5">
                    <p className="text-sm text-muted-foreground">
                      {s.description ? `${contents(s)} · ` : ''}
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
                    <dl className="grid grid-cols-2 gap-3">
                      <div className="rounded-lg bg-muted/60 p-3">
                        <dd className="text-2xl font-semibold tabular-nums">{participants}</dd>
                        <dt className="text-xs text-muted-foreground">{participants === 1 ? 'participante' : 'participantes'}</dt>
                      </div>
                      <div className="rounded-lg bg-muted/60 p-3">
                        <dd className={`text-2xl font-semibold tabular-nums ${score === null ? '' : scoreTone(score)}`}>
                          {score === null ? '—' : score}
                          {score !== null && <span className="text-sm font-normal text-muted-foreground"> / 100</span>}
                        </dd>
                        <dt className="text-xs text-muted-foreground">{score === null ? (participants > 0 ? 'puntaje: faltan resultados' : 'puntaje de usabilidad') : 'puntaje de usabilidad'}</dt>
                      </div>
                    </dl>
                    <div className="mt-auto flex flex-wrap items-center gap-2">
                      <Button className="min-w-36 flex-1" asChild>
                        <Link to={{ name: 'report', id: s.id }}>
                          <BarChart3 /> Ver resultados
                        </Link>
                      </Button>
                      <Button variant="outline" asChild>
                        <Link to={{ name: 'study', id: s.id }}>
                          <PencilRuler /> Diseño
                        </Link>
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" disabled={busyId === s.id} aria-label={`Más acciones de "${s.name}"`}>
                            Más <ChevronDown />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
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
                    <p className="text-xs text-muted-foreground">Actualizado {formatRelative(s.updatedAt)}</p>
                  </CardContent>
                </Card>
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
