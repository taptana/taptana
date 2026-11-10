/**
 * Sigue la pantalla que el participante tiene delante y emite `navigation` cuando cambia.
 *
 * 1. Por URL: al cargar (`load`), con `history.pushState/replaceState` y `popstate`
 *    (`history`), y con `hashchange` si el hash es de ruta (`hash`).
 * 2. Misma URL (`screen`): un MutationObserver avisa de cambios en el DOM y, con una espera
 *    corta, se revisan tres señales en orden:
 *    a. marcador explícito: el elemento visible más grande con `data-taptana-screen` o `data-screen`;
 *    b. contenedores hermanos donde solo uno está visible (patrón `.screen.active` / `hidden`);
 *    c. cambió el primer encabezado visible junto con un cambio grande del contenido.
 *
 * Regla de nombres: **lo que se ve al llegar a una URL es la pantalla de esa URL**
 * ("/index.html"). Los demás estados de la misma URL son pantallas virtuales
 * ("/index.html~carrito"), y volver al estado inicial es volver a "/index.html". Así un
 * prototipo multipágina nunca recibe nombres virtuales por tener un `hidden` o un encabezado, y
 * sin una señal clara no se inventan pantallas (un contador, un carrusel o escribir no cuentan).
 *
 * Un contenedor con `data-taptana-ignore` queda fuera de la detección.
 */

import { screenParts, screenSlug, virtualScreenId, type NavigationEvent } from '@taptana/shared';
import { getBasePath, rebaseUrl, urlScreen } from './session.js';

const CHECK_WAIT_MS = 150;
const CHECK_MAX_WAIT_MS = 600;
const URL_CHECK_WAIT_MS = 60;
const TITLE_MAX = 80;
/** Un cambio de encabezado sin cambio grande del contenido se da por "mismo lugar" tras esta espera. */
const HEADING_SETTLE_MS = 1300;
/** Contra qué se compara el contenido: una muestra de al menos esta antigüedad. */
const SAMPLE_AGE_MS = 1200;
const GRID_COLS = 5;
const GRID_ROWS = 7;

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'TEMPLATE', 'NOSCRIPT', 'BR', 'HR', 'DIALOG']);
const CONTAINER_TAGS = new Set(['DIV', 'SECTION', 'ARTICLE', 'MAIN', 'FORM', 'LI']);
const CHROME_TAGS = new Set(['HEADER', 'NAV', 'FOOTER', 'ASIDE']);
/** Clases de estado: no dicen qué es el elemento, solo si se ve. */
const STATE_CLASS = /^(is-|has-)?(active|current|show|shown|visible|selected|open|opened|in|on|hidden|hide|d-none|d-block|block|flex|grid|invisible)$/i;
const NAME_ATTRS = ['data-screen-name', 'data-page', 'data-view', 'data-route', 'data-tab', 'data-name', 'data-step', 'data-section'];

/** ¿El nodo es parte de la interfaz de Taptana (barra de tarea, botón de exportar)? */
export function isOurs(node: unknown): boolean {
  return node instanceof Element && node.closest('[data-taptana-ui]') !== null;
}

function ignored(el: Element): boolean {
  return el.closest('[data-taptana-ignore]') !== null;
}

/**
 * ¿Se ve? Tiene tamaño, no está escondido (display, visibility, opacity, `hidden`) ni fuera de
 * la pantalla hacia un lado. Estar más abajo (hay que hacer scroll) sí cuenta como visible.
 */
export function isShown(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  if (r.right <= 0 || r.left >= window.innerWidth) return false;
  if (typeof el.checkVisibility === 'function') return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.opacity !== '0';
}

/** Parte del viewport que ocupa el elemento (0 a 1). */
function coverage(el: Element): number {
  const W = window.innerWidth;
  const H = window.innerHeight;
  if (W <= 0 || H <= 0) return 0;
  const r = el.getBoundingClientRect();
  const w = Math.min(r.right, W) - Math.max(r.left, 0);
  const h = Math.min(r.bottom, H) - Math.max(r.top, 0);
  return w > 0 && h > 0 ? (w * h) / (W * H) : 0;
}

