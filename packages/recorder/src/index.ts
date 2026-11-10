/**
 * Punto de entrada del recorder. Decide el modo de esta ventana y arranca lo que toca:
 *
 * - record: graba. Con un estudio, solo después del consentimiento y hasta el "¡Gracias!".
 * - preview: el panel solo muestra el prototipo. No hace nada.
 * - demo: el panel observa pantallas y toques (para armar el estudio). No graba.
 * - tryout: corre el estudio completo sin grabar ni enviar nada.
 */

import {
  NEED_STUDY_TIMEOUT_MS,
  PANEL_PATH,
  STUDY_PARAM,
  TRYOUT_PARAM,
  isPanelMessage,
  normalizeStudy,
  type RecorderMessage,
  type StudyRecord,
  type TaptanaEvent,
} from '@taptana/shared';
import { Batcher } from './batcher.js';
import { detectMode, queryParam, readConfig, VERSION, type Mode, type RecorderConfig } from './config.js';
import { batchesToExport, downloadExport } from './export.js';
import { mountLocalButton } from './local-ui.js';
import { maskTyped, watchTyping } from './privacy.js';
import { startRrweb } from './rrweb.js';
import { watchScroll } from './scroll.js';
import { startSensors, type Sensors } from './sensors.js';
import { getBasePath, lastScreen, saveLastScreen, setBasePath, startSession, urlScreen } from './session.js';
import { StudyController, type StudyHost } from './study.js';
import { freshState, isReturn, openStudy, StudyStore } from './study-state.js';
import { StudyUi } from './study-ui.js';
import { shortSelector } from './target.js';
import { HttpTransport, LocalTransport, type Transport } from './transport.js';
import { watchViewport } from './viewport.js';

interface TaptanaGlobal {
  version: string;
  mode: Mode;
  /** Vacíos mientras no se graba (sin consentimiento, vista previa, prueba). */
  sessionId: string;
  pageId: string;
  studyId: string | null;
  /** true mientras esta página está grabando. */
  recording: boolean;
  flush(): Promise<void>;
  pending(): number;
  stop(): void;
}

declare global {
  interface Window {
    __taptana?: TaptanaGlobal;
  }
}

/** Una grabación en curso en esta página. */
interface Recording {
  sessionId: string;
  pageId: string;
  batcher: Batcher;
  sensors: Sensors;
  active: boolean;
  /** Envía lo pendiente y deja de grabar. */
  finish(): void;
  /** Corta en seco, sin enviar nada más. */
  stop(): void;
}

/** Eventos que conviene mandar enseguida: son pocos y son los que cuentan la historia. */
function isUrgent(event: TaptanaEvent): boolean {
  return event.kind === 'taptana' && (event.type === 'navigation' || event.type === 'task' || event.type === 'study' || event.type === 'answer');
}

function startRecording(config: RecorderConfig, study: () => StudyController | null): Recording {
  const stopTyping = watchTyping();
  const ctx = startSession(maskTyped(document.title).slice(0, 200));
  const local = config.transport === 'local' ? new LocalTransport() : null;
  const transport: Transport = local ?? new HttpTransport(config.endpoint);
  const batcher = new Batcher({
    transport,
    prototypeId: config.prototypeId,
    sessionId: ctx.sessionId,
    pageId: ctx.pageId,
    page: ctx.page,
    device: ctx.device,
  });
  const push = (event: TaptanaEvent): void => batcher.push(event, isUrgent(event));

  const stops: Array<() => void> = [stopTyping];
  stops.push(watchViewport(push));
  const sensors = startSensors({
    previous: ctx.previousScreen,
    emit(event) {
      if (event.type === 'navigation') saveLastScreen(event.to);
      push(event);
    },
    onTap: (tap, element) => study()?.onTap(tap, element),
    onScreen: () => study()?.onScreen(),
    onCheck: () => study()?.onCheck(),
  });
  stops.push(() => sensors.stop(), startRrweb(push), watchScroll(push));

  const rec: Recording = {
    sessionId: ctx.sessionId,
    pageId: ctx.pageId,
    batcher,
    sensors,
    active: true,
    finish() {
      if (!rec.active) return;
      rec.active = false;
      sensors.gestures.flush(false);
      for (const stop of stops.splice(0)) stop();
      // Termina de entregar lo pendiente y se apaga sola.
      batcher.close();
    },
    stop() {
      rec.active = false;
      for (const stop of stops.splice(0)) stop();
      batcher.stop();
    },
  };

  // Al esconder o cerrar la página puede no haber otra oportunidad de enviar.
  const onHide = (unloading: boolean): void => {
    if (rec.active) sensors.gestures.flush(unloading);
    batcher.flushFinal();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') onHide(false);
  });
  window.addEventListener('pagehide', () => onHide(true));
  window.addEventListener('online', () => batcher.retryNow());
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted || !rec.active) return;
    // La página volvió del historial tal como quedó. Con un estudio, el estado en memoria ya es
    // viejo (el estudio siguió en otras páginas): se recarga para retomarlo bien.
    if (study()) location.reload();
    else {
      const previous = lastScreen();
      saveLastScreen(sensors.tracker.current);
      sensors.tracker.revisit(previous);
    }
  });

  if (local && config.exportButton) {
    mountLocalButton(async () => {
      await batcher.flush();
      const data = batchesToExport(await local.readSession(ctx.sessionId));
      if (data) downloadExport(data);
    });
  }
  return rec;
}

