import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanHtml } from './html.js';

test('cleanHtml keeps structure and attributes, drops code, styles, data URIs and the recorder', () => {
  const raw = `<!doctype html><html><head><title>Verde</title><style>
.a { color: red }
</style><script src="app.js"></script></head><body>
<!-- nota interna -->
<button id="agregar" class="btn">Agregar</button>
<img src="data:image/png;base64,${'Q'.repeat(300)}" alt="Planta">
<script>document.body.append('${'z'.repeat(3000)}')</script>
<script src="/__taptana/recorder.js" data-prototype="pr_x" data-base="/p/pr_x"></script>
</body></html>`;
  const out = cleanHtml(raw);
  assert.match(out.html, /<button id="agregar" class="btn">Agregar<\/button>/);
  assert.match(out.html, /<script src="app.js"><\/script>/);
  assert.match(out.html, /src="data:…"/);
  assert.match(out.html, /estilos quitados/);
  assert.doesNotMatch(out.html, /zzzz|QQQQ|color: red|nota interna|recorder\.js/);
  assert.equal(out.scriptsEmptied, 1);
  assert.equal(out.truncated, false);
});

test('cleanHtml truncates long pages', () => {
  const out = cleanHtml(`<p>${'texto '.repeat(20_000)}</p>`, 1000);
  assert.equal(out.truncated, true);
  assert.equal(out.html.length, 1000);
});
