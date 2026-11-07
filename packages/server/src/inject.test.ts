import { test } from 'node:test';
import assert from 'node:assert/strict';
import { injectRecorder } from './inject.js';

test('injects before </body>', () => {
  const out = injectRecorder('<html><body><h1>Hi</h1></body></html>', { prototypeId: 'local' });
  assert.match(out, /<h1>Hi<\/h1>\n<script src="\/__taptana\/recorder.js" data-prototype="local"><\/script>\n<\/body>/);
});

test('appends when there is no body', () => {
  const out = injectRecorder('<p>hola</p>', { prototypeId: 'local', transport: 'local' });
  assert.match(out, /<p>hola<\/p>\n<script [^>]*data-transport="local"><\/script>/);
});

test('does not inject twice', () => {
  const once = injectRecorder('<body></body>', { prototypeId: 'local' });
  assert.equal(injectRecorder(once, { prototypeId: 'local' }), once);
});
