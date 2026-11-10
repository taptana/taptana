/**
 * Configuración por variables de entorno y flags. Los flags ganan.
 *
 *   TAPTANA_PORT        (4321)
 *   TAPTANA_HOST        (0.0.0.0)
 *   TAPTANA_DATA_DIR    (.taptana/ en la carpeta actual)
 *   TAPTANA_PANEL       "open": el panel se abre desde cualquier dispositivo de la red, sin llave
 *   TAPTANA_PUBLIC_URL  dirección con la que se llega desde fuera, si no es la IP de esta
 *                       computadora (Docker, un túnel, un proxy): "https://taptana.ejemplo.com"
 */

import { isAbsolute, resolve } from 'node:path';
import { DEFAULT_HOST, DEFAULT_PORT } from '@taptana/shared';

export interface ServerConfig {
  port: number;
  host: string;
  /** Carpeta donde vive la base de datos. */
  dataDir: string;
  /** Carpeta del prototipo que se sirve (modo dev). */
  prototypeDir: string;
  /** Inyectar el recorder también en el panel, para probar Taptana con Taptana. */
  recordSelf: boolean;
  /** Mostrar el QR en la terminal. */
  qr: boolean;
  /** Panel abierto a toda la red, sin llave. */
  openPanel: boolean;
  /** Abrir el navegador al arrancar (solo `taptana start`). */
  openBrowser: boolean;
  /** Dirección pública fija, sin barra final. */
  publicUrl?: string;
}

export interface Flags {
  port?: string;
  host?: string;
  dataDir?: string;
  recordSelf?: boolean;
  qr?: boolean;
  openPanel?: boolean;
  open?: boolean;
  publicUrl?: string;
}

/**
 * Desde dónde se entienden las rutas relativas. Con `pnpm start` o `pnpm --filter … dev
 * ./carpeta`, pnpm cambia de carpeta antes de correr el comando y deja en INIT_CWD la carpeta
 * donde la persona lo escribió: esa es la que vale.
 */
export function invocationDir(env: NodeJS.ProcessEnv = process.env): string {
  const invokedFrom = env['INIT_CWD'];
  return invokedFrom && isAbsolute(invokedFrom) ? invokedFrom : process.cwd();
}

export function resolveConfig(prototypeDir: string, flags: Flags, env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const rawPort = flags.port ?? env['TAPTANA_PORT'] ?? String(DEFAULT_PORT);
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Puerto inválido: ${rawPort}. Tiene que ser un número entre 1 y 65535.`);
  }
  const base = invocationDir(env);
  const config: ServerConfig = {
    port,
    host: flags.host ?? env['TAPTANA_HOST'] ?? DEFAULT_HOST,
    dataDir: resolve(base, flags.dataDir ?? env['TAPTANA_DATA_DIR'] ?? '.taptana'),
    prototypeDir: resolve(base, prototypeDir),
    recordSelf: flags.recordSelf ?? false,
    qr: flags.qr ?? true,
    openPanel: flags.openPanel ?? env['TAPTANA_PANEL']?.trim().toLowerCase() === 'open',
    openBrowser: flags.open ?? true,
  };
  const rawUrl = (flags.publicUrl ?? env['TAPTANA_PUBLIC_URL'] ?? '').trim();
  if (rawUrl) {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new Error(`Dirección pública inválida: ${rawUrl}. Escríbela completa, por ejemplo https://taptana.ejemplo.com`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`Dirección pública inválida: ${rawUrl}. Tiene que empezar con http:// o https://`);
    }
    config.publicUrl = url.origin;
  }
  return config;
}
