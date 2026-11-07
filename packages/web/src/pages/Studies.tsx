import { useEffect, useRef, useState } from 'react';
import { Plus, Upload, Trash2, Download, Pencil, Link2 } from 'lucide-react';
import { validateStudy, type StudyRecord } from '@taptana/shared';
import { getClient } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Layout } from '@/components/layout';
import { formatRelative } from '@/lib/utils';
import { Link, useRouter } from '@/router';

export function downloadStudy(study: StudyRecord): void {
  const { id, createdAt, updatedAt, ...clean } = study;
  void id;
  void createdAt;
  void updatedAt;
  const blob = new Blob([JSON.stringify(clean, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `taptana-study-${study.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function StudiesPage() {
  const [studies, setStudies] = useState<StudyRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const { navigate } = useRouter();

  const load = async (): Promise<void> => {
    try {
      const client = await getClient();
      setStudies(await client.listStudies());
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
      const parsed: unknown = JSON.parse(await file.text());
      const result = validateStudy(parsed);
      if (!result.ok) throw new Error(`El archivo no es un estudio válido: ${result.error}`);
      const client = await getClient();
      const saved = await client.saveStudy(result.value);
      navigate({ name: 'study', id: saved.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onDelete = async (s: StudyRecord): Promise<void> => {
    if (!confirm(`¿Borrar el estudio "${s.name}"? Las sesiones grabadas se conservan.`)) return;
    const client = await getClient();
    await client.deleteStudy(s.id);
    await load();
  };

  return (
    <Layout>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Estudios</h1>
          <p className="text-muted-foreground text-sm">Tareas que el participante hace sobre el prototipo, con su criterio de éxito.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
            <Upload /> Importar study.json
          </Button>
          <Button size="sm" asChild>
            <Link to={{ name: 'study', id: null }}>
              <Plus /> Nuevo estudio
            </Link>
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
        {studies === null ? (
          <CardContent className="py-10 text-center text-muted-foreground text-sm">Cargando…</CardContent>
        ) : studies.length === 0 ? (
          <CardHeader className="py-10 text-center">
            <CardTitle>Todavía no hay estudios</CardTitle>
            <CardDescription>
              Crea uno a mano, o pídele a una IA que lo escriba: en el constructor hay un botón "Copiar prompt para IA" y aquí "Importar study.json".
            </CardDescription>
          </CardHeader>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Estudio</TableHead>
                <TableHead className="text-right">Tareas</TableHead>
                <TableHead>Variantes</TableHead>
                <TableHead>Actualizado</TableHead>
                <TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {studies.map((s) => (
                <TableRow key={s.id} className="cursor-pointer" onClick={() => navigate({ name: 'study', id: s.id })}>
                  <TableCell>
                    <Link to={{ name: 'study', id: s.id }} className="font-medium hover:underline">
                      {s.name}
                    </Link>
                    {s.description && <div className="text-muted-foreground text-xs truncate max-w-md">{s.description}</div>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{s.tasks.length}</TableCell>
                  <TableCell>
                    {s.variants?.length ? <Badge variant="secondary">A/B · {s.variants.length}</Badge> : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatRelative(s.updatedAt)}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-0.5">
                      <Button variant="ghost" size="icon" aria-label="Link del estudio" onClick={() => navigate({ name: 'study', id: s.id })}>
                        <Link2 className="text-muted-foreground" />
                      </Button>
                      <Button variant="ghost" size="icon" aria-label="Editar" onClick={() => navigate({ name: 'study', id: s.id })}>
                        <Pencil className="text-muted-foreground" />
                      </Button>
                      <Button variant="ghost" size="icon" aria-label="Exportar" onClick={() => downloadStudy(s)}>
                        <Download className="text-muted-foreground" />
                      </Button>
                      <Button variant="ghost" size="icon" aria-label="Borrar" onClick={() => void onDelete(s)}>
                        <Trash2 className="text-muted-foreground" />
                      </Button>
                    </div>
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
