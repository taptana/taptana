export const pct = (n: number): string => `${Math.round(n * 100)}%`;

export function seconds(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;
  return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

/** "/producto.html" → "producto" para mostrar pantallas de forma amable. */
export function screenName(path: string): string {
  const name = path.replace(/^\//, '').replace(/\.html?$/, '').replace(/\/index$/, '') || 'inicio';
  return name === 'index' ? 'inicio' : name;
}
