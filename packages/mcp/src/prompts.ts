/** Los prompts del MCP: atajos que el diseñador elige en su herramienta de IA. */

export interface PromptDefinition {
  name: string;
  title: string;
  description: string;
  arguments: Array<{ name: string; description: string; required?: boolean }>;
}

export const PROMPTS: PromptDefinition[] = [
  {
    name: 'armar_estudio',
    title: 'Armar un estudio de usabilidad',
    description: 'Diseña un estudio para uno de tus prototipos, lo revisa, lo guarda en Taptana y te da el link para probarlo.',
    arguments: [{ name: 'goal', description: 'Qué quieres averiguar con la prueba (por ejemplo: "si la gente encuentra el carrito").', required: false }],
  },
];

export function promptMessages(name: string, args: Record<string, unknown>) {
  const goal = typeof args['goal'] === 'string' && args['goal'].trim() ? args['goal'].trim() : '';
  if (name !== 'armar_estudio') throw new Error(`Unknown prompt: ${name}`);
  const text = `Quiero armar un estudio de usabilidad en Taptana.${goal ? `\n\nLo que quiero averiguar: ${goal}` : ''}

Sigue estos pasos con las herramientas de Taptana:
1. get_study_format: lee la guía completa del formato antes de escribir nada.
2. list_prototypes: si hay más de uno y no está claro cuál, pregúntame.
3. list_screens con ese prototipo. Usa solo esas pantallas; no inventes ninguna.
4. Escribe un estudio corto (de 5 a 9 bloques) que responda a lo que quiero averiguar${goal ? '' : ' (si no lo dije, el flujo principal del prototipo)'}. Instrucciones en palabras del participante, de tú, sin nombrar botones.
5. validate_study. Corrige los errores y vuelve a validar hasta que no haya ninguno; cuéntame los avisos que importen.
6. create_study para guardarlo.
7. Dame el link tryout para probarlo sin grabar, el link para editarlo en el panel, y un resumen de dos o tres líneas de qué mide cada tarea.`;
  return {
    description: PROMPTS[0]?.description,
    messages: [{ role: 'user', content: { type: 'text', text } }],
  };
}
