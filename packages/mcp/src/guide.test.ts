import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BLOCK_KINDS, validateStudy } from '@taptana/shared';
import { firstJsonExample, studyFormatGuide } from './guide.js';

test('the guide comes from the skill and its example passes validateStudy', () => {
  const guide = studyFormatGuide();
  const skill = readFileSync(new URL('../../../skills/taptana-study/SKILL.md', import.meta.url), 'utf8');
  // Una sola fuente: lo que dice la skill desde "## Pantallas" está tal cual en la guía.
  assert.ok(guide.includes(skill.slice(skill.indexOf('## Pantallas')).trim()));
  assert.doesNotMatch(guide, /^---/);
  const result = validateStudy(firstJsonExample(guide));
  assert.ok(result.ok, result.ok ? '' : result.error);
  assert.deepEqual(
    result.issues.filter((i) => i.level !== 'warn'),
    [],
  );
});

test('the guide mentions every block kind and success rule, and the MCP flow', () => {
  const guide = studyFormatGuide();
  for (const kind of BLOCK_KINDS) assert.ok(guide.includes(`\`${kind}\``), kind);
  for (const rule of ['reached', 'tapped', 'visible', 'manual']) assert.ok(guide.includes(`"${rule}"`), rule);
  for (const toolName of ['list_prototypes', 'list_screens', 'validate_study', 'create_study']) assert.ok(guide.includes(toolName), toolName);
});
