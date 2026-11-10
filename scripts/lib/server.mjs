// Arranca el servidor real de Taptana en un puerto y una carpeta de datos, y espera a que responda.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function startServer({ port, dataDir, args = [] }) {
  const cli = join(repoRoot, 'packages/server/dist/cli.js');
  if (!existsSync(cli)) throw new Error('Falta compilar: corre «pnpm build» antes.');
  const child = spawn(
    process.execPath,
    ['--no-warnings=ExperimentalWarning', cli, 'dev', ...args, '--port', String(port), '--host', '127.0.0.1', '--data-dir', dataDir, '--no-open', '--no-qr'],
    { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1' } },
  );
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const origin = `http://localhost:${port}`;
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) throw new Error(`El servidor no arrancó:\n${log}`);
    try {
      const res = await fetch(`${origin}/api/v1/info`);
      if (res.ok) {
        // Si el puerto estaba ocupado el servidor toma el siguiente: aquí queremos justo este.
        if (!log.includes(`:${port}/panel`)) throw new Error(`El puerto ${port} está ocupado.`);
        return { origin, stop: () => stop(child), log: () => log };
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('ocupado')) {
        await stop(child);
        throw err;
      }
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  await stop(child);
  throw new Error(`El servidor no respondió en el puerto ${port}:\n${log}`);
}

function stop(child) {
  return new Promise((done) => {
    if (child.exitCode !== null) return done();
    child.once('exit', () => done());
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 3000).unref();
  });
}

export async function api(origin, path, init = {}) {
  const res = await fetch(`${origin}/api/v1${path}`, {
    ...init,
    headers: { ...(init.body && typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}), ...init.headers },
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status}: ${typeof data === 'string' ? data.slice(0, 200) : JSON.stringify(data).slice(0, 300)}`);
  return data;
}
