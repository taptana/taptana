import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Ellipsis, EllipsisVertical, EyeOff, Eye, Monitor, Pencil, Play, PlayCircle, RefreshCw, Smartphone, Trash2, Upload, X } from 'lucide-react';
import { needsReview, SESSION_LIMITS, studyBlocks, type SessionExport, type SessionSummary, type StudyRecord } from '@taptana/shared';
import { getClient, IS_DEMO, parseSessionFile } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import { EmptyState, ErrorState, InlineError, Layout, ListSkeleton, PageHeader } from '@/components/layout';
import { friendlyError, SessionExistsError } from '@/lib/errors';
import { plural } from '@/lib/format';
import { sessionName, taskTally } from '@/lib/sessions';
import { cn, formatDate, formatDuration, formatRelative } from '@/lib/utils';
import { Link, useRouter } from '@/router';

type Filter = '' | 'free' | 'excluded' | `study:${string}`;

/** "2 de 3 tareas logradas · 1 por revisar" */
function tasksSummary(session: SessionSummary, study: StudyRecord | undefined): string {
  const tally = taskTally(session.tasks);
  if (!tally) return '';
  const blocks = study ? new Map(studyBlocks(study).map((b) => [b.id, b])) : new Map();
  const review = (session.tasks ?? []).filter((r) => needsReview(blocks.get(r.taskId), r)).length;
  const base = `${tally.done} de ${plural(tally.total, 'tarea lograda', 'tareas logradas')}`;
  return review > 0 ? `${base} · ${review} por revisar` : base;
}

