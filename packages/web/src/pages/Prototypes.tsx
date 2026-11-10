import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Copy, ExternalLink, FileArchive, FlaskConical, FolderOpen, Info, Pencil, RefreshCw, Trash2, TriangleAlert, Upload } from 'lucide-react';
import { EXAMPLE_PROTOTYPE_ID, STUDY_LIMITS, type Prototype, type ScreenInfo, type ServerInfo } from '@taptana/shared';
import { getClient, IS_DEMO } from '@/api/client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Label } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toast';
import { EmptyState, ErrorState, InlineError, Layout, ListSkeleton, PageHeader } from '@/components/layout';
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
  const fileInput = useRef<HTMLInputElement>(null);
  const { navigate } = useRouter();

  const load = async (): Promise<void> => {
    try {
      const client = await getClient();
      setCanRoot(client.canServeAtRoot);
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
            : 'Sube un .html o un .zip con tu prototipo. Se guarda en esta computadora y no sale de ella.'
        }
      />

      {IS_DEMO && (
        <Alert variant="warning">
          <Info />
          <AlertTitle>Demo: el prototipo que subas vive en este navegador</AlertTitle>
          <AlertDescription>
            <p>
              Puedes armar un estudio y hacerlo tú mismo para ver cómo funciona. El link no abre en otro dispositivo: para probar con celulares, corre Taptana en tu
              computadora con <code className="text-foreground">pnpm start</code>.
            </p>
          </AlertDescription>
        </Alert>
      )}

      {problem ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Aquí no se pueden subir prototipos</AlertTitle>
          <AlertDescription>
            <p>{problem}</p>
          </AlertDescription>
        </Alert>
      ) : (
        <Card className="py-5 gap-4">
          <CardContent className="px-5 space-y-4">
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
                'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center cursor-pointer transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                dragging ? 'border-primary bg-accent' : 'hover:bg-accent/50',
                busy && 'opacity-60 cursor-wait',
              )}
            >
              <Upload className="size-6 text-muted-foreground" />
              <p className="font-medium">{busy ? 'Subiendo…' : 'Arrastra aquí tu .html o .zip, o haz clic para elegirlo'}</p>
              <p className="text-muted-foreground text-xs max-w-md">
                Un zip puede traer varias páginas, estilos, scripts e imágenes. Se abre <code>index.html</code>; si no hay, el primer HTML. Hasta 50 MB.
              </p>
            </div>
            <div className="max-w-sm">
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
          </CardContent>
        </Card>
      )}

      {error && <InlineError onDismiss={() => setError(null)}>{error}</InlineError>}

      {loadError && protos === null ? (
        <ErrorState message={loadError} onRetry={() => void load()} />
      ) : protos === null || !info ? (
        <ListSkeleton variant="cards" count={2} />
      ) : protos.length === 0 ? (
        <EmptyState icon={<FileArchive className="size-6" />} title="Todavía no hay prototipos">
          <p>Sube el tuyo arriba. Si quieres ver primero cómo se ve todo con datos, en Inicio hay un ejemplo listo.</p>
        </EmptyState>
      ) : (
        <>
          {!hasOwn && !problem && <p className="text-sm text-muted-foreground">Este es el prototipo de ejemplo. Cuando subas el tuyo aparecerá aquí.</p>}
          <div className="grid gap-4 md:grid-cols-2 items-start">
            {protos.map((p) => (
              <PrototypeCard
                key={p.id}
                proto={p}
                info={info}
                canRoot={canRoot}
                canReplace={!problem}
                busy={busy}
                onReplace={(f) => void upload(f, p.id)}
                onDelete={() => setToDelete(p)}
                onRename={() => setToRename(p)}
                onRoot={(root) => void setRoot(p, root)}
              />
            ))}
          </div>
        </>
      )}

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`¿Borrar «${toDelete?.name ?? ''}»?`}
        description={
          <p>
            Se borran sus archivos{toDelete?.sessionCount ? `, ${toDelete.sessionCount === 1 ? 'su sesión grabada' : `sus ${toDelete.sessionCount} sesiones grabadas`}` : ''} y los estudios
            que lo usan. No se puede deshacer.
          </p>
        }
        confirmLabel="Borrar prototipo"
        destructive
        onConfirm={async () => {
          if (toDelete) await remove(toDelete);
        }}
      />
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

