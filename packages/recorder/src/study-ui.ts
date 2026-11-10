/**
 * Interfaz del participante: hojas (bienvenida, instrucción, preguntas, gracias), la píldora de
 * la tarea, el aviso de "¡Listo!" y la cinta de vista previa.
 *
 * Todo vive en un shadow root colgado de <html> (no de <body>: un prototipo que redibuja el
 * body entero no se la lleva), con clase `rr-block` afuera y adentro para que rrweb no la grabe.
 * Esta clase solo dibuja y avisa; qué mostrar y cuándo lo decide study.ts.
 */

import { STUDY_LIMITS, SESSION_LIMITS, type AnswerValue, type QuestionBlock } from '@taptana/shared';
import css from './study-ui.css';

/** Un botón recién dibujado no responde hasta pasado este tiempo: un doble toque no salta dos pasos. */
const ARM_MS = 300;
/** Tras cerrar una hoja con un botón, un escudo invisible se traga el segundo toque. */
const SHIELD_MS = 350;
const HINT_MS = 4500;
const DRAG_PX = 8;
/** Franja de arriba donde suele estar el encabezado o el título del prototipo. */
const TOP_BAND_PX = 72;
/** Un encabezado más alto que esto no es una barra: la píldora no se manda tan abajo. */
const TOP_BAND_MAX_PX = 132;
const PILL_GAP_PX = 8;
/** Cuánto hay que desplazar una hoja para dar por vista la pista de "desliza". */
const SCROLL_SEEN_PX = 24;

/**
 * ¿Dónde termina lo que el prototipo tiene arriba (barra fija o pegajosa, <header>, o el primer
 * título dentro de la franja superior)? Devuelve su borde inferior en píxeles del viewport, o
 * `null` si arriba no hay nada que tapar. La píldora de la tarea se pone justo debajo.
 */
export function topBandBottom(doc: Document = document): number | null {
  const W = window.innerWidth;
  const ours = (el: Element): boolean => el.closest('[data-taptana-ui]') !== null;
  const box = (el: Element): DOMRect | null => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? r : null;
  };
  let bottom: number | null = null;
  const take = (value: number): void => {
    if (value > 0 && value <= TOP_BAND_MAX_PX && (bottom === null || value > bottom)) bottom = value;
  };
  // 1. Una barra fija o pegajosa arriba: se mira qué hay en tres puntos de la primera fila.
  for (const x of [W * 0.15, W * 0.5, W * 0.85]) {
    let el: Element | null = null;
    try {
      el = doc.elementsFromPoint(x, 10).find((e) => !ours(e)) ?? null;
    } catch {
      el = null;
    }
    for (let depth = 0; el && el !== doc.body && el !== doc.documentElement && depth < 12; el = el.parentElement, depth++) {
      const position = getComputedStyle(el).position;
      if (position !== 'fixed' && position !== 'sticky') continue;
      const r = box(el);
      if (r && r.top <= 4 && r.width >= W * 0.5) take(r.bottom);
      break;
    }
  }
  if (bottom !== null) return Math.round(bottom);
  // 2. Un <header> (o role="banner") pegado arriba.
  for (const el of Array.from(doc.querySelectorAll('header, [role="banner"]')).slice(0, 8)) {
    if (ours(el)) continue;
    const r = box(el);
    if (r && r.top >= -4 && r.top <= 8 && r.width >= W * 0.5) take(r.bottom);
  }
  if (bottom !== null) return Math.round(bottom);
  // 3. El primer título dentro de la franja de arriba.
  for (const el of Array.from(doc.querySelectorAll('h1, h2, h3, [role="heading"]')).slice(0, 40)) {
    if (ours(el)) continue;
    const r = box(el);
    if (!r || r.bottom <= 0 || r.top >= TOP_BAND_PX) continue;
    take(r.bottom);
    break;
  }
  return bottom === null ? null : Math.round(bottom);
}

export interface Step {
  /** Número del bloque, empezando en 1. */
  n: number;
  total: number;
}

