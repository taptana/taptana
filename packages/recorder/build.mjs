// Compila todo el recorder a un solo archivo: dist/recorder.js
// Es lo único que viaja al celular. Mientras más chico, más rápido carga el prototipo.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'iife',
  // rrweb 2 usa sintaxis moderna; iOS 16+ y Chrome 100+ la soportan. Suficiente para pruebas.
  target: ['es2022', 'safari16', 'chrome100', 'firefox100'],
  outfile: 'dist/recorder.js',
  minify: true,
  sourcemap: true,
  legalComments: 'none',
  define: { __TAPTANA_VERSION__: JSON.stringify(pkg.version) },
  banner: { js: `/* Taptana recorder ${pkg.version} · MIT · https://github.com/taptana/taptana */` },
  logLevel: 'info',
});
