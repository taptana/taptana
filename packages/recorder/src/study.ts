/**
 * El estudio desde el lado del participante.
 *
 * - Lee `?study=<id>` en la primera página y lo guarda en sessionStorage.
 * - Pide el estudio a la API y muestra: bienvenida + consentimiento, barra de tarea con
 *   "Listo" / "No pude", y "Gracias" al final.
 * - Emite los eventos `study` y `task`. Hasta el consentimiento, nada sale del celular.
 * - Si el estudio tiene variantes (A/B), asigna una al azar y la guarda en la sesión.
 */

import {
  API_PREFIX,
  DEFAULT_CONSENT_TEXT,
  type StudyEvent,
  type StudyRecord,
  type TapEvent,
  type TaptanaEvent,
  type Task,
  type TaskEvent,
} from '@taptana/shared';
import { currentPath } from './session.js';

const KEY_STATE = 'taptana:study';
const KEY_DATA = 'taptana:studyData';

interface StudyState {
  studyId: string;
  consented: boolean;
  declined: boolean;
  variantId?: string;
  taskIndex: number;
  /** El evento `start` de la tarea actual ya se emitió (sobrevive a la navegación). */
  taskStarted: boolean;
  /** En first-click: el participante ya leyó la instrucción y el próximo toque cierra la tarea. */
  armed: boolean;
  finished: boolean;
}

function readState(): StudyState | null {
  try {
    const raw = sessionStorage.getItem(KEY_STATE);
    return raw ? (JSON.parse(raw) as StudyState) : null;
  } catch {
    return null;
  }
}

function writeState(state: StudyState): void {
  try {
    sessionStorage.setItem(KEY_STATE, JSON.stringify(state));
  } catch {
    /* sin storage: el estudio dura una página */
  }
}

/**
 * Decide si esta página forma parte de un estudio. Se llama antes de crear el batcher,
 * para saber si hay que retener los eventos hasta el consentimiento.
 */
export function detectStudy(): StudyState | null {
  let fromUrl: string | null = null;
  try {
    fromUrl = new URLSearchParams(location.search).get('study');
  } catch {
    /* nada */
  }
  const saved = readState();
  if (fromUrl && (!saved || saved.studyId !== fromUrl)) {
    const fresh: StudyState = { studyId: fromUrl, consented: false, declined: false, taskIndex: 0, taskStarted: false, armed: false, finished: false };
    writeState(fresh);
    try {
      sessionStorage.removeItem(KEY_DATA);
    } catch {
      /* nada */
    }
    return fresh;
  }
  return saved;
}

export interface StudyControllerOptions {
  endpoint: string;
  state: StudyState;
  emit: (event: TaptanaEvent) => void;
  /** Libera los eventos retenidos (consentimiento dado). */
  onConsent: () => void;
  /** Tira todo y deja de grabar (consentimiento negado). */
  onDecline: () => void;
  /** Manda lo pendiente ahora (fin del estudio). */
  onFinish: () => void;
}

export class StudyController {
  private study: StudyRecord | null = null;
  private state: StudyState;
  private host: HTMLElement | null = null;
  private root: ShadowRoot | null = null;

  constructor(private readonly opts: StudyControllerOptions) {
    this.state = opts.state;
  }

  async start(): Promise<void> {
    this.study = await this.loadStudy();
    if (!this.study) {
      // Sin estudio no hay por qué retener nada.
      this.opts.onConsent();
      return;
    }
    this.mount();
    if (this.state.declined) return this.renderDeclined();
    if (!this.state.consented) return this.renderWelcome();
    if (this.state.finished) return this.renderThanks();
    if (!this.state.taskStarted) this.startTask();
    else this.renderTask();
  }

  /** Llamado por el recorder con cada toque en el prototipo (no en nuestra interfaz). */
  onTap(tap: TapEvent): void {
    if (!this.study || !this.state.consented || this.state.finished || !this.state.armed) return;
    const task = this.currentTask();
    if (!task || (task.kind ?? 'task') !== 'first-click') return;
    void tap;
    this.completeTask('done');
  }

  // ── Datos ─────────────────────────────────────────────────────────

