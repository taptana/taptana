/**
 * Taptana usa el SQLite que viene dentro de Node (`node:sqlite`), que existe desde Node 22.5.
 * Este archivo no importa nada: se puede cargar en cualquier versión de Node para explicar
 * el problema en vez de fallar con un error críptico.
 */

export const MIN_NODE = { major: 22, minor: 5 } as const;

/** Mensaje para quien tiene un Node demasiado viejo, o null si la versión sirve. */
export function nodeProblem(version: string): string | null {
  const [major = 0, minor = 0] = version.replace(/^v/, '').split('.').map((part) => Number.parseInt(part, 10) || 0);
  if (major > MIN_NODE.major || (major === MIN_NODE.major && minor >= MIN_NODE.minor)) return null;
  return [
    `Taptana necesita Node.js ${MIN_NODE.major}.${MIN_NODE.minor} o más nuevo, y esta computadora tiene la versión ${version}.`,
    'Descarga la versión actual (LTS) en https://nodejs.org, instálala y vuelve a intentar.',
  ].join('\n');
}

/** Node 22.5 a 22.12 trae SQLite, pero apagado salvo que se pida con una opción. */
export function sqliteProblem(version: string): string {
  return [
    `Tu Node.js (${version}) trae SQLite desactivado, y Taptana lo necesita para guardar las sesiones.`,
    'Actualiza a Node.js 22.13 o más nuevo desde https://nodejs.org y vuelve a intentar.',
  ].join('\n');
}
