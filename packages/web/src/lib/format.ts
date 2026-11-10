import { screenLabel } from '@taptana/shared';

export const pct = (n: number): string => `${Math.round(n * 100)} %`;

export function seconds(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1).replace('.', ',') : Math.round(s)} s`;
  return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

/** "/producto.html" → "producto" para mostrar pantallas de forma amable. */
export function screenName(path: string): string {
  const label = screenLabel(path);
  return !label || label === 'index' ? 'inicio' : label;
}

/** "1 sesión", "3 sesiones". Con `none`, ese texto cuando no hay ninguna. */
export function plural(n: number, one: string, many: string, none?: string): string {
  if (n === 0 && none !== undefined) return none;
  return `${n} ${n === 1 ? one : many}`;
}
