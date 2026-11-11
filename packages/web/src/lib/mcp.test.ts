import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MCP_BIN_PLACEHOLDER, mcpSnippets } from './mcp.ts';

test('local snippets: the URL of this server, no key', () => {
  const s = mcpSnippets({ origin: 'http://localhost:4321/', local: true, bin: '/home/ana/taptana/packages/mcp/dist/bin.js' });
  assert.equal(s.url, 'http://localhost:4321/mcp');
  assert.deepEqual(JSON.parse(s.http), { mcpServers: { taptana: { url: 'http://localhost:4321/mcp' } } });
  assert.deepEqual(JSON.parse(s.stdio).mcpServers.taptana, {
    command: 'node',
    args: ['/home/ana/taptana/packages/mcp/dist/bin.js'],
    env: { TAPTANA_URL: 'http://localhost:4321' },
  });
  assert.equal(s.claudeCode, 'claude mcp add --transport http taptana http://localhost:4321/mcp');
});

test('from another device the snippets carry a key placeholder', () => {
  const s = mcpSnippets({ origin: 'http://192.168.1.5:4321', local: false });
  assert.match(JSON.parse(s.http).mcpServers.taptana.headers.Authorization, /^Bearer /);
  assert.ok(JSON.parse(s.stdio).mcpServers.taptana.env.TAPTANA_KEY);
  assert.equal(JSON.parse(s.stdio).mcpServers.taptana.args[0], MCP_BIN_PLACEHOLDER);
  assert.match(s.claudeCode, /--header "Authorization: Bearer /);
});