function setGlobal(mode: Mode, studyId: () => string | null, recording: () => Recording | null): void {
  window.__taptana = {
    version: VERSION,
    mode,
    get sessionId() {
      return recording()?.sessionId ?? '';
    },
    get pageId() {
      return recording()?.pageId ?? '';
    },
    get studyId() {
      return studyId();
    },
    get recording() {
      return recording()?.active ?? false;
    },
    flush: () => recording()?.batcher.flush() ?? Promise.resolve(),
    pending: () => recording()?.batcher.pending ?? 0,
    stop: () => recording()?.stop(),
  };
}

// ── Grabar ──────────────────────────────────────────────────────────────

function runRecord(config: RecorderConfig): void {
  const store = new StudyStore(false);
  const state = openStudy(store);
  let rec: Recording | null = null;
  let controller: StudyController | null = null;
  setGlobal('record', () => state?.studyId ?? null, () => rec);

  if (!state) {
    // Sesión libre: se graba desde que carga la página.
    rec = startRecording(config, () => null);
    return;
  }

  const host: StudyHost = {
    endpoint: config.endpoint,
    tryout: false,
    begin() {
      rec ??= startRecording(config, () => controller);
    },
    emit: (event) => rec?.batcher.push(event, true),
    finish: () => rec?.finish(),
    screen: () => rec?.sensors.tracker.current ?? urlScreen(),
  };
  controller = new StudyController(host, store, new StudyUi(false), state);
  // Ya aceptó en una página anterior: se sigue grabando. En cualquier otro estado (sin aceptar,
  // rechazó, terminó, estudio que no carga) no se crea ni la cola de envío.
  if (state.status === 'active') host.begin();
  void controller.start();
}

// ── Modos del panel ─────────────────────────────────────────────────────

function postToPanel(message: RecorderMessage): void {
  if (window.parent === window) return;
  try {
    window.parent.postMessage(message, '*');
  } catch {
    /* el panel ya no está */
  }
}

/** El panel observa: cada pantalla y cada toque se le avisan. Nada se graba. */
function runDemo(): void {
  setGlobal('demo', () => null, () => null);
  const sensors = startSensors({
    previous: '',
    emit(event) {
      // La carga de la página se avisa con `ready`.
      if (event.type !== 'navigation' || event.via === 'load') return;
      postToPanel({ source: 'taptana', type: 'screen', screen: event.to, title: event.title ?? '', via: event.via });
    },
    onTap(tap, element) {
      postToPanel({ source: 'taptana', type: 'tap', screen: sensors.tracker.current, x: tap.x, y: tap.y, target: { ...tap.target }, selector: shortSelector(element) });
    },
  });
  postToPanel({ source: 'taptana', type: 'ready', screen: sensors.tracker.current, title: sensors.tracker.title });
}