function clean(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

function firstShown(scope: ParentNode, selector: string): Element | null {
  for (const el of scope.querySelectorAll(selector)) {
    if (isOurs(el) || ignored(el) || !clean(el.textContent)) continue;
    if (isShown(el)) return el;
  }
  return null;
}

/** El encabezado que nombra una pantalla: el primer h1 visible; si no, h2; si no, role=heading. */
function headingOf(scope: ParentNode): Element | null {
  return firstShown(scope, 'h1') ?? firstShown(scope, 'h2') ?? firstShown(scope, '[role="heading"]') ?? firstShown(scope, 'h3');
}

function isChrome(el: Element): boolean {
  if (CHROME_TAGS.has(el.tagName)) return true;
  const position = getComputedStyle(el).position;
  return position === 'fixed' || position === 'sticky';
}

/** ¿Ocupa la pantalla? La mitad del viewport, o es lo único que hay además de barras fijas. */
function isBig(el: Element, shownSiblings: readonly Element[]): boolean {
  if (coverage(el) >= 0.5) return true;
  const r = el.getBoundingClientRect();
  if (r.width < window.innerWidth * 0.6) return false;
  return shownSiblings.every((k) => k === el || isChrome(k));
}

/** Parecidos de verdad: misma etiqueta y comparten una clase, un `data-*`, un prefijo de id o `role=tabpanel`. */
function strongSimilar(a: Element, b: Element): boolean {
  if (a.tagName !== b.tagName) return false;
  for (const c of a.classList) if (!STATE_CLASS.test(c) && b.classList.contains(c)) return true;
  if (a.getAttribute('role') === 'tabpanel' && b.getAttribute('role') === 'tabpanel') return true;
  for (const name of a.getAttributeNames()) if (name.startsWith('data-') && b.hasAttribute(name)) return true;
  const ia = a.id;
  const ib = b.id;
  if (ia && ib) {
    const prefix = /^[a-z]+[-_]/i.exec(ia)?.[0];
    if (prefix && ib.startsWith(prefix)) return true;
    const suffix = /[-_][a-z]+$/i.exec(ia)?.[0];
    if (suffix && ib.endsWith(suffix)) return true;
  }
  return false;
}

function contentChildren(parent: Element): Element[] {
  return Array.from(parent.children).filter(
    (k) => !SKIP_TAGS.has(k.tagName) && !k.hasAttribute('data-taptana-ui') && !k.hasAttribute('data-taptana-ignore'),
  );
}

interface Group {
  parent: Element;
  /** Un miembro del grupo, para reconocer a sus hermanos. */
  rep: Element;
  /** true: se parecen de verdad. false: solo comparten etiqueta. */
  strong: boolean;
}

/**
 * Busca, de afuera hacia adentro y solo por los contenedores que ocupan la pantalla, un grupo de
 * hermanos donde uno se ve y otros parecidos están escondidos.
 */
function findGroup(): Group | null {
  if (!document.body || document.body.hasAttribute('data-taptana-ignore')) return null;
  let level: Element[] = [document.body];
  let weak: Group | null = null;
  for (let depth = 0; depth < 6 && level.length > 0; depth++) {
    const next: Element[] = [];
    for (const parent of level) {
      const kids = contentChildren(parent);
      const shown = kids.filter(isShown);
      const hidden = kids.filter((k) => !shown.includes(k));
      for (const s of shown) {
        if (!isBig(s, shown)) continue;
        if (hidden.length > 0 && CONTAINER_TAGS.has(s.tagName)) {
          const others = shown.filter((k) => k !== s);
          if (hidden.some((k) => strongSimilar(s, k)) && !others.some((k) => strongSimilar(s, k))) {
            return { parent, rep: s, strong: true };
          }
          if (!weak && hidden.some((k) => k.tagName === s.tagName) && !others.some((k) => k.tagName === s.tagName)) {
            weak = { parent, rep: s, strong: false };
          }
        }
        if (next.length < 4) next.push(s);
      }
    }
    level = next;
  }
  return weak;
}

function groupMembers(group: Group): Element[] {
  return contentChildren(group.parent).filter(
    (k) => k === group.rep || (group.strong ? strongSimilar(group.rep, k) : k.tagName === group.rep.tagName),
  );
}

type Found = { name: string; el: Element } | 'unsure' | null;

interface Sample {
  t: number;
  /** Por cada punto de la cuadrícula: el elemento que hay ahí y su texto. */
  points: Array<[Element | null, string]>;
}

function ownText(el: Element): string {
  let out = '';
  for (const node of el.childNodes) if (node.nodeType === Node.TEXT_NODE) out += node.nodeValue ?? '';
  out = clean(out).slice(0, 32);
  if (!out && el instanceof HTMLImageElement) out = `img:${el.currentSrc.slice(-24)}`;
  return out;
}

/** Texto de lo que hay en una cuadrícula de puntos del viewport: una "foto" barata del contenido. */
function takeSample(t: number): Sample {
  const points: Sample['points'] = [];
  const W = window.innerWidth;
  const H = window.innerHeight;
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const stack = document.elementsFromPoint((W * (col + 0.5)) / GRID_COLS, (H * (row + 0.5)) / GRID_ROWS);
      const el = stack.find((e) => !e.hasAttribute('data-taptana-ui')) ?? null;
      points.push([el, el ? ownText(el) : '']);
    }
  }
  return { t, points };
}

