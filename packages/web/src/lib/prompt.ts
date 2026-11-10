/**
 * Arma el prompt que el diseñador pega en cualquier IA para que escriba el study.json (formato
 * v2, por bloques). El servidor nunca llama a un modelo: la IA la pone cada persona con su
 * herramienta. El texto no depende de ningún modelo en particular.
 */

export interface PromptScreen {
  /** ScreenId: "/producto.html", "/index.html#/carrito", "/index.html~checkout". */
  id: string;
  title?: string;
}

export function buildStudyPrompt(opts: { prototypeId: string; prototypeName: string; screens: PromptScreen[]; goal?: string }): string {
  const screens = opts.screens.length
    ? opts.screens.map((s) => `- ${s.id}${s.title ? ` (${s.title})` : ''}`).join('\n')
    : '- (no hay pantallas detectadas todavía; pídeme el HTML del prototipo antes de escribir el estudio)';
  const goal = opts.goal?.trim() ? `\nLo que quiero averiguar con esta prueba:\n${opts.goal.trim()}\n` : '';
  const first = opts.screens[0]?.id ?? '/index.html';
  const last = opts.screens[opts.screens.length - 1]?.id ?? '/gracias.html';

  return `Eres una persona que investiga experiencia de usuario. Vas a diseñar un estudio de usabilidad para un prototipo HTML que se prueba en celulares reales con Taptana.

El prototipo se llama "${opts.prototypeName}" y tiene estas pantallas (usa estos identificadores tal cual, sin inventar otros):
${screens}
${goal}
Un estudio es una lista ordenada de bloques. Escribe entre 3 y 5 tareas que recorran los flujos principales y acompáñalas con algunas preguntas. Tipos de bloque ("kind"):

- "context": un texto para leer antes de seguir ("Ahora imagina que…"). Campos: title, text.
- "task": una tarea sobre el prototipo. Campos: title (corto, solo para el equipo), instruction (lo que lee el participante), startPath (pantalla donde empieza), success (cómo se sabe que la logró) y expectedPath (las pantallas del camino correcto, en orden, empezando por startPath).
- "first-click": "¿Dónde tocarías para…?". Termina en el primer toque. Lleva startPath y success de tipo "tapped" o "reached" (ningún otro).
- "scale": escala de opinión de 1 a max. Campos: question, max (5, 7 o 10), minLabel, maxLabel.
- "choice": opción múltiple. Campos: question, options (entre 2 y 12 textos), multiple (true si se pueden marcar varias).
- "yesno": pregunta de sí o no. Campo: question.
- "text": pregunta abierta. Campo: question.
Las preguntas aceptan además description (aclaración corta) y required (true si no se puede saltar).

Reglas de éxito ("success") de una tarea:
- { "type": "reached", "path": "<pantalla>" }: llegó a esa pantalla. Úsala cuando el flujo termina en una pantalla clara.
- { "type": "tapped", "selector": "<selector CSS corto>" }: tocó ese elemento, por ejemplo "#agregar" o ".cart-link". Solo si conoces el HTML.
- { "type": "visible", "text": "<texto>" } o { "type": "visible", "selector": "<selector CSS>" }: apareció ese texto o elemento en pantalla ("Pedido confirmado"). Sirve cuando el prototipo no cambia de pantalla.
- { "type": "manual" }: lo decide quien modera, viendo la grabación. Úsala solo cuando nada de lo anterior sirve.

Cómo escribir:
- La instrucción va en segunda persona, con un escenario concreto y sin nombrar botones, menús ni palabras de la interfaz ("Quieres regalar una planta a tu mamá. Encuentra una que cueste menos de 50 soles y cómprala.").
- Una sola tarea por flujo. Ordena de lo fácil a lo difícil.
- Después de una tarea importante, pregunta qué tan fácil fue con una escala de 5 ("Muy difícil" a "Muy fácil"). Cierra con una pregunta abierta.
- Cada bloque lleva un "id" único y corto ("b1", "b2", …).
- Largos máximos: título 120 caracteres, instrucción 600, pregunta 300, opción 120.
- Responde SOLO con el JSON, sin explicaciones y sin bloque de código.

Formato exacto (JSON):
{
  "v": 2,
  "name": "nombre corto del estudio",
  "description": "una frase sobre qué se quiere aprender",
  "prototypeId": "${opts.prototypeId}",
  "welcome": "texto breve de bienvenida para el participante, en tono cercano",
  "thanks": "texto breve de despedida",
  "blocks": [
    { "id": "b1", "kind": "context", "title": "Antes de empezar", "text": "…" },
    {
      "id": "b2",
      "kind": "task",
      "title": "título corto para el equipo",
      "instruction": "lo que lee el participante",
      "startPath": "${first}",
      "success": { "type": "reached", "path": "${last}" },
      "expectedPath": ["${first}", "…", "${last}"]
    },
    { "id": "b3", "kind": "scale", "question": "¿Qué tan fácil fue?", "max": 5, "minLabel": "Muy difícil", "maxLabel": "Muy fácil" },
    {
      "id": "b4",
      "kind": "first-click",
      "title": "…",
      "instruction": "¿Dónde tocarías para …?",
      "startPath": "${first}",
      "success": { "type": "tapped", "selector": ".cart-link" }
    },
    { "id": "b5", "kind": "task", "title": "…", "instruction": "…", "startPath": "${first}", "success": { "type": "visible", "text": "…" } },
    { "id": "b6", "kind": "choice", "question": "…", "options": ["…", "…", "…"], "multiple": false },
    { "id": "b7", "kind": "yesno", "question": "…" },
    { "id": "b8", "kind": "text", "question": "¿Qué cambiarías?", "required": false }
  ]
}`;
}
