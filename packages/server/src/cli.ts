#!/usr/bin/env node
/**
 * Entrada del comando `taptana`. Solo revisa que Node sirva y después carga el resto
 * (main.ts): así, con un Node viejo, sale un mensaje claro y no un error de importación.
 */

import { nodeProblem, sqliteProblem } from './node-version.js';

const problem = nodeProblem(process.versions.node);
if (problem) {
  process.stderr.write(`\n${problem}\n\n`);
  process.exit(1);
}

// Node avisa en cada arranque que su SQLite es "experimental". A quien usa Taptana ese aviso
// no le dice nada: se calla ese y solo ese.
const emitWarning = process.emitWarning.bind(process) as (...args: unknown[]) => void;
process.emitWarning = ((warning: string | Error, ...rest: unknown[]): void => {
  const text = typeof warning === 'string' ? warning : warning.message;
  if (text.includes('SQLite is an experimental feature')) return;
  emitWarning(warning, ...rest);
}) as typeof process.emitWarning;

try {
  await import('node:sqlite');
} catch {
  process.stderr.write(`\n${sqliteProblem(process.versions.node)}\n\n`);
  process.exit(1);
}

const { main } = await import('./main.js');
await main(process.argv.slice(2));
