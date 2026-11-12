import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, CircleAlert, CircleCheck, Copy, Ellipsis, ExternalLink, FileArchive, FlaskConical, FolderOpen, Globe, Info, Link2, LoaderCircle, Pencil, Plus, RefreshCw, Trash2, TriangleAlert, Upload } from 'lucide-react';
import { EXAMPLE_PROTOTYPE_ID, STUDY_LIMITS, normalizePrototypeUrl, type Prototype, type PrototypeUrlCheck, type PrototypeUrlIssue, type ScreenInfo, type ServerInfo } from '@taptana/shared';
import { getClient, IS_DEMO } from '@/api/client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ConfirmDialog, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Label } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import { EmptyState, ErrorState, InlineError, Layout, ListSkeleton, Notice, PageHeader, Section } from '@/components/layout';
import { copyText } from '@/lib/download';
import { friendlyError } from '@/lib/errors';
import { plural } from '@/lib/format';
import { participantUrl } from '@/lib/links';
import { nameScreen } from '@/lib/screens';
import { cn, formatRelative } from '@/lib/utils';
import { Link, useRouter } from '@/router';

const ACCEPT = '.html,.htm,.zip,text/html,application/zip';

export function PrototypesPage() {
  const [protos, setProtos] = useState<Prototype[] | null>(null);
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [canRoot, setCanRoot] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [dragging, setDragging] = useState(false);
  const [toDelete, setToDelete] = useState<Prototype | null>(null);
  const [toRename, setToRename] = useState<Prototype | null>(null);
  const [toMove, setToMove] = useState<Prototype | null>(null);
  const [mode, setMode] = useState<'file' | 'url'>('file');
  const [canUrl, setCanUrl] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const { navigate } = useRouter();

  const load = async (): Promise<void> => {
    try {
      const client = await getClient();
      setCanRoot(client.canServeAtRoot);
      setCanUrl(client.canAddByUrl);
      const [i, list, p] = await Promise.all([client.info(), client.listPrototypes(), client.uploadProblem()]);
      setInfo(i);
      setProtos(list);
      setProblem(p);
      setLoadError(null);
    } catch (e) {
      setLoadError(friendlyError(e, 'No pudimos leer tus prototipos.'));
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const upload = async (file: File, id?: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const client = await getClient();
      const proto = await client.uploadPrototype(file, { ...(name.trim() && !id ? { name: name.trim() } : {}), ...(id ? { id } : {}) });
      setName('');
      await load();
      if (id) toast.success(`«${proto.name}» se actualizó. El link es el mismo.`);
      else toast.success(`«${proto.name}» está listo.`, { action: { label: 'Crear estudio', onClick: () => navigate({ name: 'study', id: null }) }, durationMs: 8000 });
    } catch (e) {
      setError(
        friendlyError(
          e,
          IS_DEMO
            ? 'No se pudo guardar el prototipo en este navegador. Suele pasar cuando el navegador bloquea el almacenamiento (ventana privada, o un navegador abierto dentro de otra app); no es un problema de tu archivo. Abre esta página en Chrome o Safari, en una ventana normal, o corre Taptana en tu computadora con «pnpm start».'
            : 'No se pudo subir el archivo. Revisa que sea un .html o un .zip e intenta de nuevo.',
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: Prototype): Promise<void> => {
    try {
      await (await getClient()).deletePrototype(p.id);
      toast(`«${p.name}» se borró.`);
      await load();
    } catch (e) {
      setError(friendlyError(e, 'No se pudo borrar el prototipo.'));
    }
  };

  const setRoot = async (p: Prototype, root: boolean): Promise<void> => {
    try {
      await (await getClient()).setPrototypeRoot(p.id, root);
      await load();
      toast(root ? `«${p.name}» ahora se abre en la raíz. Su link cambió.` : `«${p.name}» volvió a su dirección normal.`);
    } catch (e) {
      toast.error(friendlyError(e, 'No se pudo cambiar.'));
    }
  };

  const hasOwn = (protos ?? []).some((p) => p.id !== EXAMPLE_PROTOTYPE_ID);

  return (
    <Layout>
      <PageHeader
        title="Prototipos"
        description={
          IS_DEMO
            ? 'Sube un .html o un .zip. En la demo se guarda solo en este navegador y no sale de él.'
            : 'Sube un .html o un .zip con tu prototipo, o agrega la dirección de un sitio publicado. Lo que grabes se guarda en esta computadora y no sale de ella.'
        }
      />

      {IS_DEMO && (
        <Notice tone="warning" icon={<Info />} title="Demo: el prototipo que subas vive en este navegador">
          <p>
            Puedes armar un estudio y hacerlo tú mismo para ver cómo funciona. El link no abre en otro dispositivo: para probar con celulares, corre Taptana en tu
            computadora con <code className="text-foreground">pnpm start</code>.
          </p>
        </Notice>
      )}

      <Section title="Agregar un prototipo">
        <Tabs value={mode} onValueChange={(v) => setMode(v === 'url' ? 'url' : 'file')} className="gap-6">
          <TabsList aria-label="Cómo agregar el prototipo" className="[&_svg]:size-4">
            <TabsTrigger value="file">
              <Upload /> Subir archivo
            </TabsTrigger>
            <TabsTrigger value="url">
              <Globe /> Agregar por URL
            </TabsTrigger>
          </TabsList>
          <TabsContent value="file">
            {problem ? (
              <Alert variant="destructive">
                <TriangleAlert />
                <AlertTitle>Aquí no se pueden subir prototipos</AlertTitle>
                <AlertDescription>
                  <p>{problem}</p>
                </AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-5">
                <div
                  role="button"
                  tabIndex={0}
                  aria-label="Subir un prototipo: elige un archivo .html o .zip"
                  aria-busy={busy}
                  onClick={() => !busy && fileInput.current?.click()}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ' ') && !busy) {
                      e.preventDefault();
                      fileInput.current?.click();
                    }
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    const f = e.dataTransfer.files[0];
                    if (f) void upload(f);
                  }}
                  className={cn(
                    'flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border bg-card px-6 py-12 sm:py-14 text-center cursor-pointer transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    dragging ? 'border-primary bg-accent' : 'hover:border-foreground/30',
                    busy && 'opacity-60 cursor-wait',
                  )}
                >
                  <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
                    <Upload className="size-5" />
                  </span>
                  <p className="font-medium">{busy ? 'Subiendo…' : 'Arrastra aquí tu .html o .zip, o haz clic para elegirlo'}</p>
                  <p className="text-muted-foreground text-sm leading-relaxed max-w-md">
                    Un zip puede traer varias páginas, estilos, scripts e imágenes. Se abre <code>index.html</code>; si no hay, el primer HTML. Hasta 50 MB.
                  </p>
                </div>
                <div className="max-w-sm space-y-2">
                  <Label htmlFor="proto-name">Nombre (opcional)</Label>
                  <Input id="proto-name" value={name} maxLength={STUDY_LIMITS.name} onChange={(e) => setName(e.target.value)} placeholder="Si lo dejas vacío, se usa el nombre del archivo" />
                </div>
                <input
                  ref={fileInput}
                  type="file"
                  accept={ACCEPT}
                  className="hidden"
                  aria-label="Archivo del prototipo"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void upload(f);
                    e.target.value = '';
                  }}
                />
              </div>
            )}
          </TabsContent>
          <TabsContent value="url">
            <UrlForm
              canAdd={canUrl}
              onAdded={async (proto) => {
                await load();
                toast.success(`«${proto.name}» está listo.`, { action: { label: 'Crear estudio', onClick: () => navigate({ name: 'study', id: null }) }, durationMs: 8000 });
              }}
            />
          </TabsContent>
        </Tabs>
      </Section>

      {error && <InlineError onDismiss={() => setError(null)}>{error}</InlineError>}

      {loadError && protos === null ? (
        <ErrorState message={loadError} onRetry={() => void load()} />
      ) : protos === null || !info ? (
        <ListSkeleton count={2} />
      ) : protos.length === 0 ? (
        <EmptyState art="prototypes" title="Todavía no hay prototipos">
          <p>Sube el tuyo arriba. Si quieres ver primero cómo se ve todo con datos, en Inicio hay un ejemplo listo.</p>
        </EmptyState>
      ) : (
        <Section title="Tus prototipos" description={!hasOwn && !problem ? 'Este es el prototipo de ejemplo. Cuando subas el tuyo aparecerá aquí.' : undefined}>
          <ul className="space-y-3" aria-label="Tus prototipos">
            {protos.map((p) => (
              <PrototypeRow
                key={p.id}
                proto={p}
                info={info}
                canRoot={canRoot}
                canReplace={!problem}
                busy={busy}
                onReplace={(f) => void upload(f, p.id)}
                onDelete={() => setToDelete(p)}
                onRename={() => setToRename(p)}
                onMove={() => setToMove(p)}
                onRoot={(root) => void setRoot(p, root)}
              />
            ))}
          </ul>
        </Section>
      )}

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`¿Borrar «${toDelete?.name ?? ''}»?`}
        description={
          <p>
            Se borran {toDelete?.source === 'url' ? 'su dirección' : 'sus archivos'}{toDelete?.sessionCount ? `, ${toDelete.sessionCount === 1 ? 'su sesión grabada' : `sus ${toDelete.sessionCount} sesiones grabadas`}` : ''} y los estudios
            que lo usan. No se puede deshacer.
          </p>
        }
        confirmLabel="Borrar prototipo"
        destructive
        onConfirm={async () => {
          if (toDelete) await remove(toDelete);
        }}
      />
      {toMove && (
        <ChangeUrlDialog
          proto={toMove}
          onClose={() => setToMove(null)}
          onDone={async (p) => {
            setToMove(null);
            await load();
            toast.success(`«${p.name}» ahora muestra ${p.sourceUrl ?? 'la nueva dirección'}. El link es el mismo.`);
          }}
        />
      )}
      {toRename && (
        <RenameDialog
          proto={toRename}
          onClose={() => setToRename(null)}
          onDone={async () => {
            setToRename(null);
            await load();
          }}
        />
      )}
    </Layout>
  );
}