  private async loadStudy(): Promise<StudyRecord | null> {
    try {
      const cached = sessionStorage.getItem(KEY_DATA);
      if (cached) return JSON.parse(cached) as StudyRecord;
    } catch {
      /* seguimos */
    }
    try {
      const res = await fetch(`${this.opts.endpoint}${API_PREFIX}/studies/${encodeURIComponent(this.state.studyId)}`, { credentials: 'omit' });
      if (!res.ok) return null;
      const study = (await res.json()) as StudyRecord;
      try {
        sessionStorage.setItem(KEY_DATA, JSON.stringify(study));
      } catch {
        /* nada */
      }
      return study;
    } catch {
      return null;
    }
  }

  private save(): void {
    writeState(this.state);
  }

  private currentTask(): Task | null {
    return this.study?.tasks[this.state.taskIndex] ?? null;
  }

  // ── Flujo ─────────────────────────────────────────────────────────

  private consent(): void {
    if (!this.study) return;
    this.state.consented = true;
    const variants = this.study.variants ?? [];
    if (variants.length > 0) {
      const pick = variants[Math.floor(Math.random() * variants.length)];
      if (pick) this.state.variantId = pick.id;
    }
    this.save();
    const ev: StudyEvent = { kind: 'taptana', type: 'study', t: Date.now(), studyId: this.study.id, action: 'start' };
    if (this.state.variantId) ev.variantId = this.state.variantId;
    this.opts.emit(ev);
    this.opts.onConsent();
    this.startTask();
  }

  private decline(): void {
    this.state.declined = true;
    this.save();
    this.opts.onDecline();
    this.renderDeclined();
  }

  private startTask(): void {
    const task = this.currentTask();
    if (!this.study || !task) return this.finish();
    const ev: TaskEvent = { kind: 'taptana', type: 'task', t: Date.now(), taskId: task.id, action: 'start' };
    this.opts.emit(ev);
    this.state.taskStarted = true;
    this.state.armed = false;
    this.save();

    // ¿Hay que llevar al participante a otra página?
    let startPath = task.startPath;
    if (this.state.taskIndex === 0 && !startPath && this.state.variantId) {
      startPath = this.study.variants?.find((v) => v.id === this.state.variantId)?.startPath;
    }
    if (startPath && !samePath(startPath, currentPath())) {
      location.assign(startPath);
      return;
    }
    this.renderTask();
  }

  private completeTask(action: 'done' | 'skip'): void {
    const task = this.currentTask();
    if (!task) return;
    this.opts.emit({ kind: 'taptana', type: 'task', t: Date.now(), taskId: task.id, action });
    this.state.taskIndex += 1;
    this.state.taskStarted = false;
    this.state.armed = false;
    this.save();
    if (this.state.taskIndex >= (this.study?.tasks.length ?? 0)) return this.finish();
    this.toast(action === 'done' ? 'Listo. Siguiente tarea.' : 'Ok, pasamos a la siguiente.');
    // Un respiro antes de redibujar: si este toque también navega (un enlace), el clic debe
    // llegar al prototipo y no a nuestra barra recién dibujada. Si la página cambia antes,
    // la siguiente página arranca la tarea al cargar (taskStarted sigue en false).
    window.setTimeout(() => {
      if (!this.state.taskStarted && !this.state.finished) this.startTask();
    }, 350);
  }

  private finish(): void {
    if (!this.study) return;
    if (!this.state.finished) {
      this.state.finished = true;
      this.save();
      this.opts.emit({ kind: 'taptana', type: 'study', t: Date.now(), studyId: this.study.id, action: 'finish' });
      this.opts.onFinish();
    }
    this.renderThanks();
  }

  // ── Interfaz ──────────────────────────────────────────────────────

