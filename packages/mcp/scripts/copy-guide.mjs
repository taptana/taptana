// Copia la guía del formato de estudio (skills/taptana-study/SKILL.md) a dist/, para que la
// herramienta get_study_format la entregue. Una sola fuente: la skill y el MCP dicen lo mismo.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, '../../skills/taptana-study/SKILL.md');
if (!existsSync(source)) {
  console.error('error: skills/taptana-study/SKILL.md not found');
  process.exit(1);
}
mkdirSync(resolve(root, 'dist'), { recursive: true });
copyFileSync(source, resolve(root, 'dist/study-format.md'));
console.log('copied study-format.md');
