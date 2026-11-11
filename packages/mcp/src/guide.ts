/**
 * La guía del formato de estudio que entrega `get_study_format`.
 *
 * El contenido sale de la skill (`skills/taptana-study/SKILL.md`, que el build copia a
 * `dist/study-format.md`): desde "## Pantallas" hasta el final. Los pasos de la skill hablan de
 * leer archivos e importar a mano; aquí los reemplaza una introducción para quien trabaja con
 * las herramientas del MCP.
 */

import { readFileSync } from 'node:fs';

const INTRO = `# Formato de estudio de Taptana (v2, por bloques)

Taptana graba a participantes reales usando un prototipo HTML en su celular. Un **estudio** es
una lista de **bloques** que la persona recorre en orden: contexto, tareas sobre el prototipo y
preguntas.

## Cómo trabajar con estas herramientas

1. \`list_prototypes\` para elegir el prototipo. Su \`id\` va en \`prototypeId\`; no inventes uno.
2. \`list_screens\` con ese id. Usa SOLO esos identificadores de pantalla en \`startPath\`,
   \`success.path\`, \`expectedPath\` y \`variants[].startPath\`. Si falta una pantalla que
   necesitas, dilo en vez de inventarla.
3. \`get_screen_html\` con las pantallas que importan: ahí ves los textos, links, botones, ids y
   clases reales para escribir instrucciones y reglas.
4. Escribe el estudio siguiendo esta guía y pásalo a \`validate_study\`. Corrige todos los
   errores; revisa los avisos (no impiden guardar).
5. \`create_study\` lo guarda. Entrega al diseñador el link para probarlo sin grabar y recuérdale
   que lo revise en el panel antes de compartirlo. La IA propone; el diseñador decide.

Comprueba los selectores de \`tapped\` y los textos de \`visible\` con \`get_screen_html\`:
usa solo los que aparecen en el HTML de esa pantalla. Si la pantalla la arma JavaScript y no
encuentras el elemento, prefiere \`reached\` con una pantalla de la lista, o \`manual\`.

`;

const START = '## Pantallas';

let cached: string | undefined;

/** Lo que dice la skill desde "## Pantallas", sin el encabezado YAML. */
export function skillBody(markdown: string): string {
  const at = markdown.indexOf(START);
  if (at === -1) throw new Error('La guía del formato no tiene la sección "## Pantallas".');
  return markdown.slice(at).trim();
}

/** La guía completa, en Markdown. */
export function studyFormatGuide(): string {
  if (cached === undefined) {
    const file = new URL('./study-format.md', import.meta.url);
    cached = INTRO + skillBody(readFileSync(file, 'utf8')) + '\n';
  }
  return cached;
}

/** El primer bloque ```json de un Markdown, ya interpretado. */
export function firstJsonExample(markdown: string): unknown {
  const match = /```json\n([\s\S]*?)\n```/.exec(markdown);
  if (!match?.[1]) throw new Error('La guía no trae un ejemplo en JSON.');
  return JSON.parse(match[1]);
}