  private mount(): void {
    if (this.host) return;
    const host = document.createElement('div');
    host.className = 'rr-block';
    host.setAttribute('data-taptana-ui', 'study');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style><div id="ui"></div>`;
    const append = (): void => {
      document.body.appendChild(host);
    };
    if (document.body) append();
    else document.addEventListener('DOMContentLoaded', append);
    this.host = host;
    this.root = root;
  }

  private ui(): HTMLElement {
    return this.root!.getElementById('ui')!;
  }

  private renderWelcome(): void {
    if (!this.study) return;
    const consentText = this.study.consent?.trim() || DEFAULT_CONSENT_TEXT;
    const n = this.study.tasks.length;
    this.ui().innerHTML = `
      <div class="backdrop"></div>
      <div class="sheet" role="dialog" aria-labelledby="t">
        <p class="eyebrow">Prueba de usabilidad</p>
        <h1 id="t">${esc(this.study.name)}</h1>
        ${this.study.welcome ? `<p class="body">${esc(this.study.welcome)}</p>` : ''}
        <p class="muted">${n} tarea${n === 1 ? '' : 's'}. No hay respuestas correctas ni incorrectas: queremos ver cómo se usa el prototipo.</p>
        <label class="consent"><input type="checkbox" id="ok"> <span>${esc(consentText)}</span></label>
        <button class="btn primary" id="go" disabled>Empezar</button>
        <button class="btn ghost" id="no">Prefiero no participar</button>
      </div>`;
    const ok = this.root!.getElementById('ok') as HTMLInputElement;
    const go = this.root!.getElementById('go') as HTMLButtonElement;
    ok.addEventListener('change', () => {
      go.disabled = !ok.checked;
    });
    go.addEventListener('click', () => this.consent());
    this.root!.getElementById('no')!.addEventListener('click', () => this.decline());
  }

  private renderDeclined(): void {
    this.ui().innerHTML = `
      <div class="backdrop"></div>
      <div class="sheet">
        <h1>Gracias igual</h1>
        <p class="body">No se grabó nada. Puedes cerrar esta página.</p>
      </div>`;
  }

  private renderThanks(): void {
    this.ui().innerHTML = `
      <div class="backdrop"></div>
      <div class="sheet">
        <p class="eyebrow">Terminaste</p>
        <h1>¡Gracias!</h1>
        <p class="body">Eso era todo. Puedes cerrar esta página.</p>
      </div>`;
  }

  private renderTask(): void {
    const task = this.currentTask();
    if (!this.study || !task) return;
    const n = this.study.tasks.length;
    const i = this.state.taskIndex + 1;
    const firstClick = (task.kind ?? 'task') === 'first-click';

    if (firstClick && !this.state.armed) {
      // Primero la instrucción a pantalla completa; al tocar "Entendido", el próximo toque cuenta.
      this.ui().innerHTML = `
        <div class="backdrop"></div>
        <div class="sheet">
          <p class="eyebrow">Tarea ${i} de ${n}</p>
          <h1>${esc(task.instruction)}</h1>
          <p class="muted">Cuando toques "Entendido", toca en el prototipo el lugar donde irías. Solo cuenta el primer toque.</p>
          <button class="btn primary" id="armed">Entendido</button>
        </div>`;
      this.root!.getElementById('armed')!.addEventListener('click', () => {
        this.state.armed = true;
        this.save();
        this.renderTask();
      });
      return;
    }

    if (firstClick) {
      // Ya leyó la instrucción: una cinta abajo que no intercepta toques. El próximo toque cuenta.
      this.ui().innerHTML = `<div class="strip" id="bar">Tarea ${i} de ${n} · toca en el prototipo el lugar donde irías</div>`;
      return;
    }

    this.ui().innerHTML = `
      <div class="bar" id="bar">
        <button class="bar-head" id="toggle" aria-expanded="true">
          <span class="step">Tarea ${i} de ${n}</span>
          <span class="title">${esc(task.title || task.instruction)}</span>
          <span class="chev">⌄</span>
        </button>
        <div class="bar-body" id="body">
          <p class="instruction">${esc(task.instruction)}</p>
          <div class="actions">
            <button class="btn small ghost" id="skip">No pude</button>
            <button class="btn small primary" id="done">Listo</button>
          </div>
        </div>
      </div>`;
    const bar = this.root!.getElementById('bar')!;
    const toggle = this.root!.getElementById('toggle')!;
    const setCollapsed = (collapsed: boolean): void => {
      bar.classList.toggle('collapsed', collapsed);
      toggle.setAttribute('aria-expanded', String(!collapsed));
    };
    toggle.addEventListener('click', () => setCollapsed(!bar.classList.contains('collapsed')));
    // La barra se achica sola para no tapar el prototipo; el participante la abre cuando quiera.
    window.setTimeout(() => setCollapsed(true), 5000);
    this.root!.getElementById('done')?.addEventListener('click', () => this.completeTask('done'));
    this.root!.getElementById('skip')?.addEventListener('click', () => this.completeTask('skip'));
  }

  private toast(text: string): void {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    this.root!.appendChild(el);
    setTimeout(() => el.remove(), 1800);
  }
}

function samePath(a: string, b: string): boolean {
  const norm = (p: string): string => {
    const noQuery = p.split('?')[0] ?? '';
    const noSlash = noQuery.replace(/\/+$/, '') || '/';
    return noSlash.replace(/\/index\.html$/, '') || '/';
  };
  return norm(a) === norm(b);
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 2147483646; }
  .sheet {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 2147483647;
    background: #fff; color: #111; border-radius: 20px 20px 0 0;
    padding: 20px 20px calc(20px + env(safe-area-inset-bottom)); max-height: 88vh; overflow: auto;
    box-shadow: 0 -8px 30px rgba(0,0,0,.2);
  }
  @media (min-width: 640px) { .sheet { left: 50%; right: auto; bottom: 24px; width: 420px; transform: translateX(-50%); border-radius: 20px; } }
  .eyebrow { margin: 0 0 6px; font-size: 12px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: #6b7266; }
  h1 { margin: 0 0 10px; font-size: 22px; line-height: 1.25; }
  .body { margin: 0 0 10px; font-size: 16px; line-height: 1.45; }
  .muted { margin: 0 0 14px; font-size: 14px; line-height: 1.4; color: #6b7266; }
  .muted.small { font-size: 13px; margin: 0; }
  .consent { display: flex; gap: 10px; align-items: flex-start; font-size: 14px; line-height: 1.4; margin: 0 0 16px; padding: 12px; background: #f4f5f2; border-radius: 12px; }
  .consent input { width: 20px; height: 20px; margin: 1px 0 0; flex: 0 0 auto; }
  .btn { display: block; width: 100%; border: 0; border-radius: 12px; padding: 14px; font-size: 16px; font-weight: 600; cursor: pointer; }
  .btn.primary { background: #111; color: #fff; }
  .btn.primary:disabled { opacity: .4; cursor: default; }
  .btn.ghost { background: transparent; color: #6b7266; margin-top: 6px; }
  .btn.small { padding: 10px 14px; font-size: 14px; width: auto; }
  .bar {
    position: fixed; top: 8px; left: 8px; right: 8px; z-index: 2147483647;
    background: #111; color: #fff; border-radius: 14px; box-shadow: 0 6px 20px rgba(0,0,0,.3);
    overflow: hidden;
  }
  @media (min-width: 640px) { .bar { left: 50%; right: auto; width: 420px; transform: translateX(-50%); } }
  .bar-head { display: flex; align-items: center; gap: 10px; width: 100%; background: none; border: 0; color: inherit; padding: 12px 14px; text-align: left; cursor: pointer; }
  .step { font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: #9ccc9c; white-space: nowrap; }
  .title { flex: 1; font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chev { font-size: 18px; line-height: 1; transition: transform .2s; }
  .collapsed { top: auto; bottom: 12px; left: 12px; right: auto; width: auto; max-width: 60vw; transform: none; border-radius: 999px; }
  .strip {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 2147483647; pointer-events: none;
    background: rgba(17,17,17,.9); color: #fff; text-align: center; font-size: 12px; font-weight: 600;
    padding: 6px 12px calc(6px + env(safe-area-inset-bottom));
  }
  .collapsed .bar-head { padding: 8px 12px; gap: 8px; }
  .collapsed .title { display: none; }
  .collapsed .chev { transform: rotate(180deg); }
  .collapsed .bar-body { display: none; }
  .bar-body { padding: 0 14px 14px; }
  .instruction { margin: 0 0 12px; font-size: 15px; line-height: 1.45; }
  .actions { display: flex; gap: 8px; justify-content: flex-end; }
  .bar .btn.primary { background: #2f7d4f; }
  .bar .btn.ghost { color: #bbb; margin: 0; }
  .toast {
    position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 2147483647;
    background: #2f7d4f; color: #fff; padding: 10px 16px; border-radius: 999px; font-size: 14px; font-weight: 600;
    box-shadow: 0 6px 20px rgba(0,0,0,.25); animation: fade 1.8s forwards;
  }
  @keyframes fade { 0%, 70% { opacity: 1; } 100% { opacity: 0; } }
`;
