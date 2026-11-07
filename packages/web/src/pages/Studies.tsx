import { useEffect, useRef, useState } from 'react';
import { Plus, Upload, Trash2, Download, Pencil, BarChart3, FlaskConical } from 'lucide-react';
import { validateStudy, type Prototype, type SessionSummary, type StudyRecord } from '@taptana/shared';
import { getClient } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, Layout, PageHeader } from '@/components/layout';
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
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [protos, setProtos] = useState<Prototype[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const { navigate } = useRouter();

  const load = async (): Promise<void> => {
    try {
      const client = await getClient();
      const [st, se, pr] = await Promise.all([client.listStudies(), client.listSessions(), client.listPrototypes()]);
      setStudies(st);
      setSessions(se);
      setProtos(pr);
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

  const stats = (id: string) => {
    const mine = sessions.filter((s) => s.studyId === id);
    const tasks = mine.flatMap((s) => s.tasks ?? []);
    const ok = tasks.filter((t) => t.outcome === 'success').length;
    return { participants: mine.length, success: tasks.length ? ok / tasks.length : null };
  };

  return (
    <Layout>
      <PageHeader
        title="Estudios"
        description="Un estudio es una lista de tareas sobre tu prototipo. Lo compartes con un link y ves qué tan bien les fue a los participantes."
        actions={
          <>
            <Button variant="outline" onClick={() => fileInput.current?.click()}>
              <Upload /> Importar study.json
            </Button>
            <Button asChild>
              <Link to={{ name: 'study', id: null }}>
                <Plus /> Nuevo estudio
              </Link>
            </Button>
          </>
        }
      />
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

      {error && (
        <Card className="border-destructive/40 py-4">
          <CardContent className="text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {studies === null ? (
        <p className="text-muted-foreground">Cargando…</p>
      ) : studies.length === 0 ? (
        <EmptyState
          icon={<FlaskConical className="size-5" />}
          title="Crea tu primer estudio"
          action={
            <Button asChild>
              <Link to={{ name: 'study', id: null }}>
                <Plus /> Nuevo estudio
              </Link>
            </Button>
          }
        >
          Escribe las tareas a mano o pídele a una IA que las arme: en el constructor hay un botón "Copiar prompt para IA".
        </EmptyState>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2">
          {studies.map((s) => {
            const st = stats(s.id);
            const proto = protos.find((p) => p.id === s.prototypeId);
            return (
              <Card key={s.id} className="py-6 gap-5 hover:shadow-md transition-shadow min-w-0">
                <CardHeader className="px-6">
                  <CardTitle className="text-lg">{s.name}</CardTitle>
                  <CardDescription className="line-clamp-2">{s.description || `${s.tasks.length} tareas`}</CardDescription>
                </CardHeader>
                <CardContent className="px-6 space-y-5">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">{proto?.name ?? s.prototypeId}</Badge>
                    <Badge variant="outline">{s.tasks.length} tareas</Badge>
                    {s.tasks.some((t) => t.kind === 'first-click') && <Badge variant="outline">first click</Badge>}
                    {s.variants?.length ? <Badge variant="outline">A/B</Badge> : null}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg bg-muted/60 p-3">
                      <div className="text-2xl font-semibold tabular-nums">{st.participants}</div>
                      <div className="text-xs text-muted-foreground">participantes</div>
                    </div>
                    <div className="rounded-lg bg-muted/60 p-3">
                      <div className="text-2xl font-semibold tabular-nums">{st.success === null ? '—' : `${Math.round(st.success * 100)}%`}</div>
                      <div className="text-xs text-muted-foreground">éxito en tareas</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button className="flex-1 min-w-36" asChild>
                      <Link to={{ name: 'report', id: s.id }}>
                        <BarChart3 /> Ver resultados
                      </Link>
                    </Button>
                    <Button variant="outline" asChild>
                      <Link to={{ name: 'study', id: s.id }}>
                        <Pencil /> Diseño
                      </Link>
                    </Button>
                    <Button variant="ghost" size="icon" aria-label="Exportar" onClick={() => downloadStudy(s)}>
                      <Download />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label="Borrar" onClick={() => void onDelete(s)}>
                      <Trash2 />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">Actualizado {formatRelative(s.updatedAt)}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </Layout>
  );
}