export function SessionsPage({ study: initialStudy }: { study?: string }) {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [studies, setStudies] = useState<Map<string, StudyRecord>>(new Map());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>(initialStudy ? `study:${initialStudy}` : '');
  const [toDelete, setToDelete] = useState<SessionSummary | null>(null);
  const [toReplace, setToReplace] = useState<SessionExport | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const { navigate } = useRouter();

  const load = async (): Promise<void> => {
    setRefreshing(true);
    try {
      const client = await getClient();
      const [list, studyList] = await Promise.all([client.listSessions(), client.listStudies()]);
      setSessions(list);
      setStudies(new Map(studyList.map((s) => [s.id, s])));
      setLoadError(null);
    } catch (e) {
      setLoadError(friendlyError(e, 'No pudimos leer las sesiones.'));
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const replaceOne = (next: SessionSummary): void => setSessions((list) => (list ?? []).map((s) => (s.id === next.id ? next : s)));

  const doImport = async (data: SessionExport, replace: boolean): Promise<void> => {
    try {
      const client = await getClient();
      const { id } = await client.importSession(data, { replace });
      toast.success(replace ? 'Sesión reemplazada.' : 'Sesión importada.');
      navigate({ name: 'player', id });
    } catch (e) {
      if (e instanceof SessionExistsError) setToReplace(data);
      else setError(friendlyError(e, 'No se pudo importar la sesión.'));
    }
  };

  const onImport = async (file: File): Promise<void> => {
    setError(null);
    try {
      await doImport(parseSessionFile(await file.text()), false);
    } catch (e) {
      setError(friendlyError(e, 'No se pudo leer el archivo.'));
    }
  };

  const onDelete = async (s: SessionSummary): Promise<void> => {
    try {
      await (await getClient()).deleteSession(s.id);
      setSessions((list) => (list ?? []).filter((x) => x.id !== s.id));
      toast('Sesión borrada.');
    } catch (e) {
      setError(friendlyError(e, 'No se pudo borrar la sesión.'));
    }
  };

  const onLabel = async (s: SessionSummary, label: string): Promise<void> => {
    try {
      replaceOne(await (await getClient()).patchSession(s.id, { label }));
    } catch (e) {
      toast.error(friendlyError(e, 'No se pudo guardar la etiqueta.'));
    }
  };

  const onExclude = async (s: SessionSummary, excluded: boolean): Promise<void> => {
    try {
      replaceOne(await (await getClient()).patchSession(s.id, { excluded }));
      toast(excluded ? 'La sesión ya no cuenta en el reporte.' : 'La sesión vuelve a contar en el reporte.');
    } catch (e) {
      toast.error(friendlyError(e, 'No se pudo cambiar la sesión.'));
    }
  };

  const all = sessions ?? [];
  const studyIds = useMemo(() => Array.from(new Set(all.map((s) => s.studyId).filter((id): id is string => !!id))), [sessions]);
  const excludedCount = all.filter((s) => s.excluded).length;
  const freeCount = all.filter((s) => !s.studyId).length;
  const visible = all.filter((s) => {
    if (filter === '') return true;
    if (filter === 'free') return !s.studyId;
    if (filter === 'excluded') return s.excluded === true;
    return s.studyId === filter.slice('study:'.length);
  });
  const showChips = studyIds.length > 0 || excludedCount > 0;

  const rowProps = (s: SessionSummary): RowProps => ({
    session: s,
    study: s.studyId ? studies.get(s.studyId) : undefined,
    onLabel: (label) => onLabel(s, label),
    onExclude: () => void onExclude(s, !s.excluded),
    onDelete: () => setToDelete(s),
  });

  return (
    <Layout>
      <PageHeader
        title="Sesiones"
        description={IS_DEMO ? 'Las sesiones de ejemplo y las que grabes o importes en este navegador.' : 'Cada vez que una persona usa tu prototipo queda una sesión grabada.'}
        actions={
          <>
            <Button variant="outline" size="sm" disabled={refreshing} onClick={() => void load()}>
              <RefreshCw className={cn(refreshing && 'animate-spin')} /> Actualizar
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="size-8" aria-label="Más acciones">
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => fileInput.current?.click()}>
                  <Upload /> Importar sesión
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              className="hidden"
              aria-label="Archivo de sesión (.json)"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onImport(f);
                e.target.value = '';
              }}
            />
          </>
        }
      />

      {error && <InlineError onDismiss={() => setError(null)}>{error}</InlineError>}

      {showChips && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar sesiones">
          <FilterChip active={filter === ''} onClick={() => setFilter('')}>
            Todas ({all.length})
          </FilterChip>
          {studyIds.map((id) => (
            <FilterChip key={id} active={filter === `study:${id}`} onClick={() => setFilter(`study:${id}`)}>
              {studies.get(id)?.name ?? 'Estudio borrado'} ({all.filter((s) => s.studyId === id).length})
            </FilterChip>
          ))}
          {freeCount > 0 && studyIds.length > 0 && (
            <FilterChip active={filter === 'free'} onClick={() => setFilter('free')}>
              Sin estudio ({freeCount})
            </FilterChip>
          )}
          {excludedCount > 0 && (
            <FilterChip active={filter === 'excluded'} onClick={() => setFilter('excluded')}>
              Excluidas ({excludedCount})
            </FilterChip>
          )}
        </div>
      )}

      {loadError && sessions === null ? (
        <ErrorState message={loadError} onRetry={() => void load()} />
      ) : sessions === null ? (
        <ListSkeleton count={5} />
      ) : all.length === 0 ? (
        <EmptyState
          icon={<PlayCircle className="size-6" />}
          title="Todavía no hay sesiones"
          action={
            <>
              <Button asChild>
                <Link to={{ name: 'studies' }}>Ir a mis estudios</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link to={{ name: 'home' }}>Ver los 4 pasos</Link>
              </Button>
            </>
          }
        >
          <p>
            Una sesión aparece aquí sola cuando alguien abre el link de un estudio{IS_DEMO ? ' en este navegador' : ' en su celular'}, acepta que se grabe y usa el
            prototipo. No hay que hacer nada más.
          </p>
          <p>El link y el código QR están en cada estudio, en «Compartir». También puedes importar una sesión exportada (.json).</p>
        </EmptyState>
      ) : visible.length === 0 ? (
        <EmptyState icon={<PlayCircle className="size-6" />} title="Ninguna sesión con este filtro" action={<Button variant="outline" onClick={() => setFilter('')}>Ver todas</Button>} />
      ) : (
        <>
          {/* Celular: tarjetas */}
          <ul className="space-y-3 md:hidden">
            {visible.map((s) => (
              <li key={s.id}>
                <SessionCard {...rowProps(s)} />
              </li>
            ))}
          </ul>
          {/* Pantallas grandes: tabla */}
          <Card className="py-0 gap-0 overflow-hidden hidden md:block">
            <Table className="[&_td]:py-4 [&_th]:h-12">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Sesión</TableHead>
                  <TableHead>Estudio</TableHead>
                  <TableHead>Dispositivo</TableHead>
                  <TableHead className="text-right">Duración</TableHead>
                  <TableHead className="w-24 pr-4">
                    <span className="sr-only">Acciones</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((s) => (
                  <SessionRow key={s.id} {...rowProps(s)} />
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="¿Borrar esta sesión?"
        description={
          toDelete && (
            <p>
              Se borra la grabación de {sessionName(toDelete) ? `«${sessionName(toDelete)}», ` : ''}
              {formatDate(toDelete.startedAt)} y deja de contar en el reporte. No se puede deshacer. Si solo quieres que no cuente, usa «Excluir del reporte».
            </p>
          )
        }
        confirmLabel="Borrar sesión"
        destructive
        onConfirm={async () => {
          if (toDelete) await onDelete(toDelete);
        }}
      />
      <ConfirmDialog
        open={toReplace !== null}
        onOpenChange={(o) => !o && setToReplace(null)}
        title="Esta sesión ya está aquí"
        description="El archivo trae una sesión que ya tienes. Puedes reemplazarla con la del archivo o dejar la que está."
        confirmLabel="Reemplazar"
        cancelLabel="Dejar la que está"
        onConfirm={async () => {
          if (toReplace) await doImport(toReplace, true);
        }}
      />
    </Layout>
  );
}

interface RowProps {
  session: SessionSummary;
  study: StudyRecord | undefined;
  onLabel: (label: string) => Promise<void>;
  onExclude: () => void;
  onDelete: () => void;
}

function Device({ session }: { session: SessionSummary }) {
  const Icon = session.touch ? Smartphone : Monitor;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className="size-4 text-muted-foreground shrink-0" aria-hidden />
      <span className="sr-only">{session.touch ? 'Celular o tableta: ' : 'Computadora: '}</span>
      {session.deviceLabel}
    </span>
  );
}

function StudyCell({ session, study }: { session: SessionSummary; study: StudyRecord | undefined }) {
  if (!session.studyId) return <span className="text-muted-foreground">Sin estudio (uso libre)</span>;
  const summary = tasksSummary(session, study);
  return (
    <>
      <div className="truncate max-w-64">{study?.name ?? 'Estudio borrado'}</div>
      <div className="text-xs text-muted-foreground">
        {[summary, session.variantId ? `variante ${session.variantId}` : ''].filter(Boolean).join(' · ') || 'Sin tareas'}
      </div>
    </>
  );
}

function RowMenu({ session, onExclude, onDelete }: Pick<RowProps, 'session' | 'onExclude' | 'onDelete'>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Más acciones de la sesión">
          <EllipsisVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onExclude}>
          {session.excluded ? <Eye /> : <EyeOff />}
          {session.excluded ? 'Volver a contar en el reporte' : 'Excluir del reporte'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={onDelete}>
          <Trash2 /> Borrar sesión
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SessionRow({ session: s, study, onLabel, onExclude, onDelete }: RowProps) {
  return (
    <TableRow className={cn(s.excluded && 'bg-muted/40')}>
      <TableCell className="pl-4 whitespace-normal">
        <LabelEditor session={s} onSave={onLabel} />
        <div className="text-muted-foreground text-xs mt-0.5">
          <Link to={{ name: 'player', id: s.id }} className="hover:underline">
            {formatDate(s.startedAt)}
          </Link>{' '}
          · {formatRelative(s.startedAt)}
          {s.label && s.participant ? ` · alias: ${s.participant}` : ''}
        </div>
      </TableCell>
      <TableCell className="whitespace-normal">
        <StudyCell session={s} study={study} />
        {s.excluded && (
          <Badge variant="outline" className="mt-1 text-muted-foreground">
            Excluida del reporte
          </Badge>
        )}
      </TableCell>
      <TableCell>
        <Device session={s} />
        <div className="text-muted-foreground text-xs">
          {s.viewport.width}×{s.viewport.height}
        </div>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {formatDuration(s.durationMs)}
        <div className="text-muted-foreground text-xs">{plural(s.tapCount, 'toque', 'toques')}</div>
      </TableCell>
      <TableCell className="pr-4">
        <div className="flex items-center justify-end gap-1">
          <Button variant="outline" size="sm" asChild>
            <Link to={{ name: 'player', id: s.id }}>
              <Play /> Ver
            </Link>
          </Button>
          <RowMenu session={s} onExclude={onExclude} onDelete={onDelete} />
        </div>
      </TableCell>
    </TableRow>
  );
}

function SessionCard({ session: s, study, onLabel, onExclude, onDelete }: RowProps) {
  return (
    <Card className={cn('py-4 gap-3 px-4', s.excluded && 'bg-muted/40')}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <LabelEditor session={s} onSave={onLabel} />
          <div className="text-muted-foreground text-xs mt-0.5">
            {formatDate(s.startedAt)} · {formatRelative(s.startedAt)}
          </div>
        </div>
        <RowMenu session={s} onExclude={onExclude} onDelete={onDelete} />
      </div>
      <div className="text-sm">
        <StudyCell session={s} study={study} />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <Device session={s} />
        <span className="tabular-nums">{formatDuration(s.durationMs)}</span>
        <span>{plural(s.tapCount, 'toque', 'toques')}</span>
        {s.excluded && <Badge variant="outline">Excluida del reporte</Badge>}
      </div>
      <Button variant="outline" size="sm" asChild className="w-full">
        <Link to={{ name: 'player', id: s.id }}>
          <Play /> Ver grabación
        </Link>
      </Button>
    </Card>
  );
}

/** Etiqueta del moderador, editable en el sitio ("P3 · Ana"). */
export function LabelEditor({ session, onSave, size = 'sm' }: { session: Pick<SessionSummary, 'label' | 'participant'>; onSave: (label: string) => Promise<void>; size?: 'sm' | 'lg' }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(session.label ?? '');
  const open = useRef(false);
  const shown = sessionName(session);

  const start = (): void => {
    setValue(session.label ?? '');
    open.current = true;
    setEditing(true);
  };
  const cancel = (): void => {
    open.current = false;
    setEditing(false);
  };
  // Enviar el formulario y perder el foco llegan casi juntos: se guarda una sola vez.
  const save = async (): Promise<void> => {
    if (!open.current) return;
    open.current = false;
    setEditing(false);
    const next = value.trim();
    if (next !== (session.label ?? '')) await onSave(next);
  };

  if (editing) {
    return (
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Input
          autoFocus
          value={value}
          maxLength={SESSION_LIMITS.label}
          aria-label="Etiqueta de la sesión"
          placeholder="Por ejemplo: P3 · Ana"
          className={cn('h-8 max-w-64', size === 'lg' && 'h-10 text-lg md:text-lg font-semibold')}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && cancel()}
          onBlur={() => void save()}
        />
        <Button type="submit" variant="ghost" size="icon" className="size-8" aria-label="Guardar etiqueta" onMouseDown={(e) => e.preventDefault()}>
          <Check />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="size-8" aria-label="Cancelar" onMouseDown={(e) => e.preventDefault()} onClick={cancel}>
          <X />
        </Button>
      </form>
    );
  }
  return (
    <button
      type="button"
      onClick={start}
      title="Cambiar la etiqueta"
      className={cn(
        'group inline-flex max-w-full items-center gap-1.5 rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 cursor-pointer',
        size === 'lg' ? 'text-xl sm:text-2xl font-semibold tracking-tight' : 'font-medium',
      )}
    >
      <span className={cn('truncate', !shown && 'text-muted-foreground font-normal')}>{shown ?? 'Sin etiqueta'}</span>
      <Pencil className={cn('shrink-0 text-muted-foreground opacity-60 group-hover:opacity-100', size === 'lg' ? 'size-4' : 'size-3.5')} aria-hidden />
      <span className="sr-only">Cambiar la etiqueta</span>
    </button>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-xs font-medium transition-colors cursor-pointer outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 max-w-full truncate',
        active ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
