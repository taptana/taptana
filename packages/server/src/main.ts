/**
 * Los comandos de `taptana`:
 *
 *   taptana start [carpeta]   arranca y abre el panel en el navegador
 *   taptana dev [carpeta]     lo mismo, sin abrir el navegador
 *   taptana seed [archivos]   carga el ejemplo, o importa sesiones exportadas
 */

import { parseArgs } from 'node:util';
import { basename, join, resolve } from 'node:path';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { LOCAL_PROTOTYPE_ID, PANEL_PATH, validateSessionExport, type ServerInfo } from '@taptana/shared';
import { invocationDir, resolveConfig, type Flags, type ServerConfig } from './config.js';
import { createApp } from './app.js';
import { ExampleError, loadExample } from './example.js';
import { listen, ListenError, type Listening } from './listen.js';
import { isLoopback, localAddresses, renderQr } from './network.js';
import { openBrowser } from './open-browser.js';
import { loadPanelKey, PANEL_KEY_PARAM } from './panel-guard.js';
import { SqliteStore } from './store/sqlite.js';
import { VERSION } from './version.js';

export const HELP = `taptana · pruebas de usabilidad para prototipos HTML

Uso:
  taptana start                Arranca Taptana y abre el panel en tu navegador.
                               Desde el panel subes tu prototipo (.html o .zip).
  taptana start <carpeta>      Lo mismo, y además sirve esa carpeta como prototipo
  taptana dev [carpeta]        Como start, pero sin abrir el navegador
  taptana seed                 Carga el ejemplo: una tienda, su estudio y sesiones ya grabadas
  taptana seed <archivo.json>  Importa sesiones exportadas desde el panel

Opciones:
  --port <n>          Puerto (TAPTANA_PORT, 4321). Si está ocupado se usa el siguiente libre
  --host <ip>         Dirección donde escuchar (TAPTANA_HOST, 0.0.0.0)
  --data-dir <dir>    Carpeta de datos (TAPTANA_DATA_DIR, .taptana)
  --no-open           No abrir el navegador (solo aplica a start)
  --open-panel        Deja ver el panel desde cualquier dispositivo de la red, sin llave
                      (TAPTANA_PANEL=open). Sin esto, otros dispositivos necesitan el link
                      con llave que aparece al arrancar
  --public-url <url>  Dirección con la que se llega desde fuera, si no es la IP de esta
                      computadora: Docker, un túnel (TAPTANA_PUBLIC_URL)
  --record-self       Graba también el uso del panel
  --no-qr             No mostrar el código QR
  -v, --version       La versión de Taptana
  -h, --help          Esta ayuda
`;

/** Termina con un mensaje claro, sin volcar la pila. */
function fail(message: string): never {
  process.stderr.write(`\n  ${message.split('\n').join('\n  ')}\n\n`);
  process.exit(1);
}

