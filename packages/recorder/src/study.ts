/**
 * El estudio desde el lado del participante, bloque por bloque.
 *
 * - Bienvenida con consentimiento. Hasta aceptar, nada se graba; si rechaza, tampoco después.
 * - Tareas: lleva a la pantalla de inicio, muestra la instrucción, y al tocar "Empezar tarea"
 *   deja una píldora pequeña. Vigila la regla de éxito y emite `goal` cuando se cumple.
 * - Preguntas y bloques de contexto en hojas.
 * - Al final agradece, emite `study finish` y apaga la grabación.
 *
 * Esta clase decide qué mostrar y cuándo; el dibujo está en study-ui.ts y el estado (que
 * sobrevive a recargas y navegación) en study-state.ts.
 */

import {
  API_PREFIX,
  DEFAULT_CONSENT_TEXT,
  DEFAULT_THANKS_TEXT,
  FIRST_CLICK_REACH_MS,
  GESTURE_THRESHOLDS,
  REQUEST_TIMEOUT_MS,
  SESSION_LIMITS,
  STUDY_PARAM,
  isContextBlock,
  isQuestionBlock,
  isTaskBlock,
  normalizeStudy,
  sameScreen,
  screenParts,
  screenUrl,
  tapMatches,
  taskBlocks,
  type AnswerValue,
  type QuestionBlock,
  type StudyEvent,
  type StudyRecord,
  type SuccessRule,
  type TapEvent,
  type TaptanaOwnEvent,
  type TaskBlock,
  type TaskEvent,
} from '@taptana/shared';
import { queryParam } from './config.js';
import { isOurs, isShown } from './screens.js';
import { urlScreen, withBase } from './session.js';
import { freshState, persistSilence, resetBlock, type StudyState, type StudyStore } from './study-state.js';
import type { Step, StudyUi } from './study-ui.js';

/** Cuánto se ve "¡Listo!" antes de pasar al siguiente bloque. */
const AUTO_DONE_MS = 900;
/** Margen para dar por bueno un cambio de pantalla después del primer toque. */
const REACH_SLACK_MS = 300;

/** Lo que el estudio necesita del resto del recorder. */
export interface StudyHost {
  /** Origen del servidor, sin barra final. */
  endpoint: string;
  /** Prueba sin grabar: nada se emite ni se envía. */
  tryout: boolean;
  /** El participante aceptó: empezar a grabar. */
  begin(): void;
  emit(event: TaptanaOwnEvent): void;
  /** Fin del estudio: enviar lo pendiente y dejar de grabar. */
  finish(): void;
  /** ScreenId de la pantalla que el participante tiene delante. */
  screen(): string;
  /** Aviso al panel (solo en la prueba sin grabar). */
  notify?(event: 'block' | 'finish', blockId?: string): void;
}

type Loaded = StudyRecord | 'closed' | null;

