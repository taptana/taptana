/**
 * La dirección de un prototipo por URL, tal como la escribe el diseñador: "mi-app.vercel.app",
 * "localhost:5173", "https://x.lovable.app/#/inicio". Se normaliza igual en el panel y en el
 * servidor.
 */

/** ¿Es una máquina de la red local o esta misma computadora? Entonces lo normal es http://. */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h === '::1' || h === '0.0.0.0') return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(h);
  if (!m) return h.includes(':') && (h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80:'));
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

export type NormalizedUrl = { ok: true; url: string } | { ok: false; error: string };

/**
 * Quita espacios, agrega el protocolo si falta (https://, o http:// para localhost y la red
 * local) y quita el #fragmento. Solo acepta http y https, sin usuario ni contraseña.
 */
export function normalizePrototypeUrl(input: string): NormalizedUrl {
  const raw = input.trim();
  if (!raw) return { ok: false, error: 'Escribe la dirección de tu prototipo.' };
  if (raw.length > 2000) return { ok: false, error: 'Esa dirección es demasiado larga.' };
  let candidate = raw;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
    if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(candidate)) {
      return { ok: false, error: 'La dirección tiene que empezar con http:// o https://.' };
    }
    const host = candidate.replace(/^\/+/, '').split(/[/?#]/)[0] ?? '';
    const hostname = host.replace(/:\d+$/, '');
    candidate = `${isPrivateHost(hostname) ? 'http' : 'https'}://${candidate.replace(/^\/+/, '')}`;
  }
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, error: 'Esa dirección no parece una URL. Cópiala tal cual desde el navegador, por ejemplo https://mi-app.vercel.app.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, error: 'La dirección tiene que empezar con http:// o https://.' };
  if (url.username || url.password) return { ok: false, error: 'Quita el usuario y la contraseña de la dirección: Taptana no los guarda.' };
  if (!url.hostname) {
    return { ok: false, error: 'Esa dirección no tiene un sitio válido.' };
  }
  url.hash = '';
  return { ok: true, url: url.toString() };
}
