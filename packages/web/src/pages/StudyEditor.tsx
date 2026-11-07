import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowDown, ArrowUp, Copy, Check, Download, Plus, Trash2, Sparkles, QrCode } from 'lucide-react';
import {
  DEFAULT_CONSENT_TEXT,
  validateStudy,
  type ServerInfo,
  type Study,
  type StudyRecord,
  type StudyVariant,
  type SuccessRule,
  type Task,
} from '@taptana/shared';
import { getClient, type PrototypePage } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, NativeSelect, Textarea } from '@/components/ui/input';
import { Layout } from '@/components/layout';
import { buildStudyPrompt } from '@/lib/prompt';
import { cn } from '@/lib/utils';
import { Link, useRouter } from '@/router';
import { downloadStudy } from './Studies';

function newTask(n: number): Task {
  return { id: `t${n}`, kind: 'task', title: '', instruction: '', success: { type: 'manual' } };
}

function emptyStudy(prototypeId: string): Study {
  return { v: 1, name: '', prototypeId, welcome: '', tasks: [newTask(1)] };
}

export function StudyEditorPage({ id }: { id: string | null }) {
  const [study, setStudy] = useState<Study | null>(null);
  const [record, setRecord] = useState<StudyRecord | null>(null);
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [pages, setPages] = useState<PrototypePage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [goal, setGoal] = useState('');
  const [copied, setCopied] = useState<'prompt' | 'link' | null>(null);
  const [mode, setMode] = useState<'http' | 'static'>('http');
  const { navigate } = useRouter();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const client = await getClient();
        const serverInfo = await client.info();
        if (cancelled) return;
        setMode(client.mode);
        setInfo(serverInfo);
        setPages(await client.listPrototypePages(serverInfo.prototypeId));
        if (id) {
          const found = await client.getStudy(id);
          if (!found) {
            setError('No existe este estudio.');
            return;
          }
          setRecord(found);
          const { id: _i, createdAt: _c, updatedAt: _u, ...clean } = found;
          setStudy(clean);
        } else {
          setStudy(emptyStudy(serverInfo.prototypeId));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const update = (patch: Partial<Study>): void => {
    setStudy((s) => (s ? { ...s, ...patch } : s));
    setDirty(true);
  };
  const updateTask = (i: number, patch: Partial<Task>): void => {
    setStudy((s) => (s ? { ...s, tasks: s.tasks.map((t, j) => (j === i ? { ...t, ...patch } : t)) } : s));
    setDirty(true);
  };
  const moveTask = (i: number, dir: -1 | 1): void => {
    setStudy((s) => {
      if (!s) return s;
      const tasks = [...s.tasks];
      const j = i + dir;
      if (j < 0 || j >= tasks.length) return s;
      [tasks[i], tasks[j]] = [tasks[j]!, tasks[i]!];
      return { ...s, tasks };
    });
    setDirty(true);
  };
  const removeTask = (i: number): void => {
    setStudy((s) => (s ? { ...s, tasks: s.tasks.filter((_, j) => j !== i) } : s));
    setDirty(true);
  };
  const addTask = (): void => {
    setStudy((s) => {
      if (!s) return s;
      let n = s.tasks.length + 1;
      while (s.tasks.some((t) => t.id === `t${n}`)) n++;
      return { ...s, tasks: [...s.tasks, newTask(n)] };
    });
    setDirty(true);
  };

  const validation = useMemo(() => (study ? validateStudy(study) : null), [study]);

  const onSave = async (): Promise<void> => {
    if (!study || !validation?.ok) return;
    setSaving(true);
    try {
      const client = await getClient();
      const saved = await client.saveStudy(validation.value, record?.id);
      setRecord(saved);
      setDirty(false);
      setError(null);
      if (!record) navigate({ name: 'study', id: saved.id }, true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const copy = async (text: string, what: 'prompt' | 'link'): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      prompt('Copia este texto:', text);
    }
  };

  if (error && !study) return <Layout><p className="text-destructive text-sm">{error}</p></Layout>;
  if (!study || !info) return <Layout><p className="text-muted-foreground text-sm">Cargando…</p></Layout>;

  const participantLink = record ? `${info.participantUrl}${info.participantUrl.includes('?') ? '&' : '?'}study=${record.id}` : null;
  const qr = participantLink ? (async () => (await getClient()).qrImageUrl(participantLink))() : null;
  void qr;

  return (
    <Layout wide>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link to={{ name: 'studies' }}>
              <ArrowLeft />
            </Link>
          </Button>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{record ? study.name || 'Estudio' : 'Nuevo estudio'}</h1>
            <p className="text-muted-foreground text-sm">
              Prototipo: {info.prototypeName} {dirty && <Badge variant="outline">sin guardar</Badge>}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {record && (
            <Button variant="outline" size="sm" onClick={() => downloadStudy({ ...study, id: record.id, createdAt: record.createdAt, updatedAt: record.updatedAt })}>
              <Download /> Exportar
            </Button>
          )}
          <Button size="sm" onClick={() => void onSave()} disabled={!validation?.ok || saving || (!dirty && !!record)}>
            {saving ? 'Guardando…' : record ? 'Guardar cambios' : 'Crear estudio'}
          </Button>
        </div>
      </header>

      {error && (
        <Card className="border-destructive/40 py-4">
          <CardContent className="text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <Card className="py-5 gap-4">
            <CardHeader className="px-5">
              <CardTitle className="text-base">Lo básico</CardTitle>
            </CardHeader>
            <CardContent className="px-5 space-y-4">
              <div>
                <Label htmlFor="name">Nombre</Label>
                <Input id="name" value={study.name} onChange={(e) => update({ name: e.target.value })} placeholder="Compra en la tienda móvil" />
              </div>
              <div>
                <Label htmlFor="description">Qué quieres aprender (opcional)</Label>
                <Input id="description" value={study.description ?? ''} onChange={(e) => update({ description: e.target.value })} placeholder="Si el flujo de compra se entiende sin ayuda" />
              </div>
              <div>
                <Label htmlFor="welcome">Bienvenida para el participante</Label>
                <Textarea id="welcome" value={study.welcome ?? ''} onChange={(e) => update({ welcome: e.target.value })} placeholder="Gracias por ayudarnos. Vas a usar un prototipo: nada es real y no hay respuestas incorrectas. Piensa en voz alta." />
              </div>
              <div>
                <Label htmlFor="consent">Texto de consentimiento</Label>
                <Textarea id="consent" value={study.consent ?? ''} onChange={(e) => update({ consent: e.target.value })} placeholder={DEFAULT_CONSENT_TEXT} />
                <p className="text-muted-foreground text-xs mt-1">Si lo dejas vacío se usa el texto por defecto. Hasta que el participante acepta, no se graba nada.</p>
              </div>
            </CardContent>
          </Card>

          <Card className="py-5 gap-4">
            <CardHeader className="px-5 flex flex-row items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">Tareas</CardTitle>
                <CardDescription>En orden. La instrucción es lo que el participante lee en su celular.</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={addTask} aria-label="Agregar tarea">
                <Plus /> Tarea
              </Button>
            </CardHeader>
            <CardContent className="px-5 space-y-3">
              {study.tasks.map((task, i) => (
                <TaskCard
                  key={task.id}
                  index={i}
                  task={task}
                  pages={pages}
                  total={study.tasks.length}
                  onChange={(patch) => updateTask(i, patch)}
                  onMove={(dir) => moveTask(i, dir)}
                  onRemove={() => removeTask(i)}
                />
              ))}
              {validation && !validation.ok && <p className="text-destructive text-xs">{validation.error}</p>}
            </CardContent>
          </Card>

          <VariantsCard study={study} pages={pages} onChange={(variants) => update(variants.length ? { variants } : { variants: undefined })} />
        </div>

        <div className="space-y-4">
          <Card className="py-5 gap-3">
            <CardHeader className="px-5">
              <CardTitle className="text-base flex items-center gap-2">
                <QrCode className="size-4" /> Link del estudio
              </CardTitle>
              <CardDescription>
                {record ? 'El participante lo abre en su celular. Verá la bienvenida y luego las tareas.' : 'Guarda el estudio para obtener el link.'}
              </CardDescription>
            </CardHeader>
            {participantLink && (
              <CardContent className="px-5 space-y-3">
                <StudyQr link={participantLink} mode={mode} />
                <div className="flex gap-2">
                  <Input readOnly value={participantLink} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
                  <Button variant="outline" size="icon" aria-label="Copiar link" onClick={() => void copy(participantLink, 'link')}>
                    {copied === 'link' ? <Check /> : <Copy />}
                  </Button>
                </div>
                {mode === 'static' && <p className="text-muted-foreground text-xs">En modo demo el link no corre el estudio: hace falta el servidor.</p>}
              </CardContent>
            )}
          </Card>

          <Card className="py-5 gap-3">
            <CardHeader className="px-5">
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="size-4" /> Que lo escriba una IA
              </CardTitle>
              <CardDescription>
                Copia el prompt, pégalo en Claude, ChatGPT o la IA que uses, guarda la respuesta como <code>study.json</code> e impórtalo desde Estudios.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-5 space-y-3">
              <div>
                <Label htmlFor="goal">Qué quieres averiguar (opcional)</Label>
                <Textarea id="goal" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Si la gente encuentra el envío gratis y si el formulario asusta" />
              </div>
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => void copy(buildStudyPrompt({ prototypeId: info.prototypeId, prototypeName: info.prototypeName, pages, goal }), 'prompt')}
              >
                {copied === 'prompt' ? <Check /> : <Copy />} {copied === 'prompt' ? 'Copiado' : 'Copiar prompt para IA'}
              </Button>
              <p className="text-muted-foreground text-xs">
                El prompt incluye las {pages.length} páginas del prototipo y el formato exacto. Taptana no llama a ningún modelo: la IA la pones tú.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}

function StudyQr({ link, mode }: { link: string; mode: 'http' | 'static' }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    void getClient().then((c) => setSrc(c.qrImageUrl(link)));
  }, [link]);
  if (mode === 'static' || !src) return null;
  return (
    <div className="flex justify-center rounded-lg bg-white p-3">
      <img src={src} alt="QR del link del estudio" width={200} height={200} />
    </div>
  );
}

function TaskCard({
  index,
  task,
  pages,
  total,
  onChange,
  onMove,
  onRemove,
}: {
  index: number;
  task: Task;
  pages: PrototypePage[];
  total: number;
  onChange: (patch: Partial<Task>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const rule = task.success;
  const setRule = (type: SuccessRule['type']): void => {
    if (type === 'manual') onChange({ success: { type: 'manual' } });
    else if (type === 'reached') onChange({ success: { type: 'reached', path: rule.type === 'reached' ? rule.path : (pages[0]?.path ?? '/') } });
    else onChange({ success: { type: 'tapped', selector: rule.type === 'tapped' ? rule.selector : '' } });
  };
  const kind = task.kind ?? 'task';

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="tabular-nums">
          {index + 1}
        </Badge>
        <Input value={task.title} onChange={(e) => onChange({ title: e.target.value })} placeholder="Título corto (para el panel)" className="flex-1" />
        <NativeSelect value={kind} onChange={(e) => onChange({ kind: e.target.value as Task['kind'] })} className="w-36">
          <option value="task">Tarea</option>
          <option value="first-click">First click</option>
        </NativeSelect>
        <div className="flex">
          <Button variant="ghost" size="icon" aria-label="Subir" disabled={index === 0} onClick={() => onMove(-1)}>
            <ArrowUp />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Bajar" disabled={index === total - 1} onClick={() => onMove(1)}>
            <ArrowDown />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Quitar" disabled={total === 1} onClick={onRemove}>
            <Trash2 className="text-muted-foreground" />
          </Button>
        </div>
      </div>
      <div>
        <Label>Instrucción para el participante</Label>
        <Textarea
          value={task.instruction}
          onChange={(e) => onChange({ instruction: e.target.value })}
          placeholder={kind === 'first-click' ? '¿Dónde tocarías para ver tu carrito?' : 'Quieres regalar una planta. Encuentra una grande y cómprala.'}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Empieza en</Label>
          <PathSelect value={task.startPath ?? ''} pages={pages} allowEmpty="Donde esté" onChange={(v) => onChange(v ? { startPath: v } : { startPath: undefined })} />
        </div>
        <div>
          <Label>Se logra cuando</Label>
          <div className={cn('grid gap-2', rule.type !== 'manual' && 'grid-cols-[auto_1fr]')}>
            <NativeSelect value={rule.type} onChange={(e) => setRule(e.target.value as SuccessRule['type'])} className={rule.type === 'manual' ? '' : 'w-40'}>
              <option value="reached">Llega a la página</option>
              <option value="tapped">Toca el elemento</option>
              <option value="manual">Lo decide el moderador</option>
            </NativeSelect>
            {rule.type === 'reached' && <PathSelect value={rule.path} pages={pages} onChange={(v) => onChange({ success: { type: 'reached', path: v } })} />}
            {rule.type === 'tapped' && (
              <Input value={rule.selector} onChange={(e) => onChange({ success: { type: 'tapped', selector: e.target.value } })} placeholder="#agregar o .cart-link" className="font-mono text-xs" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PathSelect({ value, pages, onChange, allowEmpty }: { value: string; pages: PrototypePage[]; onChange: (v: string) => void; allowEmpty?: string }) {
  const known = pages.some((p) => p.path === value);
  const [custom, setCustom] = useState(!known && value !== '');
  if (custom) {
    return (
      <div className="flex gap-1">
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="/pagina.html" className="font-mono text-xs" />
        <Button variant="ghost" size="sm" onClick={() => setCustom(false)}>
          Lista
        </Button>
      </div>
    );
  }
  return (
    <NativeSelect
      value={known || value === '' ? value : '__custom'}
      onChange={(e) => {
        if (e.target.value === '__custom') setCustom(true);
        else onChange(e.target.value);
      }}
    >
      {allowEmpty && <option value="">{allowEmpty}</option>}
      {pages.map((p) => (
        <option key={p.path} value={p.path}>
          {p.path}
          {p.title ? ` · ${p.title}` : ''}
        </option>
      ))}
      <option value="__custom">Otra ruta…</option>
    </NativeSelect>
  );
}

function VariantsCard({ study, pages, onChange }: { study: Study; pages: PrototypePage[]; onChange: (variants: StudyVariant[]) => void }) {
  const variants = study.variants ?? [];
  const set = (i: number, patch: Partial<StudyVariant>): void => onChange(variants.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  const add = (): void => {
    const letter = String.fromCharCode(65 + variants.length);
    onChange([...variants, { id: letter, name: `Variante ${letter}`, startPath: pages[0]?.path ?? '/' }]);
  };
  return (
    <Card className="py-5 gap-4">
      <CardHeader className="px-5 flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle className="text-base">Variantes A/B (opcional)</CardTitle>
          <CardDescription>Cada participante recibe una al azar. Las tareas son las mismas; cambia la página donde empieza.</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={add} disabled={variants.length >= 4}>
          <Plus /> Variante
        </Button>
      </CardHeader>
      {variants.length > 0 && (
        <CardContent className="px-5 space-y-2">
          {variants.map((v, i) => (
            <div key={v.id} className="grid gap-2 sm:grid-cols-[3rem_1fr_1fr_auto] items-center">
              <Badge variant="secondary" className="justify-center">
                {v.id}
              </Badge>
              <Input value={v.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="Nombre" />
              <PathSelect value={v.startPath ?? ''} pages={pages} allowEmpty="Donde esté" onChange={(p) => set(i, p ? { startPath: p } : { startPath: undefined })} />
              <Button variant="ghost" size="icon" aria-label="Quitar variante" onClick={() => onChange(variants.filter((_, j) => j !== i))}>
                <Trash2 className="text-muted-foreground" />
              </Button>
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  );
}
