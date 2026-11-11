// `pnpm start`: deja Taptana andando sin pensar en pasos previos.
//   1. Revisa la versión de Node.
//   2. Instala y compila solo si hace falta (primera vez, o si el código cambió).
//   3. Arranca `taptana start` con los datos en ./.taptana y abre el panel en el navegador.
// Lo que escribas después se pasa tal cual:  pnpm start ./mi-prototipo --port 5000 --no-open
import { spawnSync, spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const say = (text) => process.stdout.write(`\n  ${text}\n`);

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  process.stderr.write(
    `\n  Taptana necesita Node 22.5 o más nuevo y aquí hay Node ${process.versions.node}.\n` +
      '  Descarga la versión actual (LTS) en https://nodejs.org, instálala y vuelve a correr «pnpm start».\n\n',
  );
  process.exit(1);
}

/** Fecha de modificación más reciente dentro de una carpeta (sin node_modules ni lo compilado). */
function newest(dir) {
  let latest = 0;
  if (!existsSync(dir)) return latest;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'dist-pages' || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    latest = Math.max(latest, entry.isDirectory() ? newest(path) : statSync(path).mtimeMs);
  }
  return latest;
}
const mtime = (path) => (existsSync(path) ? statSync(path).mtimeMs : 0);

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error || result.status !== 0) {
    process.stderr.write(`\n  No se pudo completar «${command} ${args.join(' ')}». Revisa el mensaje de arriba.\n\n`);
    process.exit(result.status ?? 1);
  }
}

// Lo que el servidor necesita para arrancar, y de qué fuentes sale cada cosa.
const cli = join(root, 'packages/server/dist/cli.js');
const outputs = [
  [cli, ['packages/shared/src', 'packages/mcp/src', 'skills/taptana-study', 'packages/server/src']],
  [join(root, 'packages/server/public/recorder.js'), ['packages/shared/src', 'packages/recorder/src']],
  [join(root, 'packages/server/public/panel/index.html'), ['packages/shared/src', 'packages/web/src', 'packages/web/index.html', 'packages/web/public']],
  [join(root, 'packages/server/example/tienda/index.html'), ['examples/tienda']],
];
const sourceTime = (rel) => {
  const path = join(root, rel);
  return existsSync(path) && statSync(path).isFile() ? mtime(path) : newest(path);
};

const needsInstall = !existsSync(join(root, 'node_modules/.modules.yaml')) || mtime(join(root, 'pnpm-lock.yaml')) > mtime(join(root, 'node_modules/.modules.yaml'));
const needsBuild = needsInstall || outputs.some(([out, sources]) => !existsSync(out) || sources.some((rel) => sourceTime(rel) > mtime(out)));

if (needsInstall) {
  say('Instalando lo necesario (solo la primera vez, tarda un minuto)…');
  run('pnpm', ['install']);
}
if (needsBuild) {
  say('Preparando Taptana…');
  run('pnpm', ['build']);
}

const args = process.argv.slice(2).filter((a) => a !== '--');
const hasDataDir = args.includes('--data-dir') || args.some((a) => a.startsWith('--data-dir=')) || Boolean(process.env['TAPTANA_DATA_DIR']);
// Las rutas que escribas (la carpeta del prototipo) se entienden desde donde corriste el comando.
const child = spawn(
  process.execPath,
  ['--no-warnings=ExperimentalWarning', cli, 'start', ...args, ...(hasDataDir ? [] : ['--data-dir', join(root, '.taptana')])],
  { cwd: process.env['INIT_CWD'] || process.cwd(), stdio: 'inherit' },
);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 0));
