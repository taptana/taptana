/**
 * Abre una dirección en el navegador de quien corre Taptana, con el comando de cada sistema.
 * Si no se puede (un servidor sin pantalla, Docker, Codespaces) no pasa nada: la dirección
 * ya está impresa en la terminal.
 */

import { spawn } from 'node:child_process';

export interface OpenCommand {
  command: string;
  args: string[];
}

export function openCommand(platform: NodeJS.Platform, url: string): OpenCommand {
  if (platform === 'darwin') return { command: 'open', args: [url] };
  // `start` toma su primer argumento entre comillas como título de ventana: va uno vacío.
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '', url] };
  return { command: 'xdg-open', args: [url] };
}

/** Nunca lanza un error ni detiene el servidor. */
export function openBrowser(url: string, platform: NodeJS.Platform = process.platform): void {
  try {
    const { command, args } = openCommand(platform, url);
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => undefined);
    child.unref();
  } catch {
    /* sin navegador que abrir */
  }
}