function PrototypeCard({
  proto,
  info,
  canRoot,
  canReplace,
  busy,
  onReplace,
  onDelete,
  onRename,
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
  onRoot: (root: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const isExample = proto.id === EXAMPLE_PROTOTYPE_ID;
  const uploaded = proto.source === 'upload';
  // Sesiones importadas de un prototipo que no está aquí: no hay archivos ni link.
  const foreign = proto.source === undefined && !proto.url;
  const link = foreign ? '' : participantUrl(info, proto);
  const sessions = proto.sessionCount ?? 0;

  useEffect(() => {
    if (!link) return;
    void getClient().then((c) => setQr(c.qrImageUrl(link)));
  }, [link]);

  const copy = async (): Promise<void> => {
    if (await copyText(link)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } else toast.error('No se pudo copiar. Selecciona el link y cópialo a mano.');
  };

  return (
    <Card className="py-5 gap-4">
      <CardHeader className="px-5">
        <CardTitle className="text-base flex items-start gap-2">
          {uploaded ? <FileArchive className="size-4 mt-0.5 shrink-0" aria-hidden /> : <FolderOpen className="size-4 mt-0.5 shrink-0" aria-hidden />}
          <span className="min-w-0 break-words leading-snug">{proto.name}</span>
        </CardTitle>
        <CardDescription className="flex flex-wrap gap-x-1.5 gap-y-1 items-center">
          <Badge variant="secondary">{isExample ? 'Ejemplo' : foreign ? 'Importado' : uploaded ? 'Subido' : 'Carpeta local'}</Badge>
          {proto.root && <Badge variant="outline">En la raíz</Badge>}
          <span>{plural(sessions, 'sesión', 'sesiones', 'Sin sesiones')}</span>
          {proto.createdAt > 0 && <span>· subido {formatRelative(proto.createdAt)}</span>}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-5 space-y-4">
        {foreign ? (
          <p className="text-sm text-muted-foreground">
            Estas sesiones se importaron de otro lugar y su prototipo no está aquí. Puedes ver las grabaciones en Sesiones.
          </p>
        ) : (
          <>
            {qr && (
              <div className="flex justify-center rounded-lg bg-white p-3">
                <img src={qr} alt={`Código QR para abrir ${proto.name} en un celular`} width={160} height={160} />
              </div>
            )}
            <div className="space-y-1.5">
              {/* Sin mb-0: en Tailwind v4 `space-y` separa con margen inferior, y mb-0 dejaba la etiqueta pegada al campo. */}
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
                <Button size="sm" asChild>
                  <Link to={{ name: 'study', id: null }}>
                    <FlaskConical /> Crear estudio
                  </Link>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Quien abra este link usa el prototipo libremente y queda grabado. Para pedir tareas y consentimiento, crea un estudio.</p>
            </div>

            {uploaded && canRoot && (
              <div className={cn('rounded-lg border p-3 space-y-1.5', proto.absoluteUrls && !proto.root && 'border-amber-500/50 bg-amber-500/5')}>
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
            {uploaded && !canRoot && proto.absoluteUrls && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Este prototipo usa rutas que empiezan con «/». En la demo puede verse sin estilos; en tu computadora se arregla con «Abrir en la raíz».
              </p>
            )}

            <Screens prototypeId={proto.id} />
          </>
        )}

        {(uploaded || foreign) && !isExample && (
          <div className="flex flex-wrap gap-2 border-t pt-4">
            {uploaded && canReplace && (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => replaceInput.current?.click()} title="Mantiene el mismo link, sus estudios y sesiones">
                <RefreshCw /> Subir nueva versión
              </Button>
            )}
            {uploaded && (
              <Button variant="outline" size="sm" onClick={onRename}>
                <Pencil /> Cambiar nombre
              </Button>
            )}
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive ml-auto" onClick={onDelete}>
              <Trash2 /> Borrar
            </Button>
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
        )}
      </CardContent>
    </Card>
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
