#!/usr/bin/env node
/**
 * taptana dev <carpeta>   sirve el prototipo, graba sesiones y muestra el panel
 * taptana seed [archivos] importa sesiones de ejemplo en la base local
 */

import { parseArgs } from 'node:util';
import { basename, dirname, join, resolve } from 'node:path';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { LOCAL_PROTOTYPE_ID, PANEL_PATH, type SessionExport } from '@taptana/shared';
import { resolveConfig } from './config.js';
import { createApp } from './app.js';
import { SqliteStore } from './store/sqlite.js';
import { localAddresses, renderQr } from './network.js';

const VERSION = (JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')) as { version: string }).version;

const HELP = `taptana · pruebas de usabilidad para prototipos HTML

Uso:
  taptana dev <carpeta>        Sirve la carpeta e inyecta el recorder en cada HTML
  taptana seed [archivo.json]  Importa sesiones de ejemplo (por defecto, las del paquete)

Opciones:
  --port <n>        Puerto (TAPTANA_PORT, 4321)
  --host <ip>       Dirección donde escuchar (TAPTANA_HOST, 0.0.0.0)
  --data-dir <dir>  Carpeta de datos (TAPTANA_DATA_DIR, .taptana)
  --record-self     Graba también el uso del panel
  --no-qr           No mostrar el código QR
  -h, --help        Esta ayuda
`;

async function main(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      port: { type: 'string' },
      host: { type: 'string' },
      'data-dir': { type: 'string' },
      'record-self': { type: 'boolean' },
      qr: { type: 'boolean', default: true },
      help: { type: 'boolean', short: 'h' },
    },
    allowNegative: true,
  });

  const [command, ...rest] = positionals;
  if (values.help || !command) {
    process.stdout.write(HELP);
    process.exit(values.help ? 0 : 1);
  }

  const flags = {
    ...(values.port !== undefined && { port: values.port }),
    ...(values.host !== undefined && { host: values.host }),
    ...(values['data-dir'] !== undefined && { dataDir: values['data-dir'] }),
    ...(values['record-self'] !== undefined && { recordSelf: values['record-self'] }),
    qr: values.qr,
  };

  if (command === 'dev') return dev(rest[0] ?? '.', flags);
  if (command === 'seed') return seed(rest, flags);
  process.stderr.write(`Comando desconocido: ${command}\n\n${HELP}`);
  process.exit(1);
}

async function dev(dir: string, flags: Parameters<typeof resolveConfig>[1]): Promise<void> {
  const config = resolveConfig(dir, flags);
  if (!existsSync(config.prototypeDir) || !statSync(config.prototypeDir).isDirectory()) {
    process.stderr.write(`No existe la carpeta: ${config.prototypeDir}\n`);
    process.exit(1);
  }

  const store = new SqliteStore(join(config.dataDir, 'taptana.db'));
  store.ensurePrototype({ id: LOCAL_PROTOTYPE_ID, name: basename(config.prototypeDir), createdAt: Date.now() });

  const ips = config.host === '0.0.0.0' || config.host === '::' ? localAddresses() : [config.host];
  const primary = ips[0] ?? 'localhost';
  const participantUrl = `http://${primary}:${config.port}/`;

  const app = createApp({
    store,
    prototypeDir: config.prototypeDir,
    prototypeId: LOCAL_PROTOTYPE_ID,
    recordSelf: config.recordSelf,
    info: {
      version: VERSION,
      participantUrl,
      prototypeId: LOCAL_PROTOTYPE_ID,
      prototypeName: basename(config.prototypeDir),
    },
  });

  serve({ fetch: app.fetch, port: config.port, hostname: config.host }, async (info) => {
    const lines = [
      '',
      `  Taptana · sirviendo ${config.prototypeDir}`,
      '',
      `  Participante (celular en la misma Wi-Fi):  ${participantUrl}`,
      ...ips.slice(1).map((ip) => `                                             http://${ip}:${info.port}/`),
      `  Sesiones:                                  http://${primary}:${info.port}${PANEL_PATH}`,
      `  Local:                                     http://localhost:${info.port}/`,
      '',
      `  Datos: ${join(config.dataDir, 'taptana.db')}`,
      config.recordSelf ? '  Grabando también el panel (--record-self)' : '',
      '',
    ];
    process.stdout.write(lines.filter((l) => l !== '').join('\n') + '\n');
    if (config.qr) {
      process.stdout.write(await renderQr(participantUrl));
      process.stdout.write('\n  Escanea el QR con el celular para abrir el prototipo.\n\n');
    }
  });

  const shutdown = (): void => {
    store.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function seed(files: string[], flags: Parameters<typeof resolveConfig>[1]): Promise<void> {
  const config = resolveConfig('.', flags);
  const store = new SqliteStore(join(config.dataDir, 'taptana.db'));
  let paths = files.map((f) => resolve(f));
  if (paths.length === 0) {
    const bundled = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'seed');
    paths = existsSync(bundled)
      ? readdirSync(bundled)
          .filter((f) => f.endsWith('.json'))
          .map((f) => join(bundled, f))
      : [];
  }
  if (paths.length === 0) {
    process.stderr.write('No hay sesiones para importar.\n');
    process.exit(1);
  }
  for (const path of paths) {
    const data = JSON.parse(readFileSync(path, 'utf8')) as SessionExport;
    store.importSession(data);
    process.stdout.write(`  importada ${data.session.id} (${basename(path)})\n`);
  }
  store.close();
  process.stdout.write(`\n  ${paths.length} sesión(es) en ${join(config.dataDir, 'taptana.db')}\n`);
}

main(process.argv.slice(2)).catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
