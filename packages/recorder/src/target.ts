/**
 * Describe el elemento tocado sin guardar contenido sensible.
 */

import type { TargetInfo } from '@taptana/shared';
import { maskTyped } from './privacy.js';

const MAX_TEXT = 40;
const MAX_DEPTH = 5;
const FIELD = 'input, textarea, select';
const CONTROLS =
  'button, input, textarea, select, label, summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="radio"], [role="switch"], [role="option"]';
/** Para describir el toque: un <a> cuenta aunque no tenga href (se describe el enlace entero). */
const DESCRIBED = `a, ${CONTROLS}`;
/** Tocable de verdad: un <a> sin href no lleva a ningún lado por sí solo. */
const TOCABLE = `a[href], ${CONTROLS}`;
/** Un <input> de estos tipos es un botón: su `value` es su etiqueta, no algo escrito. */
const BUTTON_TYPES = new Set(['button', 'submit', 'reset']);

function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/[^\w-]/g, '\\$&');
}

function segment(el: Element): string {
  if (el.id) return `#${cssEscape(el.id)}`;
  const tag = el.tagName.toLowerCase();
  const parent = el.parentElement;
  if (!parent) return tag;
  const siblings = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
  if (siblings.length === 1) return tag;
  return `${tag}:nth-of-type(${siblings.indexOf(el) + 1})`;
}

/** Ruta CSS corta, de adentro hacia afuera, hasta 5 niveles o hasta un elemento con id. */
export function buildSelector(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node !== document.documentElement && parts.length < MAX_DEPTH) {
    const seg = segment(node);
    parts.unshift(seg);
    if (seg.startsWith('#')) break;
    node = node.parentElement;
    if (node === document.body) {
      parts.unshift('body');
      break;
    }
  }
  return parts.join(' > ');
}

/** El elemento "interesante" más cercano: botón, enlace, campo... o el propio elemento. */
export function interactiveAncestor(el: Element): Element {
  return el.closest(DESCRIBED) ?? el;
}

/**
 * ¿Es tocable por naturaleza? Un enlace, botón o campo; algo con `role` de control, con
 * `onclick`, o con cursor de mano (los prototipos hechos con IA usan mucho <div onclick>).
 * Mira el elemento y hasta tres ancestros.
 */
export function isNaturallyInteractive(raw: Element): boolean {
  if (raw.closest(TOCABLE)) return true;
  let node: Element | null = raw;
  for (let i = 0; node && i < 4; i++, node = node.parentElement) {
    if (node === document.body || node === document.documentElement) break;
    if (node.hasAttribute('onclick') || (node as HTMLElement).onclick) return true;
    if (node instanceof HTMLElement && node.isContentEditable) return true;
    try {
      if (getComputedStyle(node).cursor === 'pointer') return true;
    } catch {
      return false;
    }
  }
  return false;
}

function clean(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

/** Texto de un <label> sin el contenido de los campos que envuelve. */
function labelText(label: Element): string {
  let out = '';
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) out += node.nodeValue ?? '';
    else if (node instanceof Element && !node.matches(FIELD)) node.childNodes.forEach(walk);
  };
  walk(label);
  return clean(out);
}

/** Cómo se llama un campo: su etiqueta, `aria-label` o placeholder. Nunca su valor. */
function fieldLabel(el: Element): string {
  if (el instanceof HTMLInputElement && BUTTON_TYPES.has(el.type)) return clean(el.value);
  const labels = (el as HTMLInputElement).labels;
  const first = labels?.[0];
  if (first) {
    const text = labelText(first);
    if (text) return text;
  }
  const aria = clean(el.getAttribute('aria-label'));
  if (aria) return aria;
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const ref = document.getElementById(labelledBy.split(/\s+/)[0] ?? '');
    const text = ref ? clean(ref.textContent) : '';
    if (text) return text;
  }
  return clean(el.getAttribute('placeholder')) || clean(el.getAttribute('title'));
}

function visibleText(el: Element): string {
  if (el.matches(FIELD)) return fieldLabel(el);
  if (el.tagName === 'OPTION') return '';
  if (el.tagName === 'LABEL') return labelText(el);
  // Una zona editable es un campo: no se guarda lo que tiene escrito.
  if (el instanceof HTMLElement && el.isContentEditable) return clean(el.getAttribute('aria-label'));
  // innerText respeta el layout (pone saltos entre bloques); textContent los pega.
  const text = clean(el instanceof HTMLElement ? el.innerText : el.textContent);
  return text || clean(el.getAttribute('aria-label')) || clean(el.getAttribute('alt')) || clean(el.getAttribute('title'));
}

export function describeTarget(raw: Element): TargetInfo {
  const el = interactiveAncestor(raw);
  const info: TargetInfo = {
    tag: el.tagName.toLowerCase(),
    selector: buildSelector(el),
    interactive: isNaturallyInteractive(raw),
  };
  if (el.id) info.id = el.id;
  const classes = Array.from(el.classList).slice(0, 5);
  if (classes.length) info.classes = classes;
  const role = el.getAttribute('role');
  if (role) info.role = role;
  // Si el prototipo copió en este elemento algo que el participante escribió, se tapa.
  const text = maskTyped(visibleText(el));
  if (text) info.text = text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
  return info;
}

function matchesOnlyThis(selector: string, el: Element): boolean {
  try {
    const found = document.querySelectorAll(selector);
    return found.length === 1 && found[0] === el;
  } catch {
    return false;
  }
}

/**
 * El selector más corto y estable para señalar un elemento desde el panel: su id, una clase
 * que solo tenga él, o la ruta. Solo usa formas que `tapMatches` (shared) también entiende.
 */
export function shortSelector(raw: Element): string {
  const el = interactiveAncestor(raw);
  if (el.id && /^[\w-]+$/.test(el.id) && matchesOnlyThis(`#${el.id}`, el)) return `#${el.id}`;
  const simple = Array.from(el.classList).filter((c) => /^[A-Za-z_][\w-]*$/.test(c));
  for (const c of simple) if (matchesOnlyThis(`.${c}`, el)) return `.${c}`;
  const tag = el.tagName.toLowerCase();
  for (const c of simple) if (matchesOnlyThis(`${tag}.${c}`, el)) return `${tag}.${c}`;
  return buildSelector(el);
}
