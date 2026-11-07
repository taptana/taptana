/**
 * Arma el prompt que el diseñador pega en cualquier IA para que escriba el study.json.
 * El servidor nunca llama a un modelo: la IA la pone cada persona con su herramienta.
 */

import type { PrototypePage } from '@/api/client';

export function buildStudyPrompt(opts: { prototypeId: string; prototypeName: string; pages: PrototypePage[]; goal?: string }): string {
  const pages = opts.pages.length
    ? opts.pages.map((p) => `- ${p.path}${p.title ? ` (${p.title})` : ''}`).join('\n')
    : '- (no pude listar las páginas; pídeme el HTML si lo necesitas)';
  const goal = opts.goal?.trim() ? `\nLo que quiero averiguar con esta prueba:\n${opts.goal.trim()}\n` : '';

  return `Eres un investigador de experiencia de usuario. Vas a diseñar un estudio de usabilidad moderado para un prototipo HTML que se prueba en celulares reales con Taptana.

El prototipo se llama "${opts.prototypeName}" y tiene estas páginas:
${pages}
${goal}
Escribe entre 3 y 5 tareas que recorran los flujos principales. Reglas:
- La instrucción se la lee el participante: en segunda persona, con un escenario concreto, sin nombrar botones ni jerga de la interfaz ("Quieres regalar una planta a tu mamá. Encuentra una que cueste menos de 50 soles y cómprala.").
- Cada tarea tiene un criterio de éxito verificable. Usa "reached" (llegó a una página) cuando el flujo termina en una página clara; "tapped" (tocó un elemento, con un selector CSS corto como "#agregar" o ".cart-link") cuando la tarea es tocar algo concreto; "manual" cuando solo un moderador puede juzgarlo.
- Usa kind "first-click" para preguntas tipo "¿Dónde tocarías para X?": la tarea termina en el primer toque.
- Ordena de lo fácil a lo difícil. Una sola tarea por flujo.
- Responde SOLO con el JSON, sin explicaciones ni bloques de código.

Formato exacto (JSON):
{
  "v": 1,
  "name": "nombre corto del estudio",
  "description": "una frase sobre qué se quiere aprender",
  "prototypeId": "${opts.prototypeId}",
  "welcome": "texto breve de bienvenida para el participante, en tono cercano",
  "tasks": [
    {
      "id": "t1",
      "kind": "task",
      "title": "título corto para el panel",
      "instruction": "lo que lee el participante",
      "startPath": "/index.html",
      "success": { "type": "reached", "path": "/gracias.html" }
    },
    {
      "id": "t2",
      "kind": "first-click",
      "title": "…",
      "instruction": "¿Dónde tocarías para …?",
      "startPath": "/index.html",
      "success": { "type": "tapped", "selector": ".cart-link" }
    },
    {
      "id": "t3",
      "kind": "task",
      "title": "…",
      "instruction": "…",
      "success": { "type": "manual" }
    }
  ]
}`;
}