export function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** ¿La respuesta está vacía? (sin elegir, texto en blanco o ninguna opción marcada) */
export function isEmptyAnswer(value: AnswerValue): boolean {
  if (value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** "3 pasos", "1 paso". */
export function stepsLabel(n: number): string {
  return `${n} paso${n === 1 ? '' : 's'}`;
}

const ICON_CHECK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const ICON_ALERT =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 7v6.5M12 17v.2"/></svg>';
const ICON_PAUSE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M7 12h10"/></svg>';

function stepHtml(step: Step, kind = ''): string {
  const pct = Math.round((Math.min(step.n, step.total) / Math.max(step.total, 1)) * 100);
  return `<p class="step">Paso ${step.n} de ${step.total}${kind ? ` · ${esc(kind)}` : ''}</p><div class="track" aria-hidden="true"><i style="width:${pct}%"></i></div>`;
}

export interface NoticeView {
  tone: 'ok' | 'warn' | 'calm';
  title: string;
  text: string;
  /** Botón opcional. */
  action?: string;
  /** El botón es la acción principal (si no, un enlace discreto). */
  primary?: boolean;
}

export class StudyUi {
  private host: HTMLElement | null = null;
  private layer!: HTMLElement;
  private sheetSlot!: HTMLElement;
  private pillSlot!: HTMLElement;
  private toastSlot!: HTMLElement;
  private guard: MutationObserver | null = null;
  private hintTimer: number | undefined;
  private shieldTimer: number | undefined;
  private pillCleanup: (() => void) | null = null;
  private viewportCleanup: (() => void) | null = null;

  constructor(private readonly tryout: boolean) {}

  /** Crea el contenedor una sola vez. */
  mount(): void {
    if (this.host) return;
    const host = document.createElement('div');
    host.className = 'rr-block';
    host.setAttribute('data-taptana-ui', 'study');
    // En línea y con !important: ninguna regla del prototipo (div { … }) puede moverlo.
    host.style.cssText =
      'all:initial!important;position:fixed!important;top:0!important;left:0!important;width:0!important;height:0!important;z-index:2147483647!important;display:block!important';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML =
      `<style>${css}</style><div class="t rr-block${this.tryout ? ' try' : ''}" id="ui">` +
      (this.tryout ? '<div class="ribbon" role="status">Vista previa · no se graba</div>' : '') +
      '<div id="sheet"></div><div id="pill"></div><div id="toast" aria-live="polite"></div></div>';
    this.layer = root.getElementById('ui') as HTMLElement;
    this.sheetSlot = root.getElementById('sheet') as HTMLElement;
    this.pillSlot = root.getElementById('pill') as HTMLElement;
    this.toastSlot = root.getElementById('toast') as HTMLElement;
    this.host = host;

    // Lo que pasa en nuestra interfaz no le llega al prototipo (atajos de teclado, "clic afuera").
    for (const type of ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchmove', 'touchend', 'keydown', 'keyup', 'keypress', 'input', 'change', 'wheel']) {
      this.layer.addEventListener(type, (e) => e.stopPropagation(), { passive: true });
    }

    const parent = document.documentElement;
    parent.appendChild(host);
    // Si el prototipo reescribe el documento, la interfaz vuelve a su sitio.
    this.guard = new MutationObserver(() => {
      if (this.host && !this.host.isConnected) document.documentElement.appendChild(this.host);
    });
    this.guard.observe(parent, { childList: true });
    this.watchViewport();
  }

  /** Quita todo lo que haya en pantalla (la cinta de vista previa se queda). */
  clear(): void {
    if (!this.host) return;
    this.closeSheet(false);
    this.hidePill();
    this.toastSlot.innerHTML = '';
  }

  // ── Hojas ───────────────────────────────────────────────────────────

  /** Fondo oscuro con un indicador de espera, mientras se baja el estudio. */
  waiting(): void {
    this.mount();
    this.sheetSlot.innerHTML = '<div class="scrim"></div><div class="wait" role="status"><span class="sr">Cargando…</span></div>';
  }

  welcome(
    view: { name: string; text: string; consent: string; steps: number; askName: boolean },
    handlers: { onStart(name: string): void; onDecline(): void },
  ): void {
    const body =
      `<p class="step">Prueba de usabilidad</p><h2 class="title" id="tt">${esc(view.name)}</h2>` +
      (view.text ? `<p class="text">${esc(view.text)}</p>` : '') +
      `<p class="note">${stepsLabel(view.steps)}. No hay respuestas correctas ni incorrectas: queremos ver cómo se usa el prototipo, no evaluarte a ti.</p>` +
      (view.askName
        ? `<label class="field"><span>¿Cómo te llamas? (opcional)</span><input class="input rr-ignore" id="who" type="text" maxlength="${SESSION_LIMITS.participant}" autocomplete="off" autocapitalize="words" enterkeyhint="done" placeholder="Nombre o apodo"></label>`
        : '');
    const foot =
      `<label class="consent" id="consent"><input class="check" id="ok" type="checkbox"><span>${esc(view.consent)}</span></label>` +
      '<div class="stack"><button type="button" class="btn primary" data-act="go" aria-disabled="true">Empezar</button>' +
      '<button type="button" class="btn plain" data-act="no">Prefiero no participar</button></div>';
    const sheet = this.sheet(body, foot, { footClass: 'wide' });
    const ok = sheet.querySelector('#ok') as HTMLInputElement;
    const go = this.button(sheet, 'go');
    const consent = sheet.querySelector('#consent') as HTMLElement;
    const who = sheet.querySelector('#who') as HTMLInputElement | null;
    ok.addEventListener('change', () => go.setAttribute('aria-disabled', String(!ok.checked)));
    this.act(sheet, go, () => {
      if (!ok.checked) {
        // Falta la casilla: se la señalamos en vez de dejar un botón muerto.
        this.nudge(consent);
        ok.focus();
        return false;
      }
      handlers.onStart((who?.value ?? '').trim());
      return true;
    });
    this.act(sheet, this.button(sheet, 'no'), () => {
      handlers.onDecline();
      return true;
    });
  }

  /** Mensaje a pantalla completa: gracias, estudio cerrado, no se pudo cargar, no participó. */
  notice(view: NoticeView, onAction?: () => void): void {
    const icon = view.tone === 'ok' ? ICON_CHECK : view.tone === 'warn' ? ICON_ALERT : ICON_PAUSE;
    const body =
      `<div class="badge ${view.tone}">${icon}</div><h2 class="title" id="tt">${esc(view.title)}</h2>` + `<p class="text">${esc(view.text)}</p>`;
    const foot = view.action ? `<button type="button" class="btn ${view.primary ? 'primary' : 'plain'}" data-act="go">${esc(view.action)}</button>` : '';
    const sheet = this.sheet(body, foot);
    if (view.action && onAction) {
      this.act(sheet, this.button(sheet, 'go'), () => {
        onAction();
        return true;
      });
    }
  }

  /** Instrucción de la tarea antes de empezar. */
  intro(view: { step: Step; instruction: string; firstClick: boolean }, onStart: () => void): void {
    const body =
      stepHtml(view.step, view.firstClick ? 'Primer clic' : 'Tarea') +
      `<p class="lead" id="tt">${esc(view.instruction)}</p>` +
      `<p class="note">${
        view.firstClick
          ? 'Solo cuenta tu primer toque: toca en el prototipo el lugar donde irías.'
          : 'Al empezar verás el prototipo. Arriba queda un botón pequeño para releer la tarea o terminarla.'
      }</p>`;
    const sheet = this.sheet(body, '<button type="button" class="btn primary" data-act="go">Empezar tarea</button>');
    this.act(sheet, this.button(sheet, 'go'), () => {
      onStart();
      return true;
    });
  }

  /** La instrucción, abierta desde la píldora, con las salidas de la tarea. */
  instruction(
    view: { step: Step; instruction: string; firstClick: boolean },
    handlers: { onDone(): void; onSkip(): void; onClose(): void },
  ): void {
    const body =
      stepHtml(view.step, view.firstClick ? 'Primer clic' : 'Tarea') +
      `<p class="lead" id="tt">${esc(view.instruction)}</p>` +
      (view.firstClick ? '<p class="note">Solo cuenta tu primer toque.</p>' : '');
    const foot = view.firstClick
      ? '<button type="button" class="btn primary" data-act="close">Seguir</button><button type="button" class="btn plain" data-act="skip">No pude</button>'
      : '<button type="button" class="btn primary" data-act="done">Listo, terminé</button>' +
        '<div class="row"><button type="button" class="btn soft" data-act="skip">No pude</button><button type="button" class="btn soft" data-act="close">Seguir</button></div>';
    const sheet = this.sheet(body, foot, { dismiss: handlers.onClose });
    const bind = (name: string, fn: () => void): void => {
      const el = sheet.querySelector<HTMLElement>(`[data-act="${name}"]`);
      if (el) {
        this.act(sheet, el, () => {
          fn();
          return true;
        });
      }
    };
    bind('done', handlers.onDone);
    bind('skip', handlers.onSkip);
    bind('close', handlers.onClose);
  }

  context(view: { step: Step; title: string; text: string }, onContinue: () => void): void {
    const body = stepHtml(view.step) + `<h2 class="title" id="tt">${esc(view.title)}</h2>` + (view.text ? `<p class="text">${esc(view.text)}</p>` : '');
    const sheet = this.sheet(body, '<button type="button" class="btn primary" data-act="go">Continuar</button>');
    this.act(sheet, this.button(sheet, 'go'), () => {
      onContinue();
      return true;
    });
  }

  /**
   * Una pregunta con su control. `onAnswer(null)` = la saltó. "Continuar" solo se activa con
   * algo respondido; en una pregunta opcional, la única forma de saltarla es "Saltar".
   * `initial`: lo que ya había elegido (si recargó la página). `onChange` avisa cada cambio,
   * para que lo elegido no se pierda si el participante sale de la pregunta de otra forma.
   */
  question(
    view: { step: Step; block: QuestionBlock; initial?: AnswerValue },
    onAnswer: (value: AnswerValue) => void,
    onChange?: (value: AnswerValue) => void,
  ): void {
    const b = view.block;
    let value: AnswerValue = null;
    let control = '';
    if (b.kind === 'scale') {
      let nums = '';
      for (let i = 1; i <= b.max; i++) nums += `<button type="button" class="num" role="radio" aria-checked="false" tabindex="${i === 1 ? 0 : -1}" data-v="${i}">${i}</button>`;
      control =
        `<div class="scale n${b.max}" role="radiogroup" aria-labelledby="tt">${nums}</div>` +
        (b.minLabel || b.maxLabel ? `<div class="ends"><span>${b.minLabel ? `1 · ${esc(b.minLabel)}` : ''}</span><span>${b.maxLabel ? `${b.max} · ${esc(b.maxLabel)}` : ''}</span></div>` : '');
    } else if (b.kind === 'yesno') {
      control =
        '<div class="yn" role="radiogroup" aria-labelledby="tt"><button type="button" class="num" role="radio" aria-checked="false" tabindex="0" data-v="yes">Sí</button>' +
        '<button type="button" class="num" role="radio" aria-checked="false" tabindex="-1" data-v="no">No</button></div>';
    } else if (b.kind === 'choice') {
      const type = b.multiple ? 'checkbox' : 'radio';
      control =
        (b.multiple ? '<p class="note">Puedes elegir varias.</p>' : '') +
        `<div class="opts" role="${b.multiple ? 'group' : 'radiogroup'}" aria-labelledby="tt">` +
        b.options.map((o, i) => `<label class="opt"><input class="check" type="${type}" name="q" value="${i}"><span>${esc(o)}</span></label>`).join('') +
        '</div>';
    } else {
      control = `<textarea class="area rr-ignore" id="area" rows="4" maxlength="${STUDY_LIMITS.answer}" aria-labelledby="tt" placeholder="${esc(b.placeholder || 'Escribe tu respuesta')}"></textarea>`;
    }

    const body =
      stepHtml(view.step, b.required ? '' : 'Opcional') +
      `<h2 class="title" id="tt">${esc(b.question)}</h2>` +
      (b.description ? `<p class="text">${esc(b.description)}</p>` : '') +
      control;
    const foot =
      '<button type="button" class="btn primary" data-act="go" aria-disabled="true">Continuar</button>' +
      (b.required ? '' : '<button type="button" class="btn plain" data-act="skip">Saltar</button>');
    const sheet = this.sheet(body, foot);
    const go = this.button(sheet, 'go');
    const refresh = (silent = false): void => {
      const empty = isEmptyAnswer(value);
      const was = go.getAttribute('aria-disabled') === 'true';
      go.setAttribute('aria-disabled', String(empty));
      // Al activarse, "Continuar" late una vez: se nota que ya se puede seguir.
      if (was && !empty && !silent) {
        go.classList.remove('lit');
        void go.offsetWidth;
        go.classList.add('lit');
      }
      if (!silent) onChange?.(value);
    };
    const initial = view.initial ?? null;

    if (b.kind === 'scale' || b.kind === 'yesno') {
      const group = sheet.querySelector('[role="radiogroup"]') as HTMLElement;
      const items = Array.from(group.querySelectorAll<HTMLElement>('.num'));
      const pick = (el: HTMLElement): void => {
        for (const item of items) {
          item.setAttribute('aria-checked', String(item === el));
          item.tabIndex = item === el ? 0 : -1;
        }
        const raw = el.dataset['v'] ?? '';
        value = b.kind === 'yesno' ? raw === 'yes' : Number(raw);
        refresh();
      };
      for (const item of items) item.addEventListener('click', () => pick(item));
      const wanted = typeof initial === 'boolean' ? (initial ? 'yes' : 'no') : typeof initial === 'number' ? String(initial) : null;
      const chosen = wanted === null ? undefined : items.find((item) => item.dataset['v'] === wanted);
      if (chosen) {
        for (const item of items) {
          item.setAttribute('aria-checked', String(item === chosen));
          item.tabIndex = item === chosen ? 0 : -1;
        }
        value = initial;
        refresh(true);
      }
      group.addEventListener('keydown', (e) => {
        const at = items.indexOf(this.focused() as HTMLElement);
        const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
        const next = step && at !== -1 ? items[(at + step + items.length) % items.length] : undefined;
        if (!next) return;
        e.preventDefault();
        next.focus();
        pick(next);
      });
    } else if (b.kind === 'choice') {
      const inputs = Array.from(sheet.querySelectorAll<HTMLInputElement>('.opts input'));
      const read = (silent = false): void => {
        const chosen: string[] = [];
        inputs.forEach((input, i) => {
          input.closest('.opt')?.classList.toggle('on', input.checked);
          const option = b.options[i];
          if (input.checked && option !== undefined) chosen.push(option);
        });
        value = b.multiple ? chosen : (chosen[0] ?? null);
        refresh(silent);
      };
      for (const input of inputs) input.addEventListener('change', () => read());
      const before = Array.isArray(initial) ? initial : typeof initial === 'string' ? [initial] : [];
      if (before.length > 0) {
        inputs.forEach((input, i) => {
          input.checked = before.includes(b.options[i] as string);
        });
        read(true);
      }
    } else {
      const area = sheet.querySelector('#area') as HTMLTextAreaElement;
      if (typeof initial === 'string' && initial) {
        area.value = initial;
        value = initial;
        refresh(true);
      }
      area.addEventListener('input', () => {
        value = area.value;
        refresh();
      });
    }

    this.act(sheet, go, () => {
      if (isEmptyAnswer(value)) {
        // Sin respuesta, "Continuar" no avanza: se señala el control (y "Saltar", si la hay).
        const target = sheet.querySelector<HTMLElement>('.scale, .yn, .opts, .area');
        if (target) this.nudge(target);
        return false;
      }
      onAnswer(typeof value === 'string' ? value.trim() : value);
      return true;
    });
    const skip = sheet.querySelector<HTMLElement>('[data-act="skip"]');
    if (skip) {
      this.act(sheet, skip, () => {
        // Un "Sí" o un número ya elegido no se pierde aunque salga con "Saltar".
        const picked = (b.kind === 'yesno' || b.kind === 'scale') && !isEmptyAnswer(value);
        onAnswer(picked ? value : null);
        return true;
      });
    }
  }

  /** Cierra la hoja. `shield`: deja un instante un escudo invisible que se traga un doble toque. */
  closeSheet(shield: boolean): void {
    if (!this.host) return;
    this.sheetSlot.innerHTML = shield ? '<div class="shield"></div>' : '';
    if (this.shieldTimer !== undefined) clearTimeout(this.shieldTimer);
    this.shieldTimer = undefined;
    if (shield) {
      this.shieldTimer = window.setTimeout(() => {
        this.shieldTimer = undefined;
        if (this.sheetSlot.querySelector('.sheet') === null) this.sheetSlot.innerHTML = '';
      }, SHIELD_MS);
    }
  }

  // ── Píldora y avisos ────────────────────────────────────────────────

  /**
   * El botón pequeño de la tarea. Si el participante no lo ha movido, va justo DEBAJO de lo que
   * el prototipo tiene arriba (barra fija, encabezado o título), para no taparlo; si arriba no
   * hay nada, queda chico en la esquina superior derecha. Se puede arrastrar y recuerda dónde
   * lo dejaron.
   */
  pill(view: { position: [number, number] | undefined; hint: boolean }, handlers: { onOpen(): void; onMove(position: [number, number]): void }): void {
    this.mount();
    this.hidePill();
    this.pillSlot.innerHTML =
      '<button type="button" class="pill" aria-haspopup="dialog" aria-label="Ver la tarea, terminarla o decir que no pudiste"><i class="dot"></i><span>Tarea</span><span class="see">· ver</span></button>' +
      (view.hint && !view.position ? '<div class="hint">Toca aquí para releer la tarea o terminarla</div>' : '');
    const pill = this.pillSlot.querySelector('.pill') as HTMLElement;
    let position = view.position;

    /** Posición por defecto: debajo del encabezado del prototipo, o chica en la esquina. */
    const dock = (): void => {
      if (position || !pill.isConnected) return;
      const hint = this.pillSlot.querySelector<HTMLElement>('.hint');
      const band = topBandBottom();
      if (band === null) {
        pill.classList.add('corner');
        pill.style.removeProperty('top');
        hint?.classList.add('corner');
        hint?.style.removeProperty('top');
        return;
      }
      pill.classList.remove('corner');
      hint?.classList.remove('corner');
      const top = Math.max(band, this.tryout ? 20 : 0) + PILL_GAP_PX;
      pill.style.top = `${top}px`;
      if (hint) hint.style.top = `${top + 46}px`;
    };
    dock();
    // La página puede terminar de dibujarse un momento después (o cambiar de pantalla).
    const redock = window.setTimeout(dock, 400);

    const place = (): void => {
      if (!position) return;
      pill.classList.remove('corner');
      const r = pill.getBoundingClientRect();
      const W = window.innerWidth;
      const H = window.innerHeight;
      pill.classList.add('moved');
      pill.style.left = `${Math.round(Math.min(Math.max(position[0] * W - r.width / 2, 6), Math.max(6, W - r.width - 6)))}px`;
      pill.style.top = `${Math.round(Math.min(Math.max(position[1] * H, 6), Math.max(6, H - r.height - 6)))}px`;
    };
    place();

    let drag: { id: number; x: number; y: number; left: number; top: number; moved: boolean } | null = null;
    let swallowClick = false;
    pill.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const r = pill.getBoundingClientRect();
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, left: r.left, top: r.top, moved: false };
      swallowClick = false;
      try {
        pill.setPointerCapture(e.pointerId);
      } catch {
        /* sin captura: el arrastre se corta al salir de la píldora */
      }
    });
    pill.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < DRAG_PX) return;
      drag.moved = true;
      this.hideHint();
      const r = pill.getBoundingClientRect();
      position = [(drag.left + dx + r.width / 2) / window.innerWidth, (drag.top + dy) / window.innerHeight];
      pill.classList.add('dragging');
      place();
    });
    const end = (e: PointerEvent): void => {
      if (!drag || e.pointerId !== drag.id) return;
      const moved = drag.moved;
      drag = null;
      pill.classList.remove('dragging');
      if (moved && position) {
        swallowClick = true;
        handlers.onMove(position);
      }
    };
    pill.addEventListener('pointerup', end);
    pill.addEventListener('pointercancel', end);
    pill.addEventListener('click', () => {
      if (swallowClick) {
        swallowClick = false;
        return;
      }
      handlers.onOpen();
    });

    const onResize = (): void => {
      place();
      dock();
    };
    window.addEventListener('resize', onResize);
    this.pillCleanup = () => {
      window.removeEventListener('resize', onResize);
      clearTimeout(redock);
    };
    if (this.pillSlot.querySelector('.hint')) this.hintTimer = window.setTimeout(() => this.hideHint(), HINT_MS);
  }

  hidePill(): void {
    if (!this.host) return;
    this.hideHint();
    this.pillCleanup?.();
    this.pillCleanup = null;
    this.pillSlot.innerHTML = '';
  }

  /** Aviso corto arriba ("¡Listo!"). No intercepta toques. */
  toast(text: string): void {
    this.mount();
    this.toastSlot.innerHTML = `<div class="toast">${ICON_CHECK}<span>${esc(text)}</span></div>`;
  }

  hideToast(): void {
    if (this.host) this.toastSlot.innerHTML = '';
  }

  // ── Interno ─────────────────────────────────────────────────────────

  private hideHint(): void {
    if (this.hintTimer !== undefined) clearTimeout(this.hintTimer);
    this.hintTimer = undefined;
    this.pillSlot.querySelector('.hint')?.remove();
  }

  private focused(): Element | null {
    return (this.host?.shadowRoot?.activeElement as Element | null | undefined) ?? null;
  }

  private button(sheet: HTMLElement, name: string): HTMLElement {
    return sheet.querySelector(`[data-act="${name}"]`) as HTMLElement;
  }

  private nudge(el: HTMLElement): void {
    el.classList.remove('nudge');
    void el.offsetWidth; // reinicia la animación
    el.classList.add('nudge');
    el.scrollIntoView({ block: 'nearest' });
  }

  /**
   * Conecta un botón de una hoja. No responde en los primeros 300 ms (doble toque) y, una vez
   * que su acción se ejecuta (`fn` devuelve true), toda la hoja deja de responder.
   */
  private act(sheet: HTMLElement, el: HTMLElement, fn: () => boolean): void {
    el.addEventListener('click', () => {
      if (sheet.dataset['done'] || !sheet.dataset['ready']) return;
      if (fn()) sheet.dataset['done'] = '1';
    });
  }

  /** Dibuja una hoja con cuerpo desplazable y pie fijo, y le da el foco. */
  private sheet(body: string, foot: string, opts: { footClass?: string; dismiss?: () => void } = {}): HTMLElement {
    this.mount();
    if (this.shieldTimer !== undefined) clearTimeout(this.shieldTimer);
    this.shieldTimer = undefined;
    this.sheetSlot.innerHTML =
      '<div class="scrim"></div><div class="dock"><section class="sheet" role="dialog" aria-modal="true" aria-labelledby="tt" tabindex="-1">' +
      `<div class="body">${body}</div><div class="more" hidden aria-hidden="true"><span>Desliza para ver más ↓</span></div>` +
      `${foot ? `<div class="foot ${opts.footClass ?? ''}">${foot}</div>` : ''}</section></div>`;
    const sheet = this.sheetSlot.querySelector('.sheet') as HTMLElement;
    const scrim = this.sheetSlot.querySelector('.scrim') as HTMLElement;
    this.scrollCue(sheet);
    window.setTimeout(() => {
      sheet.dataset['ready'] = '1';
    }, ARM_MS);

    const dismiss = opts.dismiss;
    if (dismiss) {
      scrim.addEventListener('click', () => {
        if (sheet.dataset['done'] || !sheet.dataset['ready']) return;
        sheet.dataset['done'] = '1';
        dismiss();
      });
    }
    // La rueda del mouse sobre el fondo no mueve la página de atrás.
    scrim.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
    sheet.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && dismiss && !sheet.dataset['done']) {
        sheet.dataset['done'] = '1';
        dismiss();
      } else if (e.key === 'Tab') {
        // El foco no sale de la hoja mientras está abierta.
        const items = Array.from(sheet.querySelectorAll<HTMLElement>('button, input, textarea')).filter((el) => el.tabIndex !== -1);
        const first = items[0];
        const last = items[items.length - 1];
        const at = this.focused();
        if (!first || !last) e.preventDefault();
        else if (e.shiftKey && (at === first || at === sheet)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && at === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });
    try {
      sheet.focus({ preventScroll: true });
    } catch {
      /* sin foco no pasa nada */
    }
    return sheet;
  }

  /**
   * Pista de "desliza": si el contenido de la hoja no cabe (pantallas chicas, celular en
   * horizontal), un degradado con la palabra avisa que hay más abajo. Se va al deslizar.
   * Desliza el cuerpo (vertical) o la hoja entera (horizontal, ver el CSS): se miran los dos.
   */
  private scrollCue(sheet: HTMLElement): void {
    const body = sheet.querySelector('.body') as HTMLElement;
    const more = sheet.querySelector('.more') as HTMLElement;
    let seen = false;
    const update = (): void => {
      if (!sheet.isConnected) return;
      const overflow = Math.max(body.scrollHeight - body.clientHeight, sheet.scrollHeight - sheet.clientHeight);
      if (Math.max(body.scrollTop, sheet.scrollTop) > SCROLL_SEEN_PX) seen = true;
      more.hidden = seen || overflow <= 12;
    };
    body.addEventListener('scroll', update, { passive: true });
    sheet.addEventListener('scroll', update, { passive: true });
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(update);
      ro.observe(sheet);
      ro.observe(body);
    }
    update();
    window.setTimeout(update, 350);
  }

  /**
   * Con el teclado en pantalla, la hoja se acomoda a la parte visible (visualViewport), para que
   * el botón principal no quede debajo del teclado.
   */
  private watchViewport(): void {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = (): void => {
      const full = document.documentElement.clientHeight || window.innerHeight;
      const bottom = Math.max(0, Math.round(full - vv.height - vv.offsetTop));
      // Con zoom de pellizco no se toca nada: solo interesa el teclado.
      if (Math.abs(vv.scale - 1) > 0.01 || bottom < 60) {
        this.layer.style.removeProperty('--vt');
        this.layer.style.removeProperty('--vb');
      } else {
        this.layer.style.setProperty('--vt', `${Math.max(0, Math.round(vv.offsetTop))}px`);
        this.layer.style.setProperty('--vb', `${bottom}px`);
      }
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    this.viewportCleanup = () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }

  destroy(): void {
    this.guard?.disconnect();
    this.viewportCleanup?.();
    this.pillCleanup?.();
    if (this.hintTimer !== undefined) clearTimeout(this.hintTimer);
    if (this.shieldTimer !== undefined) clearTimeout(this.shieldTimer);
    this.host?.remove();
    this.host = null;
  }
}