/**
 * ¿Esta página es la entrada a una prueba (y no una página siguiente de la misma)? Lo es si se
 * abrió el link de prueba, o si el panel acaba de cargar el prototipo en su iframe.
 */
function isTryoutEntry(): boolean {
  if (isReturn()) return false;
  if (queryParam(TRYOUT_PARAM) !== null || queryParam(STUDY_PARAM) !== null) return true;
  if (window.parent === window) return false;
  if (!document.referrer) return true;
  try {
    const from = new URL(document.referrer);
    if (from.origin !== location.origin) return true;
    if (from.pathname === PANEL_PATH || from.pathname.startsWith(`${PANEL_PATH}/`)) return true;
    const base = getBasePath();
    return base !== '' && from.pathname !== base && !from.pathname.startsWith(`${base}/`);
  } catch {
    return true;
  }
}

/** El estudio que manda el panel puede ser un borrador sin guardar (sin id). */
function draftStudy(raw: StudyRecord): StudyRecord | null {
  try {
    const now = Date.now();
    return normalizeStudy({ ...raw, id: raw.id || 'borrador', createdAt: raw.createdAt ?? now, updatedAt: raw.updatedAt ?? now });
  } catch {
    return null;
  }
}

/** Prueba del estudio completo: misma interfaz y mismas reglas, sin grabar ni enviar nada. */
function runTryout(config: RecorderConfig): void {
  const store = new StudyStore(true);
  const ui = new StudyUi(true);
  ui.mount();
  let controller: StudyController | null = null;
  setGlobal('tryout', () => controller?.studyId ?? null, () => null);

  const sensors = startSensors({
    previous: '',
    emit() {
      /* en la prueba nada se guarda */
    },
    onTap: (tap, element) => controller?.onTap(tap, element),
    onScreen: () => controller?.onScreen(),
    onCheck: () => controller?.onCheck(),
  });
  const host: StudyHost = {
    endpoint: config.endpoint,
    tryout: true,
    begin() {},
    emit() {},
    finish() {},
    screen: () => sensors.tracker.current,
    notify(event, blockId) {
      postToPanel(blockId ? { source: 'taptana', type: 'tryout', event, blockId } : { source: 'taptana', type: 'tryout', event });
    },
  };

  // El panel puede mandar el estudio (el borrador) en cualquier momento: la prueba empieza con él.
  window.addEventListener('message', (e) => {
    if (window.parent === window || e.source !== window.parent || !isPanelMessage(e.data)) return;
    const study = draftStudy(e.data.study);
    if (!study) return;
    controller ??= new StudyController(host, store, ui, freshState(study.id), study);
    controller.load(study, e.data.startAt);
  });
  postToPanel({ source: 'taptana', type: 'ready', screen: sensors.tracker.current, title: sensors.tracker.title });

  // Una página siguiente de la misma prueba continúa donde iba.
  const saved = isTryoutEntry() ? null : store.read();
  const savedStudy = saved ? store.readStudy(saved.studyId) : null;
  if (saved && savedStudy) {
    controller = new StudyController(host, store, ui, saved, savedStudy);
    void controller.start();
    return;
  }

  store.clear();
  postToPanel({ source: 'taptana', type: 'need-study' });
  // Si el panel no responde (o no hay panel), el estudio se baja de la API.
  window.setTimeout(
    () => {
      const id = queryParam(STUDY_PARAM);
      if (controller || !id) return;
      const state = freshState(id);
      store.write(state);
      controller = new StudyController(host, store, ui, state);
      void controller.start();
    },
    window.parent === window ? 0 : NEED_STUDY_TIMEOUT_MS,
  );
}

function main(): void {
  if (window.__taptana) return; // ya está corriendo (script duplicado)
  const mode = detectMode();
  if (mode === 'preview') return;
  const config = readConfig();
  setBasePath(config.base);

  const run = (): void => {
    if (window.__taptana) return;
    if (mode === 'demo') runDemo();
    else if (mode === 'tryout') runTryout(config);
    else runRecord(config);
  };
  // El script suele ir al final del <body>. Si lo pegaron en el <head>, se espera al documento.
  if (document.body) run();
  else document.addEventListener('DOMContentLoaded', run, { once: true });
}

main();
