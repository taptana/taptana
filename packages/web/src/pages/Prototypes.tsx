import { useEffect, useRef, useState } from 'react';
import { Upload, Trash2, RefreshCw, Copy, Check, ExternalLink, FileArchive, FolderOpen } from 'lucide-react';
import type { Prototype, ServerInfo } from '@taptana/shared';
import { getClient } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { Layout } from '@/components/layout';
import { cn, formatRelative } from '@/lib/utils';
import { participantUrl } from '@/lib/links';

export function PrototypesPage() {
  const [protos, setProtos] = useState<Prototype[] | null>(null);
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [canUpload, setCanUpload] = useState(true);
  const [mode, setMode] = useState<'http' | 'static'>('http');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = async (): Promise<void> => {
    try {
      const client = await getClient();
      setCanUpload(client.canUpload);
      setMode(client.mode);
      const [i, list] = await Promise.all([client.info(), client.listPrototypes()]);
      setInfo(i);
      setProtos(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const upload = async (file: File, id?: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const client = await getClient();
      await client.uploadPrototype(file, { ...(name.trim() && !id ? { name: name.trim() } : {}), ...(id ? { id } : {}) });
      setName('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: Prototype): Promise<void> => {
    const extra = p.sessionCount ? ` Se borran también sus ${p.sessionCount} sesiones y sus estudios.` : '';
    if (!confirm(`¿Borrar "${p.name}"?${extra} No se puede deshacer.`)) return;
    try {
      await (await getClient()).deletePrototype(p.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Layout>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Prototipos</h1>
        <p className="text-muted-foreground text-sm">
          {mode === 'static'
            ? 'Sube un .html o un .zip. En la demo se guarda solo en este navegador y no sale de él.'
            : 'Sube un .html o un .zip con tu prototipo. Se guarda en esta computadora y no sale de ella.'}
        </p>
      </header>

      {mode === 'static' && (
        <Card className="py-4 border-amber-500/40 bg-amber-500/5">
          <CardContent className="px-5 text-sm space-y-1">
            <p className="font-medium">Modo demo: todo vive en este navegador</p>
            <p className="text-muted-foreground">
              Puedes subir tu prototipo, armar estudios y probarlos tú mismo (o pasarle esta computadora a alguien). Las
              sesiones aparecen solas en Sesiones. El link no funciona en otro dispositivo: para probar con celulares, corre
              Taptana en tu computadora con <code className="text-foreground">pnpm start</code>.
            </p>
          </CardContent>
        </Card>
      )}

      {canUpload ? (
        <Card className="py-5 gap-4">
          <CardContent className="px-5 space-y-3">
            <div
              role="button"
              tabIndex={0}
              onClick={() => !busy && fileInput.current?.click()}
              onKeyDown={(e) => e.key === 'Enter' && fileInput.current?.click()}
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
                'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center cursor-pointer transition-colors',
                dragging ? 'border-primary bg-accent' : 'hover:bg-accent/50',
                busy && 'opacity-60 cursor-wait',
              )}
            >
              <Upload className="size-6 text-muted-foreground" />
              <p className="font-medium">{busy ? 'Subiendo…' : 'Arrastra aquí tu .html o .zip, o haz clic para elegirlo'}</p>
              <p className="text-muted-foreground text-xs">
                Un zip puede traer varias páginas, CSS, JS e imágenes. Si no hay index.html, se abre el primer HTML. Hasta 50 MB.
              </p>
            </div>
            <div className="max-w-sm">
              <Label htmlFor="proto-name">Nombre (opcional)</Label>
              <Input id="proto-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Si lo dejas vacío, se usa el nombre del archivo" />
            </div>
            <input
              ref={fileInput}
              type="file"
              accept=".html,.htm,.zip,text/html,application/zip"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
                e.target.value = '';
              }}
            />
          </CardContent>
        </Card>
      ) : (
        <Card className="py-4">
          <CardContent className="px-5 text-sm text-muted-foreground">
            En la demo no se suben archivos. Para probar tus propios prototipos, corre Taptana en tu computadora:{' '}
            <code className="text-foreground">pnpm start</code>. Todo queda en tu máquina.
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border-destructive/40 py-4">
          <CardContent className="text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {protos === null || !info ? (
        <p className="text-muted-foreground text-sm">Cargando…</p>
      ) : protos.length === 0 ? (
        <p className="text-muted-foreground text-sm">Todavía no hay prototipos.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {protos.map((p) => (
            <PrototypeCard key={p.id} proto={p} info={info} canUpload={canUpload} onReplace={(f) => void upload(f, p.id)} onDelete={() => void remove(p)} />
          ))}
        </div>
      )}
    </Layout>
  );
}

function PrototypeCard({
  proto,
  info,
  canUpload,
  onReplace,
  onDelete,
}: {
  proto: Prototype;
  info: ServerInfo;
  canUpload: boolean;
  onReplace: (f: File) => void;
  onDelete: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const link = participantUrl(info, proto);
  const uploaded = proto.source === 'upload' && proto.id !== 'demo-tienda';

  useEffect(() => {
    void getClient().then((c) => setQr(c.qrImageUrl(link)));
  }, [link]);

  return (
    <Card className="py-5 gap-3">
      <CardHeader className="px-5">
        <CardTitle className="text-base flex items-center gap-2">
          {uploaded ? <FileArchive className="size-4" /> : <FolderOpen className="size-4" />}
          {proto.name}
        </CardTitle>
        <CardDescription className="flex flex-wrap gap-1.5 items-center">
          <Badge variant="secondary">{uploaded ? 'subido' : 'carpeta local'}</Badge>
          {proto.entryPath && <span className="font-mono text-xs">{proto.entryPath}</span>}
          <span>· {proto.sessionCount ?? 0} sesiones</span>
          {proto.createdAt > 0 && <span>· {formatRelative(proto.createdAt)}</span>}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-5 space-y-3">
        {qr && (
          <div className="flex justify-center rounded-lg bg-white p-3">
            <img src={qr} alt={`QR de ${proto.name}`} width={160} height={160} />
          </div>
        )}
        <div className="flex gap-2">
          <Input readOnly value={link} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
          <Button
            variant="outline"
            size="icon"
            aria-label="Copiar link"
            onClick={() => {
              void navigator.clipboard.writeText(link).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? <Check /> : <Copy />}
          </Button>
          <Button variant="outline" size="icon" aria-label="Abrir" asChild>
            <a href={link} target="_blank" rel="noreferrer">
              <ExternalLink />
            </a>
          </Button>
        </div>
        {uploaded && canUpload && (
          <div className="flex justify-between gap-2">
            <Button variant="outline" size="sm" onClick={() => replaceInput.current?.click()}>
              <RefreshCw /> Subir nueva versión
            </Button>
            <Button variant="ghost" size="sm" onClick={onDelete}>
              <Trash2 /> Borrar
            </Button>
            <input
              ref={replaceInput}
              type="file"
              accept=".html,.htm,.zip,text/html,application/zip"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onReplace(f);
                e.target.value = '';
              }}
            />
          </div>
        )}
        {uploaded && <p className="text-muted-foreground text-xs">Subir una nueva versión mantiene el mismo link, sus estudios y sesiones.</p>}
      </CardContent>
    </Card>
  );
}
