/**
 * Cómo se nombra y se muestra una sesión en el panel. Funciones puras (con pruebas).
 */

import type { SessionSummary } from '@taptana/shared';

type Named = Pick<SessionSummary, 'label' | 'participant'>;

/** Nombre para mostrar: la etiqueta del moderador, si no el alias del participante. */
export function sessionName(session: Named): string | undefined {
  return session.label?.trim() || session.participant?.trim() || undefined;
}

/** Texto seguro para un nombre de archivo: minúsculas, sin acentos, con guiones. */
export function fileSlug(text: string, max = 40): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '');
}

/** "taptana-p3-ana-2026-03-14.json": etiqueta (o alias, o dispositivo) + fecha local. */
export function exportFileName(session: Named & Pick<SessionSummary, 'startedAt' | 'deviceLabel'>): string {
  const who = fileSlug(sessionName(session) ?? '') || fileSlug(session.deviceLabel ?? '') || 'sesion';
  const d = new Date(session.startedAt);
  const pad = (n: number): string => String(n).padStart(2, '0');
  const day = Number.isFinite(d.getTime()) ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : 'sin-fecha';
  return `taptana-${who}-${day}.json`;
}

/**
 * Las sesiones grabadas en otro sitio (la demo de Pages, otra instalación) traen en sus rutas
 * la carpeta donde vivía el prototipo ("/taptana/prototipo/carrito.html", "/p/pr_abc/…").
 * Esto la quita para mostrar "/carrito.html", igual que en una sesión grabada aquí.
 */
export function stripPrototypeBase(path: string): string {
  const m = /^(?:\/[^/?#]+)*?\/(?:prototipo|(?:local|p)\/pr_[^/?#]+)(\/[^]*|)$/.exec(path);
  if (!m) return path;
  return m[1] || '/';
}

/** "2/3": tareas logradas sobre tareas del estudio. */
export function taskTally(tasks: SessionSummary['tasks']): { done: number; total: number } | null {
  if (!tasks || tasks.length === 0) return null;
  return { done: tasks.filter((t) => t.outcome === 'success').length, total: tasks.length };
}
