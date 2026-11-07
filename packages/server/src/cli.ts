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
  taptana dev                  Abre el panel para subir prototipos (.html o .zip)
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

  if (command === 'dev') return dev(rest[0], flags);
  if (command === 'seed') return seed(rest, flags);
  process.stderr.write(`Comando desconocido: ${command}\n\n${HELP}`);
  process.exit(1);
}

/**
 * `taptana dev ./carpeta` sirve esa carpeta como prototipo "local".
 * `taptana dev` sin carpeta solo abre el panel: los prototipos se suben desde ahí (.html o .zip).
 */
async function dev(dir: string | undefined, flags: Parameters<typeof resolveConfig>[1]): Promise<void> {
  const config = resolveConfig(dir ?? '.', flags);
  const folder = dir === undefined ? undefined : config.prototypeDir;
  if (folder && (!existsSync(folder) || !statSync(folder).isDirectory())) {
    process.stderr.write(`No existe la carpeta: ${folder}\n`);
    process.exit(1);
  }

  const store = new SqliteStore(join(config.dataDir, 'taptana.db'));
  if (folder) store.savePrototype({ id: LOCAL_PROTOTYPE_ID, name: basename(folder), createdAt: Date.now(), source: 'folder', entryPath: '/' });

  const ips = config.host === '0.0.0.0' || config.host === '::' ? localAddresses() : [config.host];
  const primary = ips[0] ?? 'localhost';
  const baseUrl = `http://${primary}:${config.port}`;
  const panelUrl = `${baseUrl}${PANEL_PATH}`;
  const participantUrl = folder ? `${baseUrl}/` : `${panelUrl}/prototypes`;

  const app = createApp({
    store,
    ...(folder && { prototypeDir: folder }),
    dataDir: config.dataDir,
    prototypeId: LOCAL_PROTOTYPE_ID,
    recordSelf: config.recordSelf,
    info: {
      version: VERSION,
      participantUrl: `${baseUrl}/`,
      prototypeId: folder ? LOCAL_PROTOTYPE_ID : '',
      prototypeName: folder ? basename(folder) : '',
    },
  });

  serve({ fetch: app.fetch, port: config.port, hostname: config.host }, async (info) => {
    const lines = [
      '',
      folder ? `  Taptana · sirviendo ${folder}` : '  Taptana · sube tus prototipos (.html o .zip) desde el panel',
      '',
      folder ? `  Participante (celular en la misma Wi-Fi):  ${participantUrl}` : '',
      ...(folder ? ips.slice(1).map((ip) => `                                             http://${ip}:${info.port}/`) : []),
      `  Panel:                                     ${panelUrl}`,
      `  Local:                                     http://localhost:${info.port}${folder ? '/' : PANEL_PATH}`,
      '',
      `  Datos: ${config.dataDir}  (todo queda en esta computadora)`,
      config.recordSelf ? '  Grabando también el panel (--record-self)' : '',
      '',
    ];
    process.stdout.write(lines.filter((l) => l !== '').join('\n') + '\n');
    if (config.qr && folder) {
      process.stdout.write(await renderQr(participantUrl));
      process.stdout.write('\n  Escanea el QR con el celular para abrir el prototipo.\n\n');
    } else if (!folder) {
      process.stdout.write('\n  Abre el panel, sube tu prototipo y escanea su QR con el celular.\n\n');
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
