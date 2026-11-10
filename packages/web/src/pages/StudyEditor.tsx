/**
 * Constructor de estudios, a tres columnas: bloques, editor del bloque y el teléfono con el
 * prototipo. En pantallas angostas las columnas se apilan.
 *
 * Guardado: un estudio nuevo se crea con "Crear estudio"; después se guarda solo cada vez que
 * el borrador es válido. Mientras haya cambios sin guardar, salir pide confirmación.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BarChart3, CircleAlert, CircleCheck, Copy, Crosshair, Download, Ellipsis, LoaderCircle, PencilRuler, Play, Plus, Share2, Sparkles, TriangleAlert } from 'lucide-react';
import {
  sameScreen,
  screenId,
  screenLabel,
  type BlockKind,
  type ContextBlock,
  type Prototype,
  type QuestionBlock,
  type RecorderMessage,
  type ScreenInfo,
  type ServerInfo,
  type Study,
  type StudyIssue,
  type StudyRecord,
  type StudyReport,
  type SuccessRule,
} from '@taptana/shared';
import { getClient, IS_DEMO, type ApiClient } from '@/api/client';
import { AddBlockMenu, BlockList } from '@/components/builder/BlockList';
import { ContextEditor, QuestionEditor, SettingsEditor, TaskEditor, ThanksEditor, WelcomeEditor, type TaskTools } from '@/components/builder/BlockEditor';
import { AiDialog, RecordPanel, ShareDialog, TryoutDialog } from '@/components/builder/dialogs';
import {
  checkDraft,
  cloneBlock,
  emptyDraft,
  isDraftTask,
  issueSelection,
  moveItem,
  newBlock,
  pushScreen,
  reassignIds,
  studyFileName,
  toDraft,
  tryoutStudy,
  FIXED_SELECTIONS,
  type DemoStep,
  type DraftBlock,
  type DraftStudy,
  type Selection,
} from '@/components/builder/draft';
import { ShowErrorsContext } from '@/components/builder/fields';
import { PhoneFrame, type PhoneHandle } from '@/components/builder/PhoneFrame';
import { ErrorState, Layout, PageHeader, PageSkeleton, RouteTabs } from '@/components/layout';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/toast';
import { downloadText } from '@/lib/download';
import { friendlyError } from '@/lib/errors';
import { plural } from '@/lib/format';
import { participantUrl } from '@/lib/links';
import { Link, useNavigationBlocker, useRouter } from '@/router';

type PhoneMode = { type: 'record'; blockId: string; steps: DemoStep[] } | { type: 'pick'; blockId: string } | null;

const AUTOSAVE_MS = 800;

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (): void => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export function StudyEditorPage({ id }: { id: string | null }) {
  const { navigate } = useRouter();
  const [client, setClient] = useState<ApiClient | null>(null);
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [protos, setProtos] = useState<Prototype[]>([]);
  const [record, setRecord] = useState<StudyRecord | null>(null);
  const [draft, setDraft] = useState<DraftStudy | null>(null);
  const [savedJson, setSavedJson] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);
  const [saving, setSaving] = useState(false);
  const [failedJson, setFailedJson] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>('settings');
  const [showAllErrors, setShowAllErrors] = useState(false);

  const [apiScreens, setApiScreens] = useState<ScreenInfo[]>([]);
  const [seenScreens, setSeenScreens] = useState<ScreenInfo[]>([]);
  const [sessionCount, setSessionCount] = useState(0);
  const [report, setReport] = useState<StudyReport | null>(null);

  const [phoneScreen, setPhoneScreen] = useState<string | undefined>(undefined);
  const [tick, setTick] = useState(0);
  const [mode, setMode] = useState<PhoneMode>(null);
  const [matches, setMatches] = useState<number | null>(null);

  const [shareOpen, setShareOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [tryout, setTryout] = useState<{ study: Study; startAt?: string } | null>(null);
  const [leave, setLeave] = useState<(() => void) | null>(null);
  const [busy, setBusy] = useState(false);

  const wide = useMediaQuery('(min-width: 1280px)');
  const phone = useRef<PhoneHandle>(null);
  const phoneBox = useRef<HTMLDivElement>(null);
  const editorBox = useRef<HTMLDivElement>(null);
  /** Todos los ids de bloque que han existido en este estudio: nunca se reutilizan. */
  const usedIds = useRef(new Set<string>());
  /** El id que acabamos de crear: al cambiar la dirección no hay que volver a cargar. */
  const createdId = useRef<string | null>(null);

  // ── Carga ──
  useEffect(() => {
    if (id !== null && createdId.current === id) return;
    let cancelled = false;
    setDraft(null);
    setRecord(null);
    setLoadError(null);
    setMode(null);
    setSessionCount(0);
    setReport(null);
    setShowAllErrors(id !== null);
    setSelection('settings');
    (async () => {
      try {
        const c = await getClient();
        const [serverInfo, list, found] = await Promise.all([c.info(), c.listPrototypes(), id ? c.getStudy(id) : Promise.resolve(null)]);
        if (cancelled) return;
        setClient(c);
        setInfo(serverInfo);
        setProtos(list);
        let next: DraftStudy;
        if (id) {
          if (!found) {
            setLoadError('Este estudio no existe. Puede que se haya borrado.');
            return;
          }
          setRecord(found);
          next = toDraft(found);
          const first = next.blocks[0];
          if (first) setSelection(first.id);
        } else {
          // Por defecto, el prototipo más reciente.
          const newest = [...list].sort((a, b) => b.createdAt - a.createdAt)[0];
          next = emptyDraft(newest?.id ?? '');
        }
        usedIds.current = new Set(next.blocks.map((b) => b.id));
        setDraft(next);
        setSavedJson(JSON.stringify(next));
        if (id) {
          const sessions = await c.listSessions(id).catch(() => []);
          if (cancelled) return;
          setSessionCount(sessions.length);
          if (sessions.length > 0) {
            const r = await c.getStudyReport(id).catch(() => null);
            if (!cancelled) setReport(r);
          }
        }
      } catch (e) {
        if (!cancelled) setLoadError(friendlyError(e, 'No pudimos abrir el estudio.'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, reloads]);

  const proto = useMemo(() => protos.find((p) => p.id === draft?.prototypeId), [protos, draft?.prototypeId]);

  // ── Pantallas del prototipo ──
  useEffect(() => {
    setApiScreens([]);
    setSeenScreens([]);
    if (!client || !proto) return;
    let cancelled = false;
    client
      .listPrototypeScreens(proto.id)
      .then((list) => !cancelled && setApiScreens(list))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [client, proto]);
  const screens = useMemo(() => [...apiScreens, ...seenScreens.filter((s) => !apiScreens.some((a) => sameScreen(a.id, s.id)))], [apiScreens, seenScreens]);

  // ── Validación y guardado ──
  const check = useMemo(() => (draft ? checkDraft(draft) : null), [draft]);
  const errors = useMemo<StudyIssue[]>(() => {
    if (!draft || !check) return [];
    const list = [...check.errors];
    if (draft.prototypeId && !proto && !list.some((i) => i.field === 'prototypeId')) {
      list.unshift({ message: 'El prototipo de este estudio ya no está aquí: elige otro', field: 'prototypeId', level: 'error' });
    }
    return list;
  }, [draft, check, proto]);
  const valid = check !== null && check.ok && errors.length === 0;
  const json = useMemo(() => (draft ? JSON.stringify(draft) : ''), [draft]);
  const dirty = draft !== null && json !== savedJson;
  const incomplete = useMemo(() => new Set(errors.map(issueSelection)), [errors]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!client || !record || !check?.value) return false;
    const sending = json;
    setSaving(true);
    try {
      const saved = await client.saveStudy(check.value, record.id);
      setRecord(saved);
      setSavedJson(sending);
      setFailedJson(null);
      setSaveError(null);
      return true;
    } catch (e) {
      setFailedJson(sending);
      setSaveError(friendlyError(e, 'No se pudo guardar. Revisa que Taptana siga abierto.'));
      return false;
    } finally {
      setSaving(false);
    }
  }, [client, record, check, json]);

  useEffect(() => {
    if (!record || !dirty || !valid || saving || failedJson === json) return;
    const timer = window.setTimeout(() => void save(), AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [record, dirty, valid, saving, failedJson, json, save]);

  const create = async (): Promise<void> => {
    if (!client || !check?.value || !valid) return;
    setBusy(true);
    try {
      const saved = await client.saveStudy(check.value);
      createdId.current = saved.id;
      setRecord(saved);
      setSavedJson(json);
      setShowAllErrors(true);
      toast.success('Estudio creado. Desde ahora se guarda solo.');
      navigate({ name: 'study', id: saved.id }, { replace: true, force: true });
    } catch (e) {
      toast.error(friendlyError(e, 'No se pudo crear el estudio. Intenta de nuevo.'));
    } finally {
      setBusy(false);
    }
  };

  useNavigationBlocker(dirty, (proceed) => {
    // Con el estudio ya creado y sin errores basta con guardar antes de salir.
    if (record && valid) {
      void save().then((ok) => (ok ? proceed() : setLeave(() => proceed)));
      return;
    }
    setLeave(() => proceed);
  });

  // ── Cambios en el borrador ──
  const update = (next: DraftStudy): void => setDraft(next);
  const updateBlock = (next: DraftBlock): void => setDraft((d) => (d ? { ...d, blocks: d.blocks.map((b) => (b.id === next.id ? next : b)) } : d));

  const select = (next: Selection, scroll = true): void => {
    setSelection(next);
    if (mode && mode.blockId !== next) setMode(null);
    if (scroll && window.matchMedia('(max-width: 1023px)').matches) window.setTimeout(() => editorBox.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

  const addBlock = (kind: BlockKind): void => {
    if (!draft) return;
    const block = newBlock(kind, usedIds.current);
    usedIds.current.add(block.id);
    const at = draft.blocks.findIndex((b) => b.id === selection);
    const blocks = [...draft.blocks];
    blocks.splice(at >= 0 ? at + 1 : blocks.length, 0, block);
    setDraft({ ...draft, blocks });
    select(block.id);
  };

  const duplicateBlock = (blockId: string): void => {
    if (!draft) return;
    const at = draft.blocks.findIndex((b) => b.id === blockId);
    const source = draft.blocks[at];
    if (!source) return;
    const copy = cloneBlock(source, usedIds.current);
    usedIds.current.add(copy.id);
    const blocks = [...draft.blocks];
    blocks.splice(at + 1, 0, copy);
    setDraft({ ...draft, blocks });
    select(copy.id);
  };

  const deleteBlock = (blockId: string): void => {
    if (!draft) return;
    const at = draft.blocks.findIndex((b) => b.id === blockId);
    const removed = draft.blocks[at];
    if (!removed) return;
    const blocks = draft.blocks.filter((b) => b.id !== blockId);
    setDraft({ ...draft, blocks });
    if (selection === blockId) setSelection(blocks[Math.min(at, blocks.length - 1)]?.id ?? 'settings');
    if (mode?.blockId === blockId) setMode(null);
    toast('Bloque borrado', {
      durationMs: 6000,
      action: {
        label: 'Deshacer',
        onClick: () =>
          setDraft((d) => {
            if (!d || d.blocks.some((b) => b.id === removed.id)) return d;
            const restored = [...d.blocks];
            restored.splice(Math.min(at, restored.length), 0, removed);
            return { ...d, blocks: restored };
          }),
      },
    });
  };

  // ── Teléfono ──
  const selected = draft?.blocks.find((b) => b.id === selection);
  const selectedTask = selected && isDraftTask(selected) ? selected : undefined;
  const wantedScreen = useDebounced(selectedTask?.startPath?.trim() || undefined, 600);
  const selector = selectedTask?.success?.type === 'tapped' || selectedTask?.success?.type === 'visible' ? (selectedTask.success.selector ?? '') : '';

  useEffect(() => {
    if (!selector) {
      setMatches(null);
      return;
    }
    // Un momento después del último mensaje, para que la pantalla ya esté dibujada.
    const timer = window.setTimeout(() => setMatches(phone.current?.countMatches(selector) ?? null), 250);
    return () => window.clearTimeout(timer);
  }, [selector, tick, phoneScreen]);

  const showPhone = (): void => {
    window.setTimeout(() => phoneBox.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 0);
  };

  const onPhoneMessage = (msg: RecorderMessage): void => {
    setTick((t) => t + 1);
    if (msg.type === 'ready' || msg.type === 'screen') {
      const sid = screenId(msg.screen);
      setPhoneScreen(sid);
      // Las pantallas que aparecen al navegar se pueden elegir aunque no sean un archivo.
      setSeenScreens((list) => (list.some((s) => sameScreen(s.id, sid)) ? list : [...list, { id: sid, label: screenLabel(sid), ...(msg.title ? { title: msg.title } : {}), source: 'seen' }]));
      setMode((m) => (m?.type === 'record' ? { ...m, steps: pushScreen(m.steps, msg.screen, msg.title) } : m));
      return;
    }
    if (msg.type !== 'tap') return;
    if (mode?.type === 'record') {
      setMode((m) => (m?.type === 'record' ? { ...m, steps: [...m.steps, { type: 'tap', screen: screenId(msg.screen), selector: msg.selector || msg.target.selector, text: msg.target.text ?? '' }] } : m));
    } else if (mode?.type === 'pick') {
      const picked = msg.selector || msg.target.selector;
      const block = draft?.blocks.find((b) => b.id === mode.blockId);
      if (block && isDraftTask(block) && picked) {
        const success: SuccessRule = block.success?.type === 'visible' ? { ...block.success, selector: picked } : { type: 'tapped', selector: picked };
        updateBlock({ ...block, success });
        toast.success(msg.target.text ? `Elegiste "${msg.target.text.slice(0, 40)}"` : 'Elemento elegido');
      }
      setMode(null);
      // El toque pudo cambiar de pantalla: el teléfono vuelve al inicio de la tarea, donde se comprueba el selector.
      window.setTimeout(() => phone.current?.reload(), 700);
    }
  };

  const startRecording = (blockId: string): void => {
    setMode({ type: 'record', blockId, steps: [] });
    phone.current?.reload();
    showPhone();
  };

  const applyDemo = (result: { startPath: string; expectedPath: string[]; success: SuccessRule }): void => {
    if (mode?.type !== 'record') return;
    const block = draft?.blocks.find((b) => b.id === mode.blockId);
    if (block && isDraftTask(block)) {
      const next = { ...block, startPath: result.startPath, success: result.success };
      if ((block.kind ?? 'task') === 'task' && result.expectedPath.length > 0) next.expectedPath = result.expectedPath;
      updateBlock(next);
      toast.success('Listo: llenamos la pantalla de inicio, el camino y la regla.');
    }
    setMode(null);
  };

  const openTryout = (blockId?: string): void => {
    if (!draft) return;
    if (!proto) {
      toast.error('Elige un prototipo en "Ajustes del estudio" para poder probar.');
      return;
    }
    const result = tryoutStudy(draft, blockId);
    if (!result.study) {
      setShowAllErrors(true);
      toast.error(`Para probar, primero corrige esto: ${result.error ?? 'el estudio tiene errores'}.`);
      return;
    }
    setMode(null);
    setTryout({ study: result.study, ...(blockId ? { startAt: blockId } : {}) });
  };

  // ── Acciones del estudio ──
  const applyImported = (study: Study): void => {
    if (!draft) return;
    const incoming = toDraft(study);
    // En un estudio que ya existe los bloques reciben ids nuevos: así no heredan resultados.
    const blocks = record ? reassignIds(incoming.blocks, usedIds.current) : incoming.blocks;
    for (const b of blocks) usedIds.current.add(b.id);
    const next: DraftStudy = { ...incoming, blocks, name: draft.name.trim() || incoming.name, prototypeId: proto ? draft.prototypeId : incoming.prototypeId };
    if (draft.closed) next.closed = true;
    setDraft(next);
    setSelection(blocks[0]?.id ?? 'settings');
    toast.success(`Listo: ${plural(blocks.length, 'bloque', 'bloques')} en el estudio. Revísalos antes de compartir.`);
  };

  const duplicateStudy = async (): Promise<void> => {
    if (!client || !record) return;
    setBusy(true);
    try {
      const copy = await client.duplicateStudy(record.id);
      toast.success('Copia creada. Ahora estás editando la copia.');
      navigate({ name: 'study', id: copy.id }, { force: true });
    } catch (e) {
      toast.error(friendlyError(e, 'No se pudo duplicar el estudio.'));
    } finally {
      setBusy(false);
    }
  };

  const exportJson = (): void => {
    if (!draft) return;
    downloadText(studyFileName(draft.name), JSON.stringify(check?.value ?? draft, null, 2));
  };

  // ── Vista ──
  if (loadError) {
    return (
      <Layout>
        <ErrorState message={loadError} onRetry={() => setReloads((n) => n + 1)} home />
      </Layout>
    );
  }
  if (!draft || !info || !client) {
    return (
      <Layout width="full">
        <PageSkeleton />
      </Layout>
    );
  }

  const blockIndex = selected ? draft.blocks.indexOf(selected) : -1;
  const current: Selection = selected || FIXED_SELECTIONS.includes(selection) ? selection : 'settings';
  const link = record && proto ? participantUrl(info, proto, record.id) : null;
  const firstError = errors[0];
  const recording = mode?.type === 'record' ? mode : null;
  const recordingBlock = recording ? draft.blocks.find((b) => b.id === recording.blockId) : undefined;

  // Con tres columnas el panel de grabación va junto al teléfono (en el centro); apilado, encima de él.
  const recordPanel = recording ? (
    <RecordPanel
      key={recording.blockId}
      steps={recording.steps}
      kind={recordingBlock && isDraftTask(recordingBlock) ? (recordingBlock.kind ?? 'task') : 'task'}
      screens={screens}
      onRestart={() => startRecording(recording.blockId)}
      onCancel={() => setMode(null)}
      onUse={applyDemo}
    />
  ) : null;

  const tools: TaskTools = {
    screens,
    phoneScreen,
    matches,
    picking: mode?.type === 'pick' && mode.blockId === selection,
    recording: recording?.blockId === selection,
    onRecord: () => startRecording(selection),
    onPick: () => {
      setMode({ type: 'pick', blockId: selection });
      showPhone();
    },
    onCancelPick: () => setMode(null),
    onTryout: () => openTryout(selection),
    report: report?.tasks.find((t) => t.taskId === selection),
  };

  const status = !record ? null : saving || (dirty && valid && failedJson !== json) ? (
    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground" role="status">
      <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> Guardando…
    </span>
  ) : dirty && !valid ? (
    <span className="inline-flex items-center gap-1.5 text-sm text-amber-700 dark:text-amber-400" role="status">
      <TriangleAlert className="size-4" /> Hay errores: los cambios no se han guardado
    </span>
  ) : dirty ? (
    <span className="inline-flex items-center gap-2 text-sm text-destructive" role="alert">
      <CircleAlert className="size-4" /> {saveError ?? 'No se pudo guardar'}
      <Button size="sm" variant="outline" onClick={() => void save()}>
        Reintentar
      </Button>
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground" role="status">
      <CircleCheck className="size-4 text-emerald-600" /> Guardado
    </span>
  );

  return (
    <Layout width="full">
      <PageHeader
        back={
          <Button variant="ghost" size="icon" asChild className="mt-0.5 shrink-0">
            <Link to={{ name: 'studies' }} aria-label="Volver a Estudios">
              <ArrowLeft />
            </Link>
          </Button>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {draft.name.trim() || (record ? 'Estudio sin nombre' : 'Nuevo estudio')}
            {record && draft.closed && <Badge variant="secondary">Cerrado</Badge>}
          </span>
        }
        description={record ? status : 'Arma el estudio bloque por bloque. Puedes probarlo en el teléfono de la derecha antes de crearlo.'}
        actions={
          <>
            <Button variant="outline" onClick={() => setAiOpen(true)}>
              <Sparkles /> Armar con IA
            </Button>
            <Button variant="outline" onClick={() => openTryout()} disabled={draft.blocks.length === 0}>
              <Play /> Probar estudio
            </Button>
            {record ? (
              <Button onClick={() => setShareOpen(true)}>
                <Share2 /> Compartir
              </Button>
            ) : (
              <Button onClick={() => void create()} disabled={!valid || busy} aria-describedby={valid ? undefined : 'create-missing'}>
                <Plus /> {busy ? 'Creando…' : 'Crear estudio'}
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="Más acciones">
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={exportJson}>
                  <Download /> Exportar study.json
                </DropdownMenuItem>
                {record && (
                  <DropdownMenuItem disabled={busy} onSelect={() => void duplicateStudy()}>
                    <Copy /> Duplicar estudio
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      {record && (
        <RouteTabs
          tabs={[
            { label: 'Diseño', to: { name: 'study', id: record.id }, active: true, icon: <PencilRuler className="size-4" /> },
            { label: 'Resultados', to: { name: 'report', id: record.id }, active: false, icon: <BarChart3 className="size-4" /> },
          ]}
        />
      )}

      {record && sessionCount > 0 && (
        <Alert variant="warning">
          <TriangleAlert />
          <AlertTitle>Este estudio ya tiene {plural(sessionCount, 'sesión', 'sesiones')}</AlertTitle>
          <AlertDescription>
            <p>Cambiar las tareas afecta los resultados que ya tienes. Si quieres probar otra versión, mejor duplica el estudio y edita la copia.</p>
            <Button size="sm" variant="outline" className="mt-1" disabled={busy} onClick={() => void duplicateStudy()}>
              <Copy /> Duplicar estudio
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {errors.length > 0 && (
        <Alert variant={record ? 'warning' : 'default'} id="create-missing">
          <CircleAlert />
          <AlertTitle>{record ? `${errors.length === 1 ? 'Hay 1 cosa por corregir' : `Hay ${errors.length} cosas por corregir`}. Los cambios se guardan cuando esté resuelto.` : 'Para crear el estudio falta:'}</AlertTitle>
          <AlertDescription>
            <ul className="w-full space-y-0.5">
              {errors.slice(0, 6).map((issue, i) => (
                <li key={i}>
                  <button
                    type="button"
                    className="cursor-pointer rounded text-left underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    onClick={() => {
                      setShowAllErrors(true);
                      select(issueSelection(issue));
                    }}
                  >
                    {issue.message}
                  </button>
                </li>
              ))}
            </ul>
            {errors.length > 6 && <p>…y {errors.length - 6} más.</p>}
          </AlertDescription>
        </Alert>
      )}
      {!record && valid && firstError === undefined && (
        <Alert variant="success">
          <CircleCheck />
          <AlertTitle>Todo listo</AlertTitle>
          <AlertDescription>Pulsa "Crear estudio" para guardarlo y obtener el link para compartir.</AlertDescription>
        </Alert>
      )}

      <ShowErrorsContext.Provider value={showAllErrors}>
        <div className="grid items-start gap-6 lg:grid-cols-[16rem_minmax(0,1fr)] xl:grid-cols-[17rem_minmax(0,1fr)_23rem]">
          <div className="lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto lg:p-1 lg:-m-1">
            <BlockList
              blocks={draft.blocks}
              selection={current}
              incomplete={incomplete}
              onSelect={(s) => select(s)}
              onAdd={addBlock}
              onMove={(from, to) => setDraft({ ...draft, blocks: moveItem(draft.blocks, from, to) })}
              onDuplicate={duplicateBlock}
              onDelete={deleteBlock}
            />
          </div>

          <div ref={editorBox} className="min-w-0 scroll-mt-4 space-y-4" key={current}>
            {wide && recordPanel && <div className="sticky top-6 z-10">{recordPanel}</div>}
            {current === 'settings' && (
              <>
                <SettingsEditor draft={draft} onChange={update} errors={errors} protos={protos} screens={screens} saved={record !== null} />
                {draft.blocks.length === 0 && (
                  <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-background px-6 py-10 text-center">
                    <h2 className="text-base font-semibold">Ahora agrega el primer bloque</h2>
                    <p className="max-w-md text-sm text-muted-foreground">Un estudio es una lista de bloques: tareas sobre el prototipo y preguntas para el participante. Lo normal es empezar con una tarea.</p>
                    <div className="flex flex-wrap justify-center gap-2">
                      <AddBlockMenu onAdd={addBlock}>
                        <Button>
                          <Plus /> Agregar bloque
                        </Button>
                      </AddBlockMenu>
                      <Button variant="outline" onClick={() => setAiOpen(true)}>
                        <Sparkles /> Armar con IA
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
            {current === 'welcome' && <WelcomeEditor draft={draft} onChange={update} errors={errors} />}
            {current === 'thanks' && <ThanksEditor draft={draft} onChange={update} errors={errors} />}
            {selected && isDraftTask(selected) && <TaskEditor block={selected} index={blockIndex} onChange={updateBlock} errors={errors} tools={tools} />}
            {selected && !isDraftTask(selected) && selected.kind === 'context' && <ContextEditor block={selected as ContextBlock} index={blockIndex} onChange={updateBlock} errors={errors} />}
            {selected && !isDraftTask(selected) && selected.kind !== 'context' && <QuestionEditor block={selected as QuestionBlock} index={blockIndex} onChange={updateBlock} errors={errors} />}
          </div>

          <div ref={phoneBox} className="scroll-mt-4 space-y-3 lg:col-span-2 xl:sticky xl:top-6 xl:col-span-1">
            {!wide && recordPanel}
            <PhoneFrame
              ref={phone}
              proto={proto}
              screen={wantedScreen}
              onMessage={onPhoneMessage}
              highlight={mode !== null}
              banner={
                mode?.type === 'pick' ? (
                  <div className="flex items-center gap-2 rounded-lg border border-primary bg-primary/5 px-3 py-2 text-sm">
                    <Crosshair className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1">Toca el elemento que el participante tiene que tocar.</span>
                    <Button size="sm" variant="outline" onClick={() => setMode(null)}>
                      Cancelar
                    </Button>
                  </div>
                ) : undefined
              }
            />
            {!mode && proto && <p className="mx-auto max-w-[390px] text-center text-xs text-muted-foreground">Es tu prototipo de verdad: navega para revisar pantallas. Aquí no se graba nada.</p>}
          </div>
        </div>
      </ShowErrorsContext.Provider>

      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        link={link}
        qr={link ? client.qrImageUrl(link) : null}
        demo={IS_DEMO}
        closed={draft.closed === true}
        problem={!proto ? 'Este estudio no tiene un prototipo disponible. Elige uno en "Ajustes del estudio" y vuelve a compartir.' : undefined}
      />
      <TryoutDialog
        open={tryout !== null}
        onOpenChange={(o) => !o && setTryout(null)}
        proto={proto}
        study={tryout ? { ...tryout.study, ...(record ? { id: record.id, createdAt: record.createdAt, updatedAt: record.updatedAt } : {}) } : null}
        startAt={tryout?.startAt}
      />
      <AiDialog open={aiOpen} onOpenChange={setAiOpen} proto={proto} screens={screens} replaces={draft.blocks.length > 0} onApply={applyImported} />
      <ConfirmDialog
        open={leave !== null}
        onOpenChange={(o) => !o && setLeave(null)}
        title="¿Salir sin guardar?"
        description={
          record
            ? 'Hay cambios que no se guardaron porque al estudio le falta algo. Si sales ahora, esos cambios se pierden.'
            : 'Todavía no creaste el estudio. Si sales ahora, se pierde lo que escribiste.'
        }
        confirmLabel="Salir sin guardar"
        cancelLabel="Seguir editando"
        destructive
        onConfirm={() => {
          const go = leave;
          setLeave(null);
          go?.();
        }}
      />
    </Layout>
  );
}
