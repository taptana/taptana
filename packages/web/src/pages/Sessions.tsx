import { useEffect, useRef, useState } from 'react';
import { Smartphone, Monitor, Upload, Trash2, RefreshCw } from 'lucide-react';
import type { SessionSummary } from '@taptana/shared';
import { getClient, parseSessionFile } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDate, formatDuration, formatRelative } from '@/lib/utils';
import { Link, useRouter } from '@/router';
import { Layout } from '@/components/layout';

export function SessionsPage() {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'http' | 'static'>('http');
  const fileInput = useRef<HTMLInputElement>(null);
  const { navigate } = useRouter();

  const load = async (): Promise<void> => {
    try {
      const client = await getClient();
      setMode(client.mode);
      setSessions(await client.listSessions());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const onImport = async (file: File): Promise<void> => {
    try {
      const data = parseSessionFile(await file.text());
      const client = await getClient();
      await client.importSession(data);
      await load();
      navigate({ name: 'player', id: data.session.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onDelete = async (s: SessionSummary): Promise<void> => {
    if (!confirm(`¿Borrar la sesión de ${formatDate(s.startedAt)}? No se puede deshacer.`)) return;
    const client = await getClient();
    await client.deleteSession(s.id);
    await load();
  };

  return (
    <Layout>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sesiones</h1>
          <p className="text-muted-foreground text-sm">
            {mode === 'static'
              ? 'Modo demo: sesiones de ejemplo y las que importes en este navegador.'
              : 'Cada visita de un participante al prototipo.'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw /> Actualizar
          </Button>
          <Button size="sm" onClick={() => fileInput.current?.click()}>
            <Upload /> Importar sesión
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImport(f);
              e.target.value = '';
            }}
          />
        </div>
      </header>

      {error && (
        <Card className="border-destructive/40 py-4">
          <CardContent className="text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      <Card className="py-0 gap-0 overflow-hidden">
        {sessions === null ? (
          <CardContent className="py-10 text-center text-muted-foreground text-sm">Cargando…</CardContent>
        ) : sessions.length === 0 ? (
          <CardHeader className="py-10 text-center">
            <CardTitle>Todavía no hay sesiones</CardTitle>
            <CardDescription>
              {mode === 'static'
                ? 'Importa un archivo .json exportado desde el prototipo en modo local.'
                : 'Escanea el QR de la terminal con un celular y usa el prototipo. La sesión aparece aquí sola.'}
            </CardDescription>
          </CardHeader>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Dispositivo</TableHead>
                <TableHead>Pantalla</TableHead>
                <TableHead className="text-right">Duración</TableHead>
                <TableHead className="text-right">Páginas</TableHead>
                <TableHead className="text-right">Toques</TableHead>
                <TableHead>Entró por</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((s) => (
                <TableRow key={s.id} className="cursor-pointer" onClick={() => navigate({ name: 'player', id: s.id })}>
                  <TableCell>
                    <Link to={{ name: 'player', id: s.id }} className="font-medium hover:underline">
                      {formatDate(s.startedAt)}
                    </Link>
                    <div className="text-muted-foreground text-xs">{formatRelative(s.startedAt)}</div>
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5">
                      {s.touch ? <Smartphone className="size-4 text-muted-foreground" /> : <Monitor className="size-4 text-muted-foreground" />}
                      {s.deviceLabel}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {s.viewport.width}×{s.viewport.height}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatDuration(s.durationMs)}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.pageCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.tapCount}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="font-mono font-normal">
                      {s.entryPath || '/'}
                    </Badge>
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Button variant="ghost" size="icon" aria-label="Borrar sesión" onClick={() => void onDelete(s)}>
                      <Trash2 className="text-muted-foreground" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </Layout>
  );
}