/** Baja el estudio de la API. `null`: no existe o no hay conexión. */
async function fetchStudy(endpoint: string, id: string): Promise<Loaded> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${endpoint}${API_PREFIX}/studies/${encodeURIComponent(id)}`, { credentials: 'omit', signal: abort.signal });
    if (!res.ok) return null;
    const raw = (await res.json()) as Partial<StudyRecord> | null;
    if (!raw || typeof raw !== 'object' || (!Array.isArray(raw.blocks) && !Array.isArray((raw as { tasks?: unknown }).tasks))) return null;
    const study = normalizeStudy({ ...(raw as StudyRecord), id: typeof raw.id === 'string' && raw.id ? raw.id : id });
    return study.closed ? 'closed' : study;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function flat(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Regla `visible`: hay un elemento que se ve y/o un texto a la vista (sin distinguir mayúsculas). */
export function ruleVisible(rule: Extract<SuccessRule, { type: 'visible' }>): boolean {
  const text = rule.text ? flat(rule.text) : '';
  const selector = rule.selector?.trim();
  if (selector) {
    let found: NodeListOf<Element>;
    try {
      found = document.querySelectorAll(selector);
    } catch {
      return false;
    }
    for (const el of found) {
      if (isOurs(el) || !isShown(el)) continue;
      if (!text || flat(el instanceof HTMLElement ? el.innerText : (el.textContent ?? '')).includes(text)) return true;
    }
    return false;
  }
  return text !== '' && flat(document.body?.innerText ?? '').includes(text);
}

/** ¿El toque cayó en lo que pide el selector? Con el DOM delante vale cualquier selector CSS. */
function tapHits(element: Element, tap: TapEvent, selector: string): boolean {
  try {
    if (element.closest(selector)) return true;
  } catch {
    /* selector que el navegador no entiende: queda la comparación simple */
  }
  return tapMatches(tap, selector);
}

export class StudyController {
  private study: StudyRecord | null = null;
  private timer: number | undefined;

  constructor(
    private readonly host: StudyHost,
    private readonly store: StudyStore,
    private readonly ui: StudyUi,
    private state: StudyState,
    preloaded?: StudyRecord,
  ) {
    this.study = preloaded ?? null;
    // Se registra antes que el envío final de la grabación: la respuesta alcanza a salir.
    window.addEventListener('pagehide', () => this.keepDraft());
  }

  get studyId(): string {
    return this.state.studyId;
  }

  /** Muestra lo que toque según el estado guardado. */
  async start(): Promise<void> {
    const state = this.state;
    if (state.status === 'declined' || state.status === 'finished') {
      // Solo se recuerda en la página del link (al recargarla); el resto del prototipo queda libre.
      if (queryParam(STUDY_PARAM) === null && !this.host.tryout) return;
      if (state.status === 'declined') this.showDeclined();
      else {
        this.study ??= this.store.readStudy(state.studyId);
        this.showThanks();
      }
      return;
    }
    // A media sesión se sigue con la versión del estudio con la que se empezó.
    if (!this.study && state.status === 'active') this.study = this.store.readStudy(state.studyId);
    if (!this.study) {
      this.ui.waiting();
      const loaded = await fetchStudy(this.host.endpoint, state.studyId);
      if (loaded === 'closed') {
        this.ui.notice({ tone: 'calm', title: 'Este estudio ya no recibe respuestas', text: 'Gracias por tu interés. Puedes cerrar esta página.' });
        return;
      }
      if (!loaded) {
        this.ui.notice(
          {
            tone: 'warn',
            title: 'No pudimos cargar el estudio',
            text: 'Revisa tu conexión y vuelve a intentarlo. Si sigue sin abrir, pide el link de nuevo a quien te lo compartió. No se está grabando nada.',
            action: 'Reintentar',
            primary: true,
          },
          () => void this.start(),
        );
        return;
      }
      this.study = loaded;
      this.store.writeStudy(loaded);
    }
    this.resume();
  }

  /** Prueba sin grabar: empieza de cero con este estudio, opcionalmente en un bloque. */
  load(study: StudyRecord, startAt?: string): void {
    this.cancel();
    this.ui.clear();
    this.study = study;
    this.state = freshState(study.id);
    const at = startAt ? study.blocks.findIndex((b) => b.id === startAt) : -1;
    if (at !== -1) {
      this.state.status = 'active';
      this.state.announced = true;
      this.state.index = at;
    }
    this.store.clear();
    this.store.write(this.state);
    this.store.writeStudy(study);
    this.resume();
  }

  /** Un toque en el prototipo (no en nuestra interfaz). */
  onTap(tap: TapEvent, element: Element): void {
    const block = this.runningTask();
    if (!block) return;
    const rule = block.success;
    if (block.kind === 'first-click') {
      if (this.state.tapAt) return;
      this.state.tapAt = tap.t;
      if (rule.type === 'tapped' && tapHits(element, tap, rule.selector)) this.markGoal(block);
      this.emitTask(block, 'done', true);
      // Con regla "llega a una pantalla" se espera a ver a dónde lleva el toque.
      this.close(rule.type === 'reached' ? FIRST_CLICK_REACH_MS : AUTO_DONE_MS, 'Toque registrado');
      return;
    }
    if (rule.type === 'tapped' && tapHits(element, tap, rule.selector)) this.goal(block);
  }

  /** Cambió la pantalla. */
  onScreen(): void {
    this.checkGoal();
  }

  /** Terminó una revisión del DOM. */
  onCheck(): void {
    this.checkGoal();
  }

  // ── Flujo ───────────────────────────────────────────────────────────

  private resume(): void {
    if (!this.study) return;
    if (this.state.status === 'new') {
      this.showWelcome(this.study);
      return;
    }
    if (!this.state.announced) this.announce(this.study);
    this.enterBlock();
  }

  private showWelcome(study: StudyRecord): void {
    this.ui.welcome(
      {
        name: study.name,
        text: study.welcome?.trim() ?? '',
        consent: study.consent?.trim() || DEFAULT_CONSENT_TEXT,
        steps: study.blocks.length,
        askName: study.settings?.askName === true,
      },
      { onStart: (name) => this.consent(study, name), onDecline: () => this.decline() },
    );
  }

  private consent(study: StudyRecord, name: string): void {
    const state = this.state;
    if (state.status !== 'new') return;
    state.status = 'active';
    if (name) state.participant = name.slice(0, SESSION_LIMITS.participant);
    const variants = study.variants ?? [];
    const pick = variants[Math.floor(Math.random() * variants.length)];
    if (pick) state.variantId = pick.id;
    this.save();
    this.store.writeStudy(study);
    this.host.begin();
    this.announce(study);
    this.enterBlock();
  }

  private announce(study: StudyRecord): void {
    const state = this.state;
    const event: StudyEvent = { kind: 'taptana', type: 'study', t: Date.now(), studyId: study.id, action: 'start' };
    if (state.variantId) event.variantId = state.variantId;
    if (state.participant) event.participant = state.participant;
    this.host.emit(event);
    state.announced = true;
    this.save();
  }

  private decline(): void {
    if (this.state.status !== 'new') return;
    this.state.status = 'declined';
    persistSilence(this.store, this.state);
    this.showDeclined();
  }

  private showDeclined(): void {
    this.ui.notice(
      { tone: 'calm', title: 'Gracias igual', text: 'No se grabó nada y no se grabará nada en esta pestaña. Puedes cerrar esta página.', action: 'Cerrar' },
      () => this.ui.clear(),
    );
  }

  private showThanks(): void {
    this.ui.clear();
    const text = this.study?.thanks?.trim() || DEFAULT_THANKS_TEXT;
    const study = this.study;
    if (this.host.tryout && study) {
      this.ui.notice({ tone: 'ok', title: '¡Gracias!', text, action: 'Probar de nuevo' }, () => this.load(study));
    } else {
      this.ui.notice({ tone: 'ok', title: '¡Gracias!', text });
    }
  }

  private finish(): void {
    const state = this.state;
    if (state.status !== 'finished') {
      state.status = 'finished';
      persistSilence(this.store, state);
      this.host.emit({ kind: 'taptana', type: 'study', t: Date.now(), studyId: state.studyId, action: 'finish' });
      this.host.finish();
      this.host.notify?.('finish');
    }
    this.showThanks();
  }

  private enterBlock(): void {
    const study = this.study;
    if (!study) return;
    const state = this.state;
    const block = study.blocks[state.index];
    if (!block) {
      this.finish();
      return;
    }
    this.host.notify?.('block', block.id);
    const step: Step = { n: state.index + 1, total: study.blocks.length };
    if (isTaskBlock(block)) {
      this.enterTask(study, block, step);
      return;
    }
    this.ui.hidePill();
    if (!state.shownAt) {
      state.shownAt = Date.now();
      this.save();
    }
    if (isContextBlock(block)) this.ui.context({ step, title: block.title, text: block.text }, () => this.advance());
    else {
      const draft = state.draft && state.draft.blockId === block.id ? state.draft.value : null;
      this.ui.question(
        { step, block, initial: draft },
        (value) => this.answer(block, value),
        (value) => {
          // Lo elegido se guarda al momento: sobrevive a una recarga y a cerrar la página.
          state.draft = { blockId: block.id, value };
          this.save();
        },
      );
    }
  }

  /**
   * La página se va (recarga, cierre, otra dirección) con una pregunta a medio responder: lo
   * que ya estaba elegido se guarda como respuesta, para no perder un "Sí" sin "Continuar". Si
   * el participante vuelve, la pregunta sigue ahí con su elección y lo que confirme la reemplaza.
   */
  private keepDraft(): void {
    const state = this.state;
    const block = this.study?.blocks[state.index];
    const draft = state.draft;
    if (state.status !== 'active' || !block || !isQuestionBlock(block) || !draft || draft.blockId !== block.id) return;
    const value = typeof draft.value === 'string' ? draft.value.trim() : draft.value;
    if (value === null || value === '' || (Array.isArray(value) && value.length === 0)) return;
    const now = Date.now();
    this.host.emit({ kind: 'taptana', type: 'answer', t: now, blockId: block.id, value, durationMs: Math.max(0, now - (state.shownAt ?? now)) });
  }

  private answer(block: QuestionBlock, value: AnswerValue): void {
    const now = Date.now();
    this.host.emit({
      kind: 'taptana',
      type: 'answer',
      t: now,
      blockId: block.id,
      value,
      durationMs: Math.max(0, now - (this.state.shownAt ?? now)),
    });
    this.advance();
  }

  private advance(): void {
    this.cancel();
    this.ui.hideToast();
    resetBlock(this.state, this.state.index + 1);
    this.save();
    this.enterBlock();
  }

  // ── Tareas ──────────────────────────────────────────────────────────

  private enterTask(study: StudyRecord, block: TaskBlock, step: Step): void {
    const state = this.state;
    if (state.phase === 'intro') {
      this.ui.hidePill();
      if (this.moveToStart(study, block)) return;
      this.ui.intro({ step, instruction: block.instruction, firstClick: block.kind === 'first-click' }, () => this.startTask(block, step));
      return;
    }
    if (state.phase === 'closing') {
      // La página cambió mientras se cerraba el bloque: se termina la espera aquí.
      this.checkGoal();
      this.later(() => this.advance(), Math.max(0, (state.closeAt ?? 0) - Date.now()));
      return;
    }
    this.showPill(block, step);
    this.checkGoal();
  }

  /**
   * Lleva al participante a la pantalla de inicio del bloque. Devuelve true si la página se va
   * a recargar (la siguiente página continúa). Una ruta por hash en la misma página no recarga.
   */
  private moveToStart(study: StudyRecord, block: TaskBlock): boolean {
    const state = this.state;
    let startPath = block.startPath;
    if (!startPath && state.variantId && taskBlocks(study)[0] === block) {
      startPath = study.variants?.find((v) => v.id === state.variantId)?.startPath;
    }
    if (!startPath || state.movedFor === block.id) return false;
    const here = urlScreen();
    if (sameScreen(screenUrl(startPath), here)) return false;
    // Se anota antes de moverse: si la pantalla no existe, no se intenta en bucle.
    state.movedFor = block.id;
    this.save();
    const target = screenParts(startPath);
    if (target.hash && sameScreen(target.path, screenParts(here).path)) {
      location.hash = target.hash;
      return false;
    }
    // "/carpeta/index.html" se pide como "/carpeta/": cualquier servidor lo entiende y un router
    // de History reconoce su ruta de inicio.
    const path = target.path.replace(/\/index\.html$/, '/');
    location.assign(withBase(path) + (target.hash ?? ''));
    return true;
  }

  private startTask(block: TaskBlock, step: Step): void {
    const state = this.state;
    if (state.phase !== 'intro') return;
    state.phase = 'run';
    state.startedAt = Date.now();
    delete state.goalAt;
    delete state.tapAt;
    // Si la meta ya está a la vista al empezar, no cuenta hasta que deje de estarlo y vuelva.
    state.armed = !this.ruleHolds(block.success);
    this.emitTask(block, 'start');
    this.save();
    this.ui.closeSheet(true);
    this.showPill(block, step);
  }

  private showPill(block: TaskBlock, step: Step): void {
    const state = this.state;
    this.ui.pill(
      { position: state.pill, hint: !state.hinted },
      {
        onOpen: () => this.openInstruction(block, step),
        onMove: (position) => {
          state.pill = position;
          this.save();
        },
      },
    );
    if (!state.hinted) {
      state.hinted = true;
      this.save();
    }
  }

  private openInstruction(block: TaskBlock, step: Step): void {
    if (this.state.phase !== 'run') return;
    this.ui.hidePill();
    this.ui.instruction(
      { step, instruction: block.instruction, firstClick: block.kind === 'first-click' },
      {
        onDone: () => this.complete(block, 'done'),
        onSkip: () => this.complete(block, 'skip'),
        onClose: () => {
          this.ui.closeSheet(true);
          if (this.state.phase === 'run') this.showPill(block, step);
        },
      },
    );
  }

  /** La tarea en curso, si el participante ya tocó "Empezar tarea" y no se ha cerrado. */
  private runningTask(): TaskBlock | null {
    const state = this.state;
    if (state.status !== 'active' || state.phase !== 'run') return null;
    const block = this.study?.blocks[state.index];
    return block && isTaskBlock(block) ? block : null;
  }

  /** Reglas que dependen de lo que hay en pantalla: `reached` y `visible`. */
  private ruleHolds(rule: SuccessRule): boolean {
    if (rule.type === 'reached') return sameScreen(rule.path, this.host.screen());
    if (rule.type === 'visible') return ruleVisible(rule);
    return false;
  }

  private checkGoal(): void {
    const state = this.state;
    if (state.status !== 'active' || state.goalAt) return;
    const block = this.study?.blocks[state.index];
    if (!block || !isTaskBlock(block)) return;
    const rule = block.success;

    if (block.kind === 'first-click') {
      // Primer clic con "llega a una pantalla": vale si el toque lleva ahí en los 2 s siguientes.
      if (rule.type !== 'reached' || !state.tapAt || state.phase === 'intro') return;
      if (Date.now() > state.tapAt + FIRST_CLICK_REACH_MS + REACH_SLACK_MS) return;
      if (!sameScreen(rule.path, this.host.screen())) return;
      this.markGoal(block);
      // Ya se sabe a dónde llevó: no hace falta esperar más.
      if (state.phase === 'closing') {
        state.closeAt = Math.min(state.closeAt ?? Infinity, Date.now() + GESTURE_THRESHOLDS.tapEffectMs);
        this.save();
        this.later(() => this.advance(), Math.max(0, state.closeAt - Date.now()));
      }
      return;
    }

    if (state.phase !== 'run' || (rule.type !== 'reached' && rule.type !== 'visible')) return;
    if (!this.ruleHolds(rule)) {
      if (!state.armed) {
        state.armed = true;
        this.save();
      }
      return;
    }
    if (state.armed) this.goal(block);
  }

  /** Anota que la regla se cumplió y emite `goal`. */
  private markGoal(block: TaskBlock): void {
    const state = this.state;
    if (state.goalAt) return;
    state.goalAt = Date.now();
    this.emitTask(block, 'goal');
    this.save();
  }

  /** La regla se cumplió en una tarea normal: con avance automático, la tarea termina sola. */
  private goal(block: TaskBlock): void {
    if (this.state.goalAt || this.state.phase !== 'run') return;
    this.markGoal(block);
    if (this.study?.settings?.advance === 'manual') return;
    this.emitTask(block, 'done', true);
    this.close(AUTO_DONE_MS, '¡Listo!');
  }

  /** "Listo, terminé" o "No pude". */
  private complete(block: TaskBlock, action: 'done' | 'skip'): void {
    // Un segundo toque (doble toque) ya encuentra la tarea cerrada.
    if (this.state.phase !== 'run') return;
    this.emitTask(block, action);
    this.close(GESTURE_THRESHOLDS.tapEffectMs);
  }

  /**
   * Cierra la tarea y espera un momento antes del siguiente bloque: si el toque que la cerró
   * también hace algo en el prototipo (un enlace), el clic le llega a él y no a nuestra hoja.
   */
  private close(delay: number, toast?: string): void {
    // Solo si la cerró un botón nuestro hace falta el escudo contra el doble toque. Si la cerró
    // un toque en el prototipo, su clic todavía está por llegar y no debe caer en nuestra capa.
    const ours = toast === undefined;
    const state = this.state;
    state.phase = 'closing';
    state.closeAt = Date.now() + delay;
    this.save();
    this.ui.hidePill();
    this.ui.closeSheet(ours);
    if (toast) this.ui.toast(toast);
    this.later(() => this.advance(), delay);
  }

  private emitTask(block: TaskBlock, action: TaskEvent['action'], auto = false): void {
    const event: TaskEvent = { kind: 'taptana', type: 'task', t: Date.now(), taskId: block.id, action };
    if (auto) event.auto = true;
    this.host.emit(event);
  }

  // ── Interno ─────────────────────────────────────────────────────────

  private save(): void {
    this.store.write(this.state);
  }

  private later(fn: () => void, ms: number): void {
    this.cancel();
    this.timer = window.setTimeout(() => {
      this.timer = undefined;
      fn();
    }, ms);
  }

  private cancel(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
