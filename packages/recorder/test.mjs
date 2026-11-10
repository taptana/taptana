// Las pruebas del recorder son de lógica pura. Se empaquetan con esbuild (igual que el
// recorder) a dist/test y se corren con `node --test`.
import { build } from 'esbuild';
import { readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const out = 'dist/test';
rmSync(out, { recursive: true, force: true });
const entries = readdirSync('src').filter((f) => f.endsWith('.test.ts')).map((f) => `src/${f}`);
await build({ entryPoints: entries, bundle: true, platform: 'node', format: 'esm', outdir: out, loader: { '.css': 'text' }, outExtension: { '.js': '.mjs' }, logLevel: 'warning' });
const files = readdirSync(out).filter((f) => f.endsWith('.test.mjs')).map((f) => `${out}/${f}`);
const run = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(run.status ?? 1);
