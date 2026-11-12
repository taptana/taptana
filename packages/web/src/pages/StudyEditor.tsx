/**
 * Constructor de estudios, a tres columnas: bloques, editor del bloque y el teléfono con el
 * prototipo. En pantallas angostas las columnas se apilan.
 *
 * Guardado: un estudio nuevo se crea con "Crear estudio"; después se guarda solo cada vez que
 * el borrador es válido. Mientras haya cambios sin guardar, salir pide confirmación.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BarChart3, CircleAlert, CircleCheck, Copy, Crosshair, Download, Ellipsis, FileArchive, Globe, LayoutList, ListChecks, LoaderCircle, PencilRuler, Play, Plus, Share2, Smartphone, ClipboardPaste, TriangleAlert } from 'lucide-react';
import {
  STUDY_LIMITS,
  sameScreen,
  screenId,
  screenLabel,
  screenUrl,
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
import { KIND_INFO, ShowErrorsContext } from '@/components/builder/fields';
import { PhoneFrame, type PhoneHandle, type PickMessage } from '@/components/builder/PhoneFrame';
import { ErrorState, Layout, Notice, PageHeader, PageSkeleton, RouteTabs } from '@/components/layout';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/toast';
import { downloadText } from '@/lib/download';
import { friendlyError } from '@/lib/errors';
import { plural } from '@/lib/format';
import { participantUrl } from '@/lib/links';
import { liveTitleIsStable } from '@/lib/screens';
import { cn } from '@/lib/utils';
import { Link, useNavigationBlocker, useRouter } from '@/router';

type PhoneMode = { type: 'record'; blockId: string; steps: DemoStep[] } | { type: 'pick'; blockId: string } | null;

const AUTOSAVE_MS = 800;
/** "El próximo toque es para elegir": el recorder lo avisa sin activar el prototipo. */
const PICK: PickMessage = { source: 'taptana-panel', type: 'pick' };

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

  // Con tres columnas el teléfono va a la derecha; más angosto, aparece con «Ver prototipo».
  const wide = useMediaQuery('(min-width: 1400px)');
  const [phoneOpen, setPhoneOpen] = useState(false);
  /** Estudio nuevo: primero tres preguntas cortas (prototipo, nombre, cómo empezar); null = constructor. */
  const [setup, setSetup] = useState<0 | 1 | 2 | null>(id === null ? 0 : null);
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

  // Elegir en el prototipo: se le avisa al recorder para que el toque no navegue. Al salir del
  // modo (con o sin toque) se desarma.
  const picking = mode?.type === 'pick';
  useEffect(() => {
    if (!picking) return;
    const target = phone.current;
    target?.post(PICK);
    return () => target?.post({ ...PICK, cancel: true });
  }, [picking]);

  const showPhone = (): void => {
    setPhoneOpen(true);
    window.setTimeout(() => phoneBox.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 0);
  };

  const onPhoneMessage = (msg: RecorderMessage): void => {
    setTick((t) => t + 1);
    if (msg.type === 'ready' || msg.type === 'screen') {
      const sid = screenId(msg.screen);
      setPhoneScreen(sid);
      // Las pantallas que aparecen al navegar se pueden elegir aunque no sean un archivo.
      // El título en vivo solo nombra pantallas que no son un archivo: en "/producto.html" sería el
      // del producto de esta visita, y la pantalla se tiene que llamar igual en todo el panel.
      setSeenScreens((list) => (list.some((s) => sameScreen(s.id, sid)) ? list : [...list, { id: sid, label: screenLabel(sid), ...(msg.title && liveTitleIsStable(sid) ? { title: msg.title } : {}), source: 'seen' }]));
      // El prototipo cargó de nuevo mientras se elige: se le vuelve a avisar.
      if (mode?.type === 'pick') phone.current?.post(PICK);
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
        const next = { ...block, success };
        // En primer clic, la pantalla donde se tocó es donde se hace la pregunta.
        if (block.kind === 'first-click' && !block.startPath?.trim()) next.startPath = screenUrl(msg.screen);
        updateBlock(next);
        toast.success(msg.target.text ? `Elegiste "${msg.target.text.slice(0, 40)}"` : 'Elemento elegido');
      }
      setMode(null);
      // Con un recorder que entiende "pick" el toque no activó nada (`picked`). Si no, pudo cambiar
      // de pantalla: el teléfono vuelve al inicio de la tarea, donde se comprueba el selector.
      if ((msg as { picked?: boolean }).picked !== true) window.setTimeout(() => phone.current?.reload(), 700);
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
  /** El problema con el bloque al que pertenece delante ("Bloque 3 · Sí / No: …"), para que se sepa cuál es. */
  const issueLabel = (issue: StudyIssue): string => {
    const at = issue.blockId ? draft.blocks.findIndex((b) => b.id === issue.blockId) : -1;
    const block = draft.blocks[at];
    if (!block) return issue.message;
    return `Bloque ${at + 1} · ${KIND_INFO[block.kind ?? 'task'].label}: ${issue.message}`;
  };

  // Una app con rutas propias (History API) servida en una subcarpeta suele volver siempre al inicio.
  const needsRoot = Boolean(proto?.absoluteUrls && !proto.root && (proto.source === 'upload' || proto.source === 'url') && proto.url && proto.url !== '/');
  const openAtRoot = async (): Promise<void> => {
    if (!proto) return;
    setBusy(true);
    try {
      await client.setPrototypeRoot(proto.id, true);
      setProtos(await client.listPrototypes());
      toast.success(`«${proto.name}» ahora se abre en la raíz. El link del estudio cambió: vuelve a copiarlo si ya lo habías compartido.`);
    } catch (e) {
      toast.error(friendlyError(e, 'No se pudo abrir en la raíz. Inténtalo desde Prototipos.'));
    } finally {
      setBusy(false);
    }
  };
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
    autoAdvance: (draft.settings?.advance ?? 'auto') === 'auto',
    onManualAdvance: () => {
      update({ ...draft, settings: { ...draft.settings, advance: 'manual' } });
      toast.success('Listo: ahora el estudio espera a que el participante toque «Listo».');
    },
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
        eyebrow={record ? <>Diseño · {plural(draft.blocks.length, 'bloque', 'bloques')}</> : 'Estudio nuevo'}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {draft.name.trim() || (record ? 'Estudio sin nombre' : 'Nuevo estudio')}
            {record && draft.closed && <Badge variant="secondary">Cerrado</Badge>}
          </span>
        }
        description={record ? status : setup !== null ? 'Tres pasos cortos y después lo armas bloque por bloque.' : 'Arma el estudio bloque por bloque y pruébalo antes de crearlo.'}
        actions={
          setup !== null && !record ? undefined : (
          <>
            <Button variant="ghost" onClick={() => openTryout()} disabled={draft.blocks.length === 0}>
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
                <DropdownMenuItem onSelect={() => setAiOpen(true)}>
                  <ClipboardPaste /> Armar con IA
                </DropdownMenuItem>
                <DropdownMenuSeparator />
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
          )
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
        <Notice
          tone="warning"
          icon={<TriangleAlert />}
          title={`Este estudio ya tiene ${plural(sessionCount, 'sesión', 'sesiones')}`}
          action={
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void duplicateStudy()}>
              <Copy /> Duplicar estudio
            </Button>
          }
        >
          <p>Cambiar las tareas afecta los resultados que ya tienes. Si quieres probar otra versión, mejor duplica el estudio y edita la copia.</p>
        </Notice>
      )}

      {record && sessionCount > 0 && proto?.source === 'url' && (
        <Notice tone="warning" icon={<Globe />} title="Este prototipo se ve en vivo desde su URL">
          <p>
            Los participantes ven lo que está publicado en {proto.sourceUrl} en el momento en que abren el link. Si cambias el sitio, cambia lo que ven y los resultados
            nuevos dejan de ser comparables con las sesiones que ya tienes. Para probar otra versión, publícala en otra dirección y agrégala como otro prototipo.
          </p>
        </Notice>
      )}

      {needsRoot && (
        <div data-testid="needs-root">
          <Notice
            tone="warning"
            icon={<TriangleAlert />}
            title="Este prototipo parece una app con rutas propias"
            action={
              client.canServeAtRoot ? (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void openAtRoot()}>
                  Abrir en la raíz
                </Button>
              ) : undefined
            }
          >
            <p>
              Taptana lo sirve dentro de una subcarpeta ({proto?.url}) y ahí su navegación puede volver siempre a la pantalla de inicio. Si en el teléfono no cambia de pantalla, ábrelo en la raíz
              {client.canServeAtRoot ? '. Solo un prototipo puede estar en la raíz a la vez: si había otro, se desactiva.' : ': eso solo se puede cuando corres Taptana en tu computadora con «pnpm start».'}
            </p>
          </Notice>
        </div>
      )}

      {errors.length > 0 && setup === null && (
        <Alert variant={record ? 'warning' : 'default'} id="create-missing">
          <CircleAlert />
          <AlertTitle>{record ? `${errors.length === 1 ? 'Hay 1 cosa por corregir' : `Hay ${errors.length} cosas por corregir`}. Los cambios se guardan cuando esté resuelto.` : 'Para crear el estudio falta:'}</AlertTitle>
          <AlertDescription>
            <ul className="w-full space-y-0.5">
              {errors.slice(0, 6).map((issue, i) => (
                <li key={i}>
                  <button
                    type="button"
                    className="cursor-pointer rounded text-left underline-offset-4 outline-none hover:text-foreground hover:underline focus-ink"
                    onClick={() => {
                      setShowAllErrors(true);
                      select(issueSelection(issue));
                    }}
                  >
                    {issueLabel(issue)}
                  </button>
                </li>
              ))}
            </ul>
            {errors.length > 6 && <p>…y {errors.length - 6} más.</p>}
          </AlertDescription>
        </Alert>
      )}
      {!record && valid && firstError === undefined && setup === null && (
        <Alert variant="success">
          <CircleCheck />
          <AlertTitle>Todo listo</AlertTitle>
          <AlertDescription>Pulsa "Crear estudio" para guardarlo y obtener el link para compartir.</AlertDescription>
        </Alert>
      )}

      {setup !== null && !record ? (
        <SetupSteps
          step={setup}
          onStep={setSetup}
          name={draft.name}
          onName={(name) => update({ ...draft, name })}
          prototypeId={draft.prototypeId}
          onPrototype={(prototypeId) => update({ ...draft, prototypeId })}
          protos={protos}
          onTask={() => {
            setSetup(null);
            addBlock('task');
          }}
          onAdd={(kind) => {
            setSetup(null);
            addBlock(kind);
          }}
          onAi={() => {
            setSetup(null);
            setAiOpen(true);
          }}
          onSkip={() => setSetup(null)}
        />
      ) : (
      <ShowErrorsContext.Provider value={showAllErrors}>
        <div className="grid items-start gap-8 lg:grid-cols-[15rem_minmax(0,1fr)] studio:grid-cols-[15rem_minmax(0,1fr)_22rem]">
          <div className="min-w-0 max-lg:order-1 lg:row-span-2 studio:row-span-1 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto lg:p-1 lg:-m-1">
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

          <div ref={editorBox} className="max-lg:order-3 min-w-0 scroll-mt-4 space-y-4 lg:col-start-2 lg:row-start-2 studio:row-start-1" key={current}>
            {!wide && (
              <div className="flex justify-end">
                <Button type="button" variant="outline" size="sm" aria-expanded={phoneOpen || mode !== null} onClick={() => (phoneOpen ? setPhoneOpen(false) : showPhone())} disabled={mode !== null}>
                  <Smartphone /> {phoneOpen || mode !== null ? 'Ocultar prototipo' : 'Ver prototipo'}
                </Button>
              </div>
            )}
            {wide && recordPanel && <div className="sticky top-6 z-10">{recordPanel}</div>}
            {current === 'settings' && (
              <>
                <SettingsEditor draft={draft} onChange={update} errors={errors} protos={protos} screens={screens} saved={record !== null} />
                {draft.blocks.length === 0 && (
                  <div className="flex flex-col items-start gap-3 border-y border-foreground py-8">
                    <h2 className="type-subsection">Ahora agrega el primer bloque</h2>
                    <p className="max-w-md text-sm text-muted-foreground">Un estudio es una lista de bloques: tareas sobre el prototipo y preguntas para el participante. Lo normal es empezar con una tarea.</p>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <AddBlockMenu onAdd={addBlock}>
                        <Button>
                          <Plus /> Agregar bloque
                        </Button>
                      </AddBlockMenu>
                      <Button variant="outline" onClick={() => setAiOpen(true)}>
                        <ClipboardPaste /> Armar con IA
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

          <div
            ref={phoneBox}
            className={cn(
              'min-w-0 max-lg:order-2 scroll-mt-4 space-y-3 lg:col-start-2 lg:row-start-1 studio:col-start-3 studio:sticky studio:top-6',
              !wide && !phoneOpen && mode === null && 'hidden',
            )}
          >
            {!wide && recordPanel}
            <PhoneFrame
              ref={phone}
              proto={proto}
              screen={wantedScreen}
              screens={screens}
              onMessage={onPhoneMessage}
              highlight={mode !== null}
              banner={
                mode?.type === 'pick' ? (
                  <div className="flex items-center gap-2 border-l-2 border-foreground py-1 pl-4 text-sm">
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
      )}

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
        screens={screens}
        study={tryout ? { ...tryout.study, ...(record ? { id: record.id, createdAt: record.createdAt, updatedAt: record.updatedAt } : {}) } : null}
        startAt={tryout?.startAt}
      />
      <AiDialog open={aiOpen} onOpenChange={setAiOpen} proto={proto} screens={screens} replaces={draft.blocks.length > 0} onApply={applyImported} info={info} demo={IS_DEMO} />
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

/**
 * Estudio nuevo, una decisión por pantalla: qué prototipo, cómo se llama y cómo empezar.
 * Después se abre el constructor con todo lo demás.
 */
function SetupSteps({
  step,
  onStep,
  name,
  onName,
  prototypeId,
  onPrototype,
  protos,
  onTask,
  onAdd,
  onAi,
  onSkip,
}: {
  step: 0 | 1 | 2;
  onStep: (step: 0 | 1 | 2) => void;
  name: string;
  onName: (name: string) => void;
  prototypeId: string;
  onPrototype: (id: string) => void;
  protos: readonly Prototype[];
  onTask: () => void;
  onAdd: (kind: BlockKind) => void;
  onAi: () => void;
  onSkip: () => void;
}) {
  const known = protos.some((p) => p.id === prototypeId);
  const sorted = [...protos].sort((a, b) => b.createdAt - a.createdAt);
  const titles = ['¿Qué prototipo vas a probar?', '¿Cómo se llama el estudio?', '¿Cómo quieres empezar?'];
  return (
    <section aria-labelledby="setup-title" className="mx-auto w-full max-w-xl space-y-8 py-2 sm:py-6">
      <div className="space-y-3">
        <ol className="flex gap-1.5" aria-label={`Paso ${step + 1} de 3`}>
          {[0, 1, 2].map((i) => (
            <li key={i} className={cn('h-0.5 flex-1', i <= step ? 'bg-foreground' : 'bg-border')} />
          ))}
        </ol>
        <p className="type-eyebrow pt-2">
          Paso <span className="mark">{String(step + 1).padStart(2, '0')}</span> de 03
        </p>
        <h2 id="setup-title" className="type-section">
          {titles[step]}
        </h2>
      </div>

      {step === 0 &&
        (protos.length === 0 ? (
          <div className="space-y-4 border-y py-6">
            <p className="text-muted-foreground">Todavía no hay prototipos. Sube tu archivo .html o .zip, o agrega tu sitio por URL, y vuelve aquí.</p>
            <Button asChild>
              <Link to={{ name: 'prototypes' }}>
                Ir a Prototipos
              </Link>
            </Button>
          </div>
        ) : (
          <div role="radiogroup" aria-label="Prototipo" className="border-t">
            {sorted.map((p) => {
              const checked = p.id === prototypeId;
              return (
                <label
                  key={p.id}
                  className={cn(
                    'flex min-h-16 cursor-pointer items-center gap-4 border-b px-1 py-4 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-foreground',
                    checked ? 'bg-card shadow-[inset_3px_0_0_var(--foreground)] pl-4' : 'hover:bg-accent/50',
                  )}
                >
                  <input type="radio" name="setup-proto" className="size-4 shrink-0 accent-[var(--primary)]" checked={checked} onChange={() => onPrototype(p.id)} />
                  <span className="min-w-0 flex-1">
                    <span className={cn('block truncate', checked ? 'font-semibold' : 'font-medium')}>{p.name}</span>
                    <span className="block truncate font-mono text-xs text-muted-foreground">{p.source === 'url' && p.sourceUrl ? p.sourceUrl : p.url}</span>
                  </span>
                </label>
              );
            })}
          </div>
        ))}

      {step === 1 && (
        <div className="space-y-2">
          <label htmlFor="setup-name" className="sr-only">
            Nombre del estudio
          </label>
          <Input
            id="setup-name"
            autoFocus
            className="h-12 text-base"
            value={name}
            maxLength={STUDY_LIMITS.name}
            placeholder="Compra de una planta"
            onChange={(e) => onName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) onStep(2);
            }}
          />
          <p className="text-sm text-muted-foreground">Solo lo ve tu equipo y aparece en la bienvenida.</p>
        </div>
      )}

      {step === 2 && (
        <div className="border-t">
          <SetupChoice icon={<ListChecks />} title="Con una tarea" hint="Lo más común: le pides algo y ves si lo logra." onClick={onTask} />
          <SetupChoice icon={<ClipboardPaste />} title="Armar con IA" hint="Pega lo que una IA escribió y se arman los bloques." onClick={onAi} />
          <AddBlockMenu onAdd={onAdd}>
            <SetupChoice icon={<LayoutList />} title="Con otro tipo de bloque" hint="Una pregunta, un primer clic o una pantalla de contexto." />
          </AddBlockMenu>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-6">
        <div className="flex gap-2">
          {step > 0 && (
            <Button variant="ghost" onClick={() => onStep((step - 1) as 0 | 1)}>
              <ArrowLeft /> Atrás
            </Button>
          )}
          <Button variant="link" className="text-muted-foreground" onClick={onSkip}>
            Saltar y armarlo a mano
          </Button>
        </div>
        {step < 2 && (
          <Button onClick={() => onStep((step + 1) as 1 | 2)} disabled={step === 0 ? !known : !name.trim()}>
            Siguiente <ArrowRight />
          </Button>
        )}
      </div>
    </section>
  );
}

function SetupChoice({ title, hint, ...rest }: { icon?: React.ReactNode; title: string; hint: string } & React.ComponentProps<'button'>) {
  return (
    <button
      type="button"
      {...rest}
      className="group flex min-h-16 w-full cursor-pointer items-center gap-4 border-b px-1 py-4 text-left outline-none transition-colors hover:bg-accent/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground"
    >
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        <span className="block text-sm text-muted-foreground">{hint}</span>
      </span>
      <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
    </button>
  );
}
