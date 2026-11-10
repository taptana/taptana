/**
 * Texto escrito que el prototipo repite ("Hola Ana").
 *
 * rrweb ya enmascara el valor de los campos. Pero un prototipo puede copiar lo escrito a otro
 * lugar de la pantalla, y eso se grabaría como texto normal. Por eso el recorder recuerda lo que
 * se escribe (4 caracteres o más) y lo tapa en todo texto que graba: nodos de texto de rrweb,
 * el texto del elemento tocado y los títulos de pantalla.
 *
 * Solo se tapa cuando lo escrito aparece ENTERO: como palabra o frase completa, con algo que no
 * sea letra ni número a cada lado. Escribir "ficu" en un buscador no tapa "Ficus" en toda la
 * tienda; escribir "Ana María" sí tapa "Hola Ana María".
 *
 * La lista vive en memoria y en sessionStorage (para la siguiente página del mismo prototipo:
 * "Gracias, Ana"). Nunca sale del celular. Las contraseñas no se guardan en sessionStorage.
 */

import { storageGet, storageSet } from './session.js';

const KEY = 'taptana:typed';
const MIN_LENGTH = 4;
const MAX_REMEMBERED = 120;
const MAX_VALUE_LENGTH = 400;

/** Palabras muy comunes: taparlas ensuciaría la grabación sin proteger nada. */
const COMMON = new Set(
  'con del las los por para que una uno unos unas the and for with from this that not son mas más sin sus hay muy'.split(' '),
);

/** Lo que hay que tapar de un valor: el valor completo y cada una de sus palabras. */
export function tokensOf(value: string): string[] {
  const whole = value.replace(/\s+/g, ' ').trim().slice(0, MAX_VALUE_LENGTH).toLowerCase();
  if (whole.length < MIN_LENGTH) return [];
  const out = new Set<string>([whole]);
  for (const raw of whole.split(' ')) {
    const word = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (word.length >= MIN_LENGTH && !COMMON.has(word)) out.add(word);
  }
  return [...out];
}

/**
 * Una sola expresión que encuentra cualquiera de las cadenas como palabra o frase completa (sin
 * letra ni número pegados antes o después; sabe de tildes y de otros alfabetos), sin distinguir
 * mayúsculas. El grupo 1 es lo que venía justo antes (no se usa "lookbehind": Safari anterior
 * a 16.4 no lo entiende) y el grupo 2 es lo que hay que tapar.
 */
export function buildMask(strings: Iterable<string>): RegExp | null {
  const list = [...new Set(strings)].filter((s) => s.length >= MIN_LENGTH).sort((a, b) => b.length - a.length);
  if (list.length === 0) return null;
  const escaped = list.map((s) => s.replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&').replace(/ /g, '\\s+'));
  return new RegExp(`(^|[^\\p{L}\\p{N}])(${escaped.join('|')})(?![\\p{L}\\p{N}])`, 'giu');
}

/** Reemplaza cada coincidencia por asteriscos del mismo largo. El resto del texto queda igual. */
export function maskWith(text: string, mask: RegExp | null): string {
  if (!mask || !text) return text;
  mask.lastIndex = 0;
  return text.replace(mask, (_match, before: string, typed: string) => before + '*'.repeat(typed.length));
}

/** Valores que ya no están en un campo pero pudieron quedar repetidos en pantalla. */
let remembered: string[] = [];
/** De esos, los que no se guardan en sessionStorage (contraseñas). */
const secret = new Set<string>();
/** Valor actual de cada campo tocado en esta página. */
const live = new Map<Element, string>();
let mask: RegExp | null = null;
let dirty = false;

function remember(value: string, isSecret: boolean): void {
  for (const token of tokensOf(value)) {
    if (remembered.includes(token)) continue;
    remembered.push(token);
    if (isSecret) secret.add(token);
  }
  if (remembered.length > MAX_REMEMBERED) remembered = remembered.slice(-MAX_REMEMBERED);
  dirty = true;
}

function currentMask(): RegExp | null {
  if (dirty) {
    const all = [...remembered];
    for (const value of live.values()) all.push(...tokensOf(value));
    mask = buildMask(all);
    dirty = false;
  }
  return mask;
}

/** Tapa en `text` lo que el participante escribió en algún campo. */
export function maskTyped(text: string): string {
  return maskWith(text, currentMask());
}

/**
 * Para rrweb (`maskTextFn`): tapa lo escrito, y todo el texto de una zona editable
 * (`contenteditable`), que es un campo aunque no sea un <input>.
 */
export function maskRecordedText(text: string, element: HTMLElement | null): string {
  if (element?.isContentEditable) return text.replace(/\S/g, '*');
  return maskTyped(text);
}

const NOT_TYPED = new Set(['checkbox', 'radio', 'range', 'color', 'file', 'button', 'submit', 'reset', 'image', 'hidden']);

function typedValue(el: Element): { value: string; secret: boolean } | null {
  if (el instanceof HTMLInputElement) {
    if (NOT_TYPED.has(el.type)) return null;
    return { value: el.value, secret: el.type === 'password' };
  }
  if (el instanceof HTMLTextAreaElement) return { value: el.value, secret: false };
  if (el instanceof HTMLElement && el.isContentEditable) return { value: (el.innerText ?? '').slice(0, MAX_VALUE_LENGTH), secret: false };
  return null;
}

function save(): void {
  const all = new Set(remembered.filter((s) => !secret.has(s)));
  for (const [el, value] of live) {
    if (el instanceof HTMLInputElement && el.type === 'password') continue;
    for (const token of tokensOf(value)) all.add(token);
  }
  if (all.size > 0) storageSet(KEY, JSON.stringify([...all].slice(-MAX_REMEMBERED)));
}

/**
 * Empieza a recordar lo que se escribe. Escucha en fase de captura: se entera antes que el
 * prototipo, así el texto ya está en la lista cuando el prototipo lo copia a otro lado.
 */
export function watchTyping(): () => void {
  try {
    const stored = JSON.parse(storageGet(KEY) ?? '[]') as unknown;
    if (Array.isArray(stored)) remembered = stored.filter((s): s is string => typeof s === 'string').slice(-MAX_REMEMBERED);
  } catch {
    remembered = [];
  }
  dirty = true;

  const note = (target: EventTarget | null): void => {
    if (!(target instanceof Element) || target.closest('[data-taptana-ui]')) return;
    const typed = typedValue(target);
    if (!typed) return;
    const before = live.get(target) ?? '';
    // Si el valor se acortó o cambió, lo anterior pudo quedar copiado en la pantalla.
    if (before && !typed.value.startsWith(before)) remember(before, typed.secret);
    live.set(target, typed.value);
    dirty = true;
  };
  const onInput = (e: Event): void => note(e.target);
  const onChange = (e: Event): void => {
    note(e.target);
    save();
  };
  // Un campo que ya traía texto al cargar (autocompletado, valor restaurado) también cuenta.
  const onFocus = (e: Event): void => note(e.target);

  document.addEventListener('input', onInput, true);
  document.addEventListener('change', onChange, true);
  document.addEventListener('focusin', onFocus, true);
  window.addEventListener('pagehide', save);
  return () => {
    save();
    document.removeEventListener('input', onInput, true);
    document.removeEventListener('change', onChange, true);
    document.removeEventListener('focusin', onFocus, true);
    window.removeEventListener('pagehide', save);
  };
}
