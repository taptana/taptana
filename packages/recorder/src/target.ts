/**
 * Describe el elemento tocado sin guardar contenido sensible.
 */

import type { TargetInfo } from '@taptana/shared';

const MAX_TEXT = 40;
const MAX_DEPTH = 5;
const SENSITIVE_TAGS = new Set(['input', 'textarea', 'select', 'option']);

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

function isSensitive(el: Element): boolean {
  if (SENSITIVE_TAGS.has(el.tagName.toLowerCase())) return true;
  return el.closest('[contenteditable=""], [contenteditable="true"], input, textarea, select') !== null;
}

/** El elemento "interesante" más cercano: botón, enlace, input... o el propio elemento. */
function interactiveAncestor(el: Element): Element {
  return el.closest('button, a, input, textarea, select, label, [role="button"], [role="link"], summary') ?? el;
}

/** Algo con cursor de mano cuenta como tocable: los prototipos con IA usan divs con onClick. */
function looksClickable(el: Element): boolean {
  let node: Element | null = el;
  for (let i = 0; node && i < 4; i++, node = node.parentElement) {
    if (node === document.body) break;
    try {
      if (getComputedStyle(node).cursor === 'pointer') return true;
    } catch {
      return false;
    }
    if ((node as HTMLElement).onclick) return true;
  }
  return false;
}

export function describeTarget(raw: Element): TargetInfo {
  const el = interactiveAncestor(raw);
  const info: TargetInfo = {
    tag: el.tagName.toLowerCase(),
    selector: buildSelector(el),
    interactive: el !== raw || el.matches('button, a, input, textarea, select, label, summary, [role="button"], [role="link"]') || looksClickable(raw),
  };
  if (el.id) info.id = el.id;
  const classes = Array.from(el.classList).slice(0, 5);
  if (classes.length) info.classes = classes;
  const role = el.getAttribute('role');
  if (role) info.role = role;
  if (!isSensitive(el)) {
    // innerText respeta el layout (pone saltos entre bloques); textContent los pega.
    const raw = el instanceof HTMLElement ? el.innerText : el.textContent;
    const text = (raw ?? '').replace(/\s+/g, ' ').trim();
    if (text) info.text = text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
  }
  return info;
}
