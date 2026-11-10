// Compila todo el recorder a un solo archivo: dist/recorder.js
// Es lo único que viaja al celular. Mientras más chico, más rápido carga el prototipo.
import { build, transform } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// La hoja de estilos de la interfaz del participante viaja dentro del script, como texto minificado.
const cssAsText = {
  name: 'css-as-text',
  setup(b) {
    b.onLoad({ filter: /\.css$/ }, async (args) => {
      const source = await readFile(args.path, 'utf8');
      const { code } = await transform(source, { loader: 'css', minify: true });
      return { contents: code.trim(), loader: 'text' };
    });
  },
};

await build({
  plugins: [cssAsText],
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