export async function main(argv: string[]): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      allowNegative: true,
      options: {
        port: { type: 'string' },
        host: { type: 'string' },
        'data-dir': { type: 'string' },
        'public-url': { type: 'string' },
        'record-self': { type: 'boolean' },
        'open-panel': { type: 'boolean' },
        open: { type: 'boolean' },
        qr: { type: 'boolean' },
        version: { type: 'boolean', short: 'v' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (err) {
    fail(`${explainArgsError(err)}\nCorre «taptana --help» para ver las opciones.`);
  }
  const { values, positionals } = parsed;
  const [command, ...rest] = positionals;

  if (values.version) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (values.help || command === 'help') {
    process.stdout.write(HELP);
    return;
  }
  if (!command) {
    process.stdout.write(HELP);
    process.exit(1);
  }

  const flags: Flags = {
    ...(values.port !== undefined && { port: values.port }),
    ...(values.host !== undefined && { host: values.host }),
    ...(values['data-dir'] !== undefined && { dataDir: values['data-dir'] }),
    ...(values['public-url'] !== undefined && { publicUrl: values['public-url'] }),
    ...(values['record-self'] !== undefined && { recordSelf: values['record-self'] }),
    ...(values['open-panel'] !== undefined && { openPanel: values['open-panel'] }),
    ...(values.open !== undefined && { open: values.open }),
    ...(values.qr !== undefined && { qr: values.qr }),
  };

  try {
    if (command === 'start' || command === 'dev') return await run(command, rest[0], flags);
    if (command === 'seed') return await seed(rest, flags);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  fail(`No conozco el comando «${command}».\nCorre «taptana --help» para ver los que hay.`);
}

function explainArgsError(err: unknown): string {
  const code = (err as { code?: string }).code;
  const message = err instanceof Error ? err.message : String(err);
  const option = /'(-{1,2}[^' ]+)/.exec(message)?.[1];
  if (code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' && option) return `No conozco la opción ${option}.`;
  if (code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE' && option) return `A la opción ${option} le falta su valor (o le sobra uno).`;
  return `No entendí las opciones: ${message}`;
}

function openStore(config: ServerConfig): SqliteStore {
  const file = join(config.dataDir, 'taptana.db');
  try {
    return new SqliteStore(file);
  } catch (err) {
    throw new Error(
      `No se pudo abrir la base de datos ${file}\n${err instanceof Error ? err.message : String(err)}\n` +
        'Si otra ventana de Taptana la está usando, ciérrala. También puedes usar otra carpeta con --data-dir.',
    );
  }
}

/**
 * `taptana start ./carpeta` sirve esa carpeta como prototipo "local".
 * `taptana start` sin carpeta solo abre el panel: los prototipos se suben desde ahí (.html o .zip).
 * `dev` es lo mismo sin abrir el navegador.
 */
async function run(command: 'start' | 'dev', dir: string | undefined, flags: Flags): Promise<void> {
  const config = resolveConfig(dir ?? '.', flags);
  const folder = dir === undefined ? undefined : config.prototypeDir;
  if (folder && (!existsSync(folder) || !statSync(folder).isDirectory())) {
    throw new Error(`No existe la carpeta: ${folder}`);
  }

  const store = openStore(config);
  if (folder) store.savePrototype({ id: LOCAL_PROTOTYPE_ID, name: basename(folder), createdAt: Date.now(), source: 'folder', entryPath: '/' });
  const panelKey = loadPanelKey(config.dataDir);

  const wholeNetwork = config.host === '0.0.0.0' || config.host === '::';
  const ips = wholeNetwork ? localAddresses() : [config.host];
  const primary = ips[0] ?? 'localhost';
  let port = config.port;
  const urlFor = (host: string): string => `http://${host.includes(':') ? `[${host}]` : host}:${port}`;
  /** La dirección que sirve desde otro dispositivo. */
  const baseUrl = (): string => config.publicUrl ?? urlFor(primary);

  const app = createApp({
    store,
    ...(folder && { prototypeDir: folder }),
    dataDir: config.dataDir,
    prototypeId: LOCAL_PROTOTYPE_ID,
    recordSelf: config.recordSelf,
    panelKey,
    openPanel: config.openPanel,
    ...(config.publicUrl && { publicUrl: config.publicUrl }),
    info: (): ServerInfo => ({
      version: VERSION,
      participantUrl: `${baseUrl()}/`,
      prototypeId: folder ? LOCAL_PROTOTYPE_ID : '',
      prototypeName: folder ? basename(folder) : '',
    }),
  });

  let listening: Listening;
  try {
    listening = await listen(app.fetch, { port: config.port, host: config.host });
  } catch (err) {
    store.close();
    throw err instanceof ListenError ? err : new Error(`No se pudo arrancar el servidor: ${err instanceof Error ? err.message : String(err)}`);
  }
  port = listening.port;

  const localUrl = urlFor(wholeNetwork || isLoopback(config.host) ? 'localhost' : config.host);
  const localPanel = `${localUrl}${PANEL_PATH}`;
  const reachable = config.publicUrl !== undefined || (ips.length > 0 && !isLoopback(primary) && primary !== 'localhost');
  const remotePanel = `${baseUrl()}${PANEL_PATH}${config.openPanel ? '' : `?${PANEL_KEY_PARAM}=${panelKey}`}`;
  const participantUrl = `${baseUrl()}/`;

  const out: string[] = [''];
  if (port !== config.port) {
    out.push(`  Aviso: el puerto ${config.port} está ocupado (¿otra ventana de Taptana?). Esta vez se usa el ${port}.`, '');
  }
  out.push(folder ? `  Taptana ${VERSION} · sirviendo ${folder}` : `  Taptana ${VERSION} · listo`, '');
  out.push(`  Panel en esta computadora:     ${localPanel}`);
  if (reachable) {
    out.push(`  Panel desde otro dispositivo:  ${remotePanel}`);
    if (folder) {
      out.push(`  Participante (misma Wi-Fi):    ${participantUrl}`);
      if (!config.publicUrl) for (const ip of ips.slice(1)) out.push(`                                 ${urlFor(ip)}/`);
    }
  } else {
    out.push('  Esta computadora no está en ninguna red: por ahora solo se puede usar desde aquí.');
  }
  out.push('');
  if (config.openPanel) {
    out.push('  El panel está abierto (--open-panel): cualquiera en esta red puede ver las grabaciones.');
  } else if (reachable) {
    out.push('  El link con «key» es la llave del panel: no lo compartas con participantes.');
  }
  out.push(`  Datos: ${config.dataDir}  (todo queda en esta computadora)`);
  if (config.recordSelf) out.push('  Grabando también el panel (--record-self)');
  if (folder) {
    const hidden = ['.env', '.git'].filter((name) => existsSync(join(folder, name)));
    if (hidden.length > 0) {
      out.push(`  La carpeta trae ${hidden.join(' y ')}: Taptana no sirve archivos ni carpetas que empiezan con punto.`);
    }
  }
  out.push('');
  process.stdout.write(out.join('\n') + '\n');

  if (folder && reachable && config.qr) {
    process.stdout.write(await renderQr(participantUrl));
    process.stdout.write('\n  Escanea el QR con el celular para abrir el prototipo.\n\n');
  } else if (!folder) {
    process.stdout.write('  Abre el panel, sube tu prototipo y comparte el link o el QR de tu estudio.\n\n');
  }

  if (command === 'start' && config.openBrowser && !process.env['CI']) openBrowser(localPanel);

  const shutdown = (): void => {
    listening.server.close();
    store.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

/**
 * Sin archivos: carga el ejemplo completo (lo mismo que el botón "Ver un ejemplo" del panel).
 * Con archivos: importa esas sesiones exportadas tal cual, reemplazando las que ya estén.
 */
async function seed(files: string[], flags: Flags): Promise<void> {
  const config = resolveConfig('.', flags);
  const store = openStore(config);
  const database = join(config.dataDir, 'taptana.db');
  try {
    if (files.length === 0) {
      let result;
      try {
        result = await loadExample({ store, dataDir: config.dataDir });
      } catch (err) {
        if (err instanceof ExampleError) throw new Error(err.message);
        throw err;
      }
      const sessions = result.imported === 1 ? '1 sesión nueva' : `${result.imported} sesiones nuevas`;
      process.stdout.write(`\n  Ejemplo listo en ${database}\n  Prototipo «Tienda de ejemplo», su estudio y ${sessions}.\n\n`);
      return;
    }

    let imported = 0;
    for (const file of files) {
      const path = resolve(invocationDir(), file);
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(path, 'utf8'));
      } catch {
        process.stderr.write(`  no se pudo leer ${basename(path)} (¿existe y es un archivo .json?)\n`);
        continue;
      }
      const result = validateSessionExport(raw);
      if (!result.ok) {
        process.stderr.write(`  ${basename(path)}: ${result.error}\n`);
        continue;
      }
      store.importSession(result.value);
      imported++;
      process.stdout.write(`  importada ${result.value.session.id} (${basename(path)})\n`);
    }
    if (imported === 0) throw new Error('No se importó ninguna sesión.');
    process.stdout.write(`\n  ${imported === 1 ? '1 sesión' : `${imported} sesiones`} en ${database}\n`);
  } finally {
    store.close();
  }
}
