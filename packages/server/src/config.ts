/**
 * Configuración por variables de entorno y flags. Los flags ganan.
 *
 *   TAPTANA_PORT      (4321)
 *   TAPTANA_HOST      (0.0.0.0)
 *   TAPTANA_DATA_DIR  (.taptana/ en la carpeta actual)
 */

import { resolve } from 'node:path';
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
}

export interface Flags {
  port?: string;
  host?: string;
  dataDir?: string;
  recordSelf?: boolean;
  qr?: boolean;
}

export function resolveConfig(prototypeDir: string, flags: Flags, env = process.env): ServerConfig {
  const port = Number(flags.port ?? env['TAPTANA_PORT'] ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Puerto inválido: ${flags.port ?? env['TAPTANA_PORT']}`);
  }
  return {
    port,
    host: flags.host ?? env['TAPTANA_HOST'] ?? DEFAULT_HOST,
    dataDir: resolve(flags.dataDir ?? env['TAPTANA_DATA_DIR'] ?? '.taptana'),
    prototypeDir: resolve(prototypeDir),
    recordSelf: flags.recordSelf ?? false,
    qr: flags.qr ?? true,
  };
}