function RenameDialog({ proto, onClose, onDone }: { proto: Prototype; onClose: () => void; onDone: () => Promise<void> }) {
  const [value, setValue] = useState(proto.name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (): Promise<void> => {
    if (!value.trim()) {
      setError('Ponle un nombre al prototipo.');
      return;
    }
    setBusy(true);
    try {
      await (await getClient()).renamePrototype(proto.id, value.trim());
      await onDone();
    } catch (e) {
      setError(friendlyError(e, 'No se pudo cambiar el nombre.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Cambiar el nombre</DialogTitle>
            <DialogDescription>Solo cambia cómo lo ves en el panel. El link sigue siendo el mismo.</DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="rename-proto">Nombre del prototipo</Label>
            <Input id="rename-proto" autoFocus value={value} maxLength={STUDY_LIMITS.name} aria-invalid={error !== null} aria-describedby={error ? 'rename-error' : undefined} onChange={(e) => setValue(e.target.value)} />
            {error && (
              <p id="rename-error" className="text-sm text-destructive mt-1.5">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy}>
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PrototypeRow({
  proto,
  info,
  canRoot,
  canReplace,
  busy,
  onReplace,
  onDelete,
  onRename,
  onMove,
  onRoot,
}: {
  proto: Prototype;
  info: ServerInfo;
  canRoot: boolean;
  canReplace: boolean;
  busy: boolean;
  onReplace: (f: File) => void;
  onDelete: () => void;
  onRename: () => void;
  onMove: () => void;
  onRoot: (root: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const replaceInput = useRef<HTMLInputElement>(null);
  const isExample = proto.id === EXAMPLE_PROTOTYPE_ID;
  const byUrl = proto.source === 'url';
  /** Subido o por URL: vive en /p/<id>/, se renombra, se borra y se puede abrir en la raíz. */
  const uploaded = proto.source === 'upload' || byUrl;
  // Sesiones importadas de un prototipo que no está aquí: no hay archivos ni link.
  const foreign = proto.source === undefined && !proto.url;
  const link = foreign ? '' : participantUrl(info, proto);
  const sessions = proto.sessionCount ?? 0;

  useEffect(() => {
    if (!link || !open) return;
    void getClient().then((c) => setQr(c.qrImageUrl(link)));
  }, [link, open]);

  const copy = async (): Promise<void> => {
    if (await copyText(link)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } else toast.error('No se pudo copiar. Selecciona el link y cópialo a mano.');
  };

  const canDelete = (uploaded || foreign) && !isExample;
  return (
    <li className="rounded-2xl border border-border/70 bg-card">
      <div className="flex min-h-16 flex-wrap items-center gap-x-4 gap-y-3 px-(--card-pad) py-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground" aria-hidden>
          {byUrl ? <Globe className="size-5" /> : uploaded ? <FileArchive className="size-5" /> : <FolderOpen className="size-5" />}
        </span>
        <div className="min-w-0 flex-1 basis-48">
          <h3 className="type-subsection break-words">{proto.name}</h3>
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
            <Badge variant="secondary">{isExample ? 'Ejemplo' : foreign ? 'Importado' : byUrl ? 'Por URL' : uploaded ? 'Subido' : 'Carpeta local'}</Badge>
            {proto.root && <Badge variant="outline">En la raíz</Badge>}
            <span>{plural(sessions, 'sesión', 'sesiones', 'Sin sesiones')}</span>
            {proto.createdAt > 0 && <span>· {byUrl ? 'agregado' : 'subido'} {formatRelative(proto.createdAt)}</span>}
          </p>
          {byUrl && proto.sourceUrl && <p className="mt-1 truncate font-mono text-xs text-muted-foreground" title={proto.sourceUrl}>{proto.sourceUrl}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!foreign && (
            <Button size="sm" asChild>
              <Link to={{ name: 'study', id: null }}>
                <FlaskConical /> Crear estudio
              </Link>
            </Button>
          )}
          <Button variant="ghost" size="sm" aria-expanded={open} aria-controls={`detalles-${proto.id}`} onClick={() => setOpen((o) => !o)}>
            Detalles <ChevronDown className={cn('transition-transform', open && 'rotate-180')} />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="size-8" aria-label={`Más acciones de «${proto.name}»`}>
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {!foreign && (
                <>
                  <DropdownMenuItem onSelect={() => void copy()}>
                    <Copy /> Copiar link
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a href={link} target="_blank" rel="noreferrer">
                      <ExternalLink /> Abrir
                    </a>
                  </DropdownMenuItem>
                </>
              )}
              {uploaded && !byUrl && canReplace && !isExample && (
                <DropdownMenuItem disabled={busy} onSelect={() => replaceInput.current?.click()} title="Mantiene el mismo link, sus estudios y sesiones">
                  <RefreshCw /> Subir nueva versión
                </DropdownMenuItem>
              )}
              {byUrl && (
                <DropdownMenuItem onSelect={onMove} title="Mantiene el mismo link, sus estudios y sesiones">
                  <Link2 /> Cambiar dirección
                </DropdownMenuItem>
              )}
              {uploaded && !isExample && (
                <DropdownMenuItem onSelect={onRename}>
                  <Pencil /> Cambiar nombre
                </DropdownMenuItem>
              )}
              {canDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive onSelect={onDelete}>
                    <Trash2 /> Borrar
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <input
            ref={replaceInput}
            type="file"
            accept={ACCEPT}
            className="hidden"
            aria-label={`Nueva versión de ${proto.name}`}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onReplace(f);
              e.target.value = '';
            }}
          />
        </div>
      </div>
      {open && (
      <div id={`detalles-${proto.id}`} className="space-y-6 border-t border-border/70 px-(--card-pad) py-6">
        {foreign ? (
          <p className="text-sm text-muted-foreground">
            Estas sesiones se importaron de otro lugar y su prototipo no está aquí. Puedes ver las grabaciones en Sesiones.
          </p>
        ) : (
          <>
            {byUrl && proto.sourceUrl && (
              <div className="space-y-1.5 rounded-xl bg-muted/50 p-4 text-sm">
                <p className="font-medium">Siempre muestra lo que está publicado ahora</p>
                <p className="text-muted-foreground leading-relaxed">
                  Taptana abre{' '}
                  <a href={proto.sourceUrl} target="_blank" rel="noreferrer" className="break-all text-foreground underline underline-offset-4">
                    {proto.sourceUrl}
                  </a>{' '}
                  cada vez que alguien entra y le agrega la grabación, sin tocar tu sitio. Si lo cambias, los participantes ven el cambio al momento. Tiene que estar encendido
                  durante la prueba.
                </p>
              </div>
            )}
            <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
            <div className="space-y-2">
              <Label htmlFor={`link-${proto.id}`}>Link del prototipo (sin estudio)</Label>
              <Input id={`link-${proto.id}`} readOnly value={link} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
              <div className="flex flex-wrap gap-2 pt-1">
                <Button variant="outline" size="sm" onClick={() => void copy()}>
                  {copied ? <Check /> : <Copy />} {copied ? 'Copiado' : 'Copiar link'}
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <a href={link} target="_blank" rel="noreferrer">
                    <ExternalLink /> Abrir
                  </a>
                </Button>
              </div>
              <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">Quien abra este link usa el prototipo libremente y queda grabado. Para pedir tareas y consentimiento, crea un estudio.</p>
            </div>
            {qr && (
              <div className="justify-self-center rounded-xl bg-white p-3">
                <img src={qr} alt={`Código QR para abrir ${proto.name} en un celular`} width={140} height={140} />
              </div>
            )}
            </div>

            {uploaded && canRoot && (
              <div className={cn('rounded-xl bg-muted/50 p-4 space-y-1.5', proto.absoluteUrls && !proto.root && 'bg-amber-500/10')}>
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor={`root-${proto.id}`} className="mb-0">
                    Abrir en la raíz
                  </Label>
                  <Switch id={`root-${proto.id}`} checked={proto.root === true} onCheckedChange={onRoot} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {proto.absoluteUrls && !proto.root
                    ? 'Puede hacer falta: este prototipo parece una app con rutas propias. Si al navegar vuelve siempre al inicio o sus páginas no cargan, actívalo; si se ve bien, déjalo como está.'
                    : 'Sirve el prototipo en la dirección principal en vez de una subcarpeta. Úsalo si se ve sin estilos o si es una app con rutas propias.'}
                </p>
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Solo un prototipo a la vez:</span>{' '}
                  {proto.root ? 'si activas otro, este deja de estar en la raíz (su link normal sigue funcionando).' : 'si activas este, se desactiva el que estaba.'}
                </p>
              </div>
            )}
            {uploaded && !byUrl && !canRoot && proto.absoluteUrls && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Este prototipo usa rutas que empiezan con «/». En la demo puede verse sin estilos; en tu computadora se arregla con «Abrir en la raíz».
              </p>
            )}

            <Screens prototypeId={proto.id} />
          </>
        )}
      </div>
      )}
    </li>
  );
}

/** Pantallas que Taptana conoce de un prototipo. Se cargan al desplegar. */
function Screens({ prototypeId }: { prototypeId: string }) {
  const [open, setOpen] = useState(false);
  const [screens, setScreens] = useState<ScreenInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || screens !== null) return;
    let cancelled = false;
    setError(null);
    getClient()
      .then((c) => c.listPrototypeScreens(prototypeId))
      .then((list) => !cancelled && setScreens(list))
      .catch((e) => !cancelled && setError(friendlyError(e, 'No se pudieron leer las pantallas.')));
    return () => {
      cancelled = true;
    };
  }, [open, screens, prototypeId]);

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`screens-${prototypeId}`}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-md py-1 text-sm font-medium cursor-pointer outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <span>Pantallas detectadas{screens ? ` (${screens.length})` : ''}</span>
        <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div id={`screens-${prototypeId}`} className="pt-2">
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : screens === null ? (
            <div className="space-y-1.5">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-5 w-1/2" />
            </div>
          ) : screens.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no conocemos ninguna pantalla. Aparecen al subir archivos HTML o cuando alguien recorre el prototipo.</p>
          ) : (
            <>
              <ul className="space-y-1 text-sm max-h-56 overflow-y-auto">
                {screens.map((s) => (
                  <li key={s.id} className="flex items-baseline gap-2 min-w-0">
                    <span className="truncate">{nameScreen(s.id, screens)}</span>
                    <span className="font-mono text-xs text-muted-foreground truncate">{s.id}</span>
                    {s.source === 'seen' && (
                      <Badge variant="outline" className="ml-auto text-muted-foreground" title="No es un archivo: alguien llegó a esta pantalla en una sesión">
                        vista en sesiones
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground pt-2">
                Son las pantallas que puedes elegir al armar una tarea. Las de apps de una sola página aparecen después de que alguien las recorre.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const LEVEL_TITLE: Record<PrototypeUrlCheck['level'], string> = {
  ok: 'Todo bien: se puede usar',
  warning: 'Se puede usar, pero revisa esto',
  error: 'Así no se puede usar',
};

function IssueIcon({ level }: { level: PrototypeUrlIssue['level'] | PrototypeUrlCheck['level'] }) {
  if (level === 'error') return <CircleAlert className="size-4 shrink-0 text-destructive" aria-hidden />;
  if (level === 'warning') return <TriangleAlert className="size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />;
  if (level === 'ok') return <CircleCheck className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />;
  return <Info className="size-4 shrink-0 text-muted-foreground" aria-hidden />;
}

/** Agregar por URL: escribir la dirección → «Revisar» → veredicto con nombre sugerido → «Agregar». */
function UrlForm({ canAdd, onAdded }: { canAdd: boolean; onAdded: (proto: Prototype) => Promise<void> }) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [check, setCheck] = useState<PrototypeUrlCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const review = async (value: string): Promise<void> => {
    const normalized = normalizePrototypeUrl(value);
    setCheck(null);
    if (!normalized.ok) {
      setError(normalized.error);
      return;
    }
    setError(null);
    setChecking(true);
    try {
      const result = await (await getClient()).checkPrototypeUrl(normalized.url);
      setCheck(result);
      setName(result.title ?? '');
    } catch (e) {
      setError(friendlyError(e, 'No pudimos revisar esa dirección. Intenta de nuevo.'));
    } finally {
      setChecking(false);
    }
  };

  const add = async (): Promise<void> => {
    if (!check || adding) return;
    setAdding(true);
    setError(null);
    try {
      const proto = await (await getClient()).addPrototypeUrl(check.url, name.trim() ? { name: name.trim() } : {});
      setUrl('');
      setName('');
      setCheck(null);
      await onAdded(proto);
    } catch (e) {
      setError(friendlyError(e, 'No se pudo agregar el prototipo.'));
    } finally {
      setAdding(false);
    }
  };

  if (!canAdd) {
    return (
      <Notice tone="neutral" icon={<Globe />} title="Agregar por URL necesita Taptana en tu computadora">
        <p>
          Es el servidor de Taptana el que abre tu sitio y le agrega la grabación, y en esta demo no hay servidor. Corre Taptana con{' '}
          <code className="text-foreground">pnpm start</code> y desde ahí podrás pegar la dirección de tu sitio de Lovable, v0, Bolt, Vercel o de tu servidor de desarrollo.
        </p>
      </Notice>
    );
  }

  return (
    <div className="space-y-5">
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void review(url);
        }}
      >
        <Label htmlFor="proto-url">Dirección de tu prototipo</Label>
        <div className="flex flex-wrap gap-3">
          <Input
            id="proto-url"
            type="text"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            className="min-w-0 flex-1 basis-72"
            value={url}
            placeholder="https://mi-app.vercel.app"
            aria-invalid={error !== null && check === null}
            aria-describedby="proto-url-help"
            onChange={(e) => {
              setUrl(e.target.value);
              setCheck(null);
              setError(null);
            }}
          />
          <Button type="submit" disabled={checking || !url.trim()}>
            {checking ? <LoaderCircle className="animate-spin" /> : null} {checking ? 'Revisando…' : 'Revisar'}
          </Button>
        </div>
        <p id="proto-url-help" className="max-w-prose text-sm leading-relaxed text-muted-foreground">
          Para sitios hechos con Lovable, v0, Bolt, Vercel, Netlify o Figma Sites, o tu servidor de desarrollo (por ejemplo <code>http://localhost:5173</code>). Taptana lo muestra a
          través de sí mismo y lo graba igual que un archivo subido, sin tocar tu sitio.
        </p>
      </form>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {check && (
        <div role="status" aria-live="polite" className="space-y-4 rounded-2xl border border-border/70 bg-card p-(--card-pad)">
          <div className="flex items-start gap-3">
            <span className="mt-0.5">
              <IssueIcon level={check.level} />
            </span>
            <div className="min-w-0">
              <p className="font-medium leading-snug">{LEVEL_TITLE[check.level]}</p>
              <p className="break-all font-mono text-xs text-muted-foreground">{check.url}</p>
            </div>
          </div>
          {check.issues.length > 0 && (
            <ul className="space-y-2 text-sm" aria-label="Lo que encontramos">
              {check.issues.map((issue) => (
                <li key={issue.code} className="flex items-start gap-2.5 leading-relaxed">
                  <span className="mt-1">
                    <IssueIcon level={issue.level} />
                  </span>
                  <span>{issue.message}</span>
                </li>
              ))}
            </ul>
          )}
          {check.suggestedUrl && (
            <Button
              variant="outline"
              size="sm"
              className="max-w-full"
              onClick={() => {
                const next = check.suggestedUrl ?? '';
                setUrl(next);
                void review(next);
              }}
            >
              <span className="truncate">Usar {check.suggestedUrl}</span>
            </Button>
          )}
          {check.level !== 'error' && (
            <form
              className="flex flex-wrap items-end gap-3 border-t border-border/70 pt-4"
              onSubmit={(e) => {
                e.preventDefault();
                void add();
              }}
            >
              <div className="min-w-0 flex-1 basis-60 space-y-2">
                <Label htmlFor="proto-url-name">Nombre</Label>
                <Input id="proto-url-name" value={name} maxLength={STUDY_LIMITS.name} onChange={(e) => setName(e.target.value)} placeholder={new URL(check.url).host} />
              </div>
              <Button type="submit" disabled={adding}>
                {adding ? <LoaderCircle className="animate-spin" /> : <Plus />} Agregar
              </Button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

function ChangeUrlDialog({ proto, onClose, onDone }: { proto: Prototype; onClose: () => void; onDone: (p: Prototype) => Promise<void> }) {
  const [value, setValue] = useState(proto.sourceUrl ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (): Promise<void> => {
    const normalized = normalizePrototypeUrl(value);
    if (!normalized.ok) {
      setError(normalized.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onDone(await (await getClient()).setPrototypeUrl(proto.id, normalized.url));
    } catch (e) {
      setError(friendlyError(e, 'No se pudo cambiar la dirección.'));
    } finally {
      setBusy(false);
    }
  };
  const sessions = proto.sessionCount ?? 0;
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-lg">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Cambiar la dirección</DialogTitle>
            <DialogDescription>El link para los participantes, los estudios y las sesiones siguen igual. Antes de guardar, revisamos que la nueva dirección funcione.</DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="move-proto">Nueva dirección</Label>
            <Input id="move-proto" autoFocus inputMode="url" spellCheck={false} value={value} aria-invalid={error !== null} aria-describedby={error ? 'move-error' : undefined} onChange={(e) => setValue(e.target.value)} />
            {error && (
              <p id="move-error" className="text-sm text-destructive mt-1.5">
                {error}
              </p>
            )}
          </div>
          {sessions > 0 && (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              Ya tiene {plural(sessions, 'sesión grabada', 'sesiones grabadas')}: si el sitio nuevo es distinto, los resultados nuevos no serán comparables con los anteriores.
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Revisando…' : 'Guardar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