/** Compara sin números: "Carrito (3)" y "Carrito (4)" son el mismo encabezado. */
function headingKey(text: string): string {
  return text.replace(/\d+/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export interface ScreenTrackerOptions {
  /** Pantalla anterior de la sesión (ScreenId), o "" si es la entrada. */
  previous: string;
  emit(event: NavigationEvent): void;
  /** Tapa lo que el participante escribió (para títulos y nombres de pantalla). */
  mask(text: string): string;
  /** Después de cada revisión del DOM, haya cambiado la pantalla o no. */
  onCheck?(): void;
  /** Cambió algo en el DOM del prototipo. */
  onMutation?(): void;
}

export class ScreenTracker {
  /** ScreenId de la pantalla actual. */
  current = '';
  /** Título o encabezado de la pantalla actual. */
  title = '';
  /** Última vez que cambió el DOM del prototipo. */
  lastMutationAt = 0;

  /** ScreenId de la URL actual, sin nombre virtual. */
  private url = '';
  private observer: MutationObserver | null = null;
  private timer: number | undefined;
  private firstScheduledAt = 0;
  private dueCap = 0;
  private urlChangedAt = 0;
  private readonly cleanups: Array<() => void> = [];

  // Estado inicial de esta URL: es "la pantalla de la URL" y no lleva nombre virtual.
  private alias: string | null = null;
  private aliasSet = false;
  private interacted = false;
  /** Ya se vio un marcador o un grupo en esta URL: la señal del encabezado deja de usarse. */
  private family = false;
  private group: Group | null = null;

  // Señal (c): encabezado + cambio grande del contenido.
  private accepted: [string, string] = ['', ''];
  private known = new Map<string, string | null>();
  private headingName: string | null = null;
  private pendingSince = 0;
  private samples: Sample[] = [];
  private stamps = new WeakMap<Element, number>();

  constructor(private readonly opts: ScreenTrackerOptions) {}

  /** ScreenId de la URL actual (sin nombre virtual). */
  get urlId(): string {
    return this.url;
  }

  start(): void {
    this.url = urlScreen();
    this.current = this.url;
    this.title = this.readTitle(null);
    const load: NavigationEvent = { kind: 'taptana', type: 'navigation', t: Date.now(), from: this.opts.previous, to: this.url, via: 'load' };
    if (this.title) load.title = this.title;
    this.opts.emit(load);

    this.wrapHistory();
    const onUrl = (): void => this.urlChanged();
    this.listen(window, 'popstate', onUrl);
    this.listen(window, 'hashchange', onUrl);
    // Una transición que termina puede dejar visible otra pantalla sin tocar el DOM.
    const onSettle = (e: Event): void => {
      if (!isOurs(e.target)) this.schedule();
    };
    this.listen(document, 'transitionend', onSettle, true);
    this.listen(document, 'animationend', onSettle, true);
    // La primera interacción fija el estado inicial; se escucha en captura, antes que el prototipo.
    const onInteract = (e: Event): void => this.onInteract(e);
    this.listen(document, 'pointerdown', onInteract, true);
    this.listen(document, 'touchstart', onInteract, true);
    this.listen(document, 'keydown', onInteract, true);

    this.observer = new MutationObserver((records) => this.onMutations(records));
    this.observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden'],
    });
    // El prototipo puede terminar de dibujarse después de este script.
    this.schedule();
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    for (const fn of this.cleanups.splice(0)) fn();
  }

  /** Revisa pronto (después de un toque: hay cambios que no tocan el DOM, como `:target`). */
  checkSoon(): void {
    this.schedule();
  }

  /** La página volvió del historial (bfcache): se anuncia como una carga nueva. */
  revisit(previous: string): void {
    const event: NavigationEvent = { kind: 'taptana', type: 'navigation', t: Date.now(), from: previous, to: this.current, via: 'history' };
    if (this.title) event.title = this.title;
    this.opts.emit(event);
  }

  // ── URL ────────────────────────────────────────────────────────────────

  private listen(target: EventTarget, type: string, fn: (e: Event) => void, capture = false): void {
    const options = { capture, passive: true };
    target.addEventListener(type, fn, options);
    this.cleanups.push(() => target.removeEventListener(type, fn, options));
  }

  private wrapHistory(): void {
    const tracker = this;
    for (const method of ['pushState', 'replaceState'] as const) {
      const original = history[method];
      const wrapped = function (this: History, data: unknown, unused: string, url?: string | URL | null): void {
        // Con data-base, una ruta absoluta se queda dentro del prototipo.
        const next = url === undefined || url === null ? url : rebaseUrl(String(url), getBasePath(), location.href);
        original.call(this, data, unused, next);
        tracker.urlChanged();
      };
      history[method] = wrapped;
      this.cleanups.push(() => {
        if (history[method] === wrapped) history[method] = original;
      });
    }
  }

  private urlChanged(): void {
    if (urlScreen() === this.url) return;
    if (!this.urlChangedAt) this.urlChangedAt = Date.now();
    // Un respiro corto para que el router dibuje la pantalla y su título.
    this.dueCap = this.dueCap ? Math.min(this.dueCap, Date.now() + URL_CHECK_WAIT_MS) : Date.now() + URL_CHECK_WAIT_MS;
    this.schedule();
  }

  // ── DOM ────────────────────────────────────────────────────────────────

  private onMutations(records: MutationRecord[]): void {
    const now = Date.now();
    let real = false;
    for (const r of records) {
      if (isOurs(r.target)) continue;
      if (r.type !== 'childList') {
        real = true;
        continue;
      }
      for (const node of r.addedNodes) {
        if (node instanceof Element) {
          if (node.hasAttribute('data-taptana-ui')) continue;
          this.stamps.set(node, now);
        }
        real = true;
      }
      for (const node of r.removedNodes) {
        if (!(node instanceof Element && node.hasAttribute('data-taptana-ui'))) real = true;
      }
    }
    if (!real) return;
    this.lastMutationAt = now;
    this.opts.onMutation?.();
    this.schedule();
  }

  /** Espera a que el DOM se calme (150 ms), pero nunca más de 600 ms desde el primer aviso. */
  private schedule(): void {
    const now = Date.now();
    if (!this.firstScheduledAt) this.firstScheduledAt = now;
    let due = Math.min(now + CHECK_WAIT_MS, this.firstScheduledAt + CHECK_MAX_WAIT_MS);
    if (this.dueCap) due = Math.min(due, this.dueCap);
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.check(), Math.max(0, due - now));
  }

  private onInteract(e: Event): void {
    if (this.interacted || isOurs(e.target)) return;
    this.interacted = true;
    if (this.aliasSet) return;
    const found = this.detect();
    // Sin un estado claro (dos capas a la vez), la base será el primer estado claro que aparezca.
    if (found === 'unsure') return;
    this.fixAlias(found, Date.now());
  }

  private fixAlias(found: { name: string; el: Element } | null, now: number): void {
    if (found) this.family = true;
    this.alias = found ? found.name : null;
    this.aliasSet = true;
    this.accepted = this.headings();
    this.known = new Map([[this.headingsKey(this.accepted), null]]);
    this.headingName = null;
    this.pendingSince = 0;
    this.samples = [takeSample(now)];
  }

  private check(): void {
    this.timer = undefined;
    this.firstScheduledAt = 0;
    this.dueCap = 0;
    const now = Date.now();

    const url = urlScreen();
    if (url !== this.url) {
      const via = screenParts(url).path === screenParts(this.url).path ? 'hash' : 'history';
      this.url = url;
      // Otra URL: su estado inicial vuelve a ser "la pantalla de la URL".
      this.aliasSet = false;
      this.interacted = false;
      this.alias = null;
      this.family = false;
      this.group = null;
      this.headingName = null;
      this.change(url, via, this.urlChangedAt || now, null);
    } else {
      this.checkSameUrl(now);
    }
    this.urlChangedAt = 0;
    this.opts.onCheck?.();
  }

  private checkSameUrl(now: number): void {
    const found = this.detect();
    if (found === 'unsure') return;
    if (found) this.family = true;
    if (!this.aliasSet) {
      // Antes de la primera interacción, lo que haya es el estado inicial (el prototipo puede
      // tardar en dibujarse). Después, el primer estado claro.
      if (this.interacted) this.fixAlias(found, now);
      return;
    }

    let virtual: string | null;
    let el: Element | null = null;
    if (this.family) {
      if (!found) {
        // Sin marcador ni grupo a la vista: no hay señal clara, se queda donde estaba.
        if (this.alias !== null) return;
        virtual = null;
      } else {
        virtual = found.name === this.alias ? null : found.name;
        el = found.el;
      }
    } else {
      virtual = this.headingScreen(now);
    }
    const id = virtual ? virtualScreenId(this.url, virtual) : this.url;
    if (id !== this.current) this.change(id, 'screen', now, el);
  }

  private change(to: string, via: NonNullable<NavigationEvent['via']>, t: number, el: Element | null): void {
    const from = this.current;
    this.current = to;
    this.title = this.readTitle(el);
    if (to === from) return;
    const event: NavigationEvent = { kind: 'taptana', type: 'navigation', t, from, to, via };
    if (this.title) event.title = this.title;
    this.opts.emit(event);
  }

  private readTitle(el: Element | null): string {
    const heading = (el && headingOf(el)) ?? (document.body ? headingOf(document.body) : null);
    const text = clean(heading?.textContent) || clean(document.title);
    return this.opts.mask(text).slice(0, TITLE_MAX);
  }

  // ── Señales (a) y (b) ──────────────────────────────────────────────────

  private detect(): Found {
    return this.marker() ?? this.groupState();
  }

  /** (a) El elemento visible más grande con data-taptana-screen o data-screen. */
  private marker(): Found {
    let best: Element | null = null;
    let bestArea = 0;
    for (const el of document.querySelectorAll('[data-taptana-screen],[data-screen]')) {
      if (isOurs(el) || ignored(el) || !isShown(el)) continue;
      const area = coverage(el);
      // Con empate gana el último: una capa a pantalla completa suele venir después en el DOM.
      if (area > 0 && area >= bestArea) {
        best = el;
        bestArea = area;
      }
    }
    if (!best) return null;
    const raw = best.getAttribute('data-taptana-screen') || best.getAttribute('data-screen') || best.id || headingOf(best)?.textContent || '';
    const name = screenSlug(this.opts.mask(clean(raw)));
    return name ? { name, el: best } : null;
  }

  /** (b) Hermanos parecidos donde solo uno se ve. */
  private groupState(): Found {
    let group = this.group;
    if (group && !(group.parent.isConnected && group.rep.parentElement === group.parent)) group = this.group = null;
    if (!group) {
      group = this.group = findGroup();
      if (!group) return null;
    }
    const members = groupMembers(group);
    const shown = members.filter(isShown);
    const only = shown[0];
    // Ninguno o varios a la vez (una transición, una capa encima): no se sabe todavía.
    if (shown.length !== 1 || !only) return 'unsure';
    return { name: this.memberName(only, members), el: only };
  }

  private memberName(el: Element, members: readonly Element[]): string {
    const candidates: Array<string | null | undefined> = [el.id];
    for (const attr of NAME_ATTRS) candidates.push(el.getAttribute(attr));
    candidates.push(el.getAttribute('aria-label'), headingOf(el)?.textContent);
    for (const c of el.classList) {
      if (!STATE_CLASS.test(c) && !members.some((m) => m !== el && m.classList.contains(c))) candidates.push(c);
    }
    for (const raw of candidates) {
      const name = raw ? screenSlug(this.opts.mask(clean(raw))) : '';
      if (name) return name;
    }
    return `pantalla-${members.indexOf(el) + 1}`;
  }

  // ── Señal (c) ──────────────────────────────────────────────────────────

  /** Texto del primer h1 visible y del primer h2 visible (o role=heading si no hay ninguno). */
  private headings(): [string, string] {
    if (!document.body) return ['', ''];
    const text = (sel: string): string => this.opts.mask(clean(firstShown(document.body, sel)?.textContent));
    let h1 = text('h1');
    const h2 = text('h2');
    if (!h1 && !h2) h1 = text('[role="heading"]');
    return [h1, h2];
  }

  private headingsKey(h: readonly [string, string]): string {
    return `${headingKey(h[0])}|${headingKey(h[1])}`;
  }

  private isFresh(el: Element, since: number): boolean {
    for (let node: Element | null = el; node && node !== document.documentElement; node = node.parentElement) {
      if ((this.stamps.get(node) ?? 0) > since) return true;
    }
    return false;
  }

  /** ¿Cambió al menos la mitad de lo que se ve? (nodos nuevos o texto distinto en la cuadrícula) */
  private bigChange(before: Sample, after: Sample): boolean {
    let total = 0;
    let changed = 0;
    for (let i = 0; i < after.points.length; i++) {
      const was = before.points[i]?.[1] ?? '';
      const point = after.points[i];
      if (!point) continue;
      const [el, now] = point;
      const fresh = el ? this.isFresh(el, before.t) : false;
      if (!was && !now && !fresh) continue;
      total++;
      if (fresh || was !== now) changed++;
    }
    return total >= 3 && changed / total >= 0.5;
  }

  /** Nombre virtual según el encabezado, o null si es el estado inicial. */
  private headingScreen(now: number): string | null {
    const sample = takeSample(now);
    // Se compara con cómo estaba la pantalla antes de esta tanda de cambios.
    let reference = this.samples[0] ?? sample;
    for (const s of this.samples) if (s.t <= now - SAMPLE_AGE_MS) reference = s;
    this.samples.push(sample);
    this.samples = this.samples.filter((s) => s === reference || s.t >= now - 4000);

    const current = this.headings();
    const h1Changed = current[0] !== '' && headingKey(current[0]) !== headingKey(this.accepted[0]);
    const h2Changed = !h1Changed && current[1] !== '' && headingKey(current[1]) !== headingKey(this.accepted[1]);
    if (!current[0] && !current[1]) return this.headingName; // sin encabezado a la vista: sin señal
    if (!h1Changed && !h2Changed) {
      this.accepted = current;
      this.pendingSince = 0;
      return this.headingName;
    }

    const key = this.headingsKey(current);
    if (this.bigChange(reference, sample)) {
      let name = this.known.get(key);
      if (name === undefined) {
        name = screenSlug(h1Changed ? current[0] : current[1]) || this.headingName;
        this.known.set(key, name);
      }
      this.accepted = current;
      this.pendingSince = 0;
      this.samples = [sample];
      this.headingName = name;
      return name;
    }

    // Cambió el encabezado pero no (todavía) el contenido: se espera un poco por si llega.
    if (!this.pendingSince) this.pendingSince = now;
    if (now - this.pendingSince >= HEADING_SETTLE_MS) {
      // Era un cambio en el sitio (un título editable, un contador con palabras): mismo lugar.
      this.known.set(key, this.headingName);
      this.accepted = current;
      this.pendingSince = 0;
    } else if (this.timer === undefined) {
      this.timer = window.setTimeout(() => this.check(), 450);
    }
    return this.headingName;
  }
}
