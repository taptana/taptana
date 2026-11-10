/**
 * Un solo nombre por pantalla en todo el panel (constructor, reporte, reproductor).
 *
 * La fuente es la lista de pantallas de la API (`listPrototypeScreens`) o los nombres que trae
 * el reporte: `name` es el nombre único de la pantalla (lo decide `shared`); si el servidor es
 * anterior y no lo manda, vale `title`. Si la pantalla no está en la lista se usa el nombre corto
 * que sale de su ruta ("/producto.html" → "producto"). Nunca el título de una visita concreta
 * ("Monstera deliciosa"), que cambia según el contenido.
 */
import { sameScreen, screenParts } from '@taptana/shared';
import { screenName } from './format.ts';

export type ScreenNamer = (id: string) => string;

export interface NamedScreen {
  id: string;
  /** El nombre único para mostrar, si la API ya lo manda. */
  name?: string | undefined;
  title?: string | undefined;
}

const shown = (s: NamedScreen): string => s.name?.trim() || s.title?.trim() || '';

/** Nombre de una pantalla según la lista conocida. */
export function nameScreen(id: string, screens: readonly NamedScreen[]): string {
  if (!id) return '';
  const known = screens.find((s) => shown(s) && sameScreen(s.id, id));
  return known ? shown(known) : screenName(id);
}

export function screenNamer(screens: readonly NamedScreen[]): ScreenNamer {
  const cache = new Map<string, string>();
  return (id) => {
    let name = cache.get(id);
    if (name === undefined) {
      name = nameScreen(id, screens);
      cache.set(id, name);
    }
    return name;
  };
}

/**
 * ¿Sirve como nombre el título que la pantalla mostró en vivo? Solo en pantallas que no son un
 * archivo (rutas con hash o pantallas virtuales): ahí el título es de la pantalla. En un archivo
 * ("/producto.html?id=3") el título puede ser el del contenido de esa visita.
 */
export function liveTitleIsStable(id: string): boolean {
  const parts = screenParts(id);
  return Boolean(parts.hash || parts.virtual);
}
