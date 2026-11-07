---
name: taptana-study
description: Diseña un estudio de usabilidad para un prototipo HTML y lo escribe como un study.json que Taptana importa. Úsala cuando el usuario pida "arma un estudio", "crea las tareas de la prueba", "genera el study.json" o quiera probar un prototipo con participantes usando Taptana.
---

# Crear un estudio de Taptana

Taptana graba a participantes reales usando un prototipo HTML en su celular. Un **estudio** es
una lista de tareas con instrucción y criterio de éxito. Tu trabajo: leer el prototipo, diseñar
entre 3 y 5 tareas buenas, y escribir `study.json` con el formato exacto de abajo.

## Pasos

1. **Lee el prototipo.** Lista los archivos `.html` de la carpeta que el usuario indique (o la
   carpeta actual). Para cada página anota: ruta (`/index.html`), título, enlaces a otras
   páginas, botones y formularios principales, y los `id` y clases de los elementos que
   importan (botón de comprar, enlace al carrito, campos).
2. **Entiende el flujo.** Dibuja mentalmente el recorrido principal (por ejemplo: home →
   producto → carrito → confirmación) y los secundarios (filtros, ayuda, cuenta).
3. **Pregunta solo si hace falta.** Si el usuario no dijo qué quiere averiguar, asume el flujo
   principal y dilo en `description`. No hagas un interrogatorio.
4. **Escribe las tareas** siguiendo las reglas de abajo.
5. **Guarda `study.json`** en la carpeta del prototipo (o donde el usuario pida) y explica en
   dos líneas cómo importarlo: en el panel de Taptana, Estudios → "Importar study.json".

## Reglas para buenas tareas

- **Instrucción en palabras del participante.** Segunda persona, un escenario concreto, sin
  nombrar botones ni jerga de la interfaz. Bien: "Quieres regalar una planta a tu mamá.
  Encuentra una que cueste menos de 50 soles y cómprala." Mal: "Toca el botón Agregar al
  carrito y luego Pagar."
- **Una tarea por flujo**, de lo fácil a lo difícil. Entre 3 y 5.
- **Criterio de éxito verificable**, el más automático posible:
  - `{ "type": "reached", "path": "/gracias.html" }` cuando el flujo termina en una página
    clara. Usa la ruta exacta del archivo.
  - `{ "type": "tapped", "selector": "#agregar" }` cuando la tarea es tocar algo concreto.
    Selectores simples: `#id`, `.clase`, `button.clase`. Toma el id o la clase del HTML real.
  - `{ "type": "manual" }` cuando solo un moderador puede juzgarlo ("averigua cuánto cuesta
    el envío").
- **`kind: "first-click"`** para preguntas tipo "¿Dónde tocarías para X?". La tarea termina
  en el primer toque; combínala con `tapped`.
- **`startPath`** cuando la tarea debe empezar en una página concreta. Si falta, empieza
  donde el participante esté.
- **`welcome`** breve y cálido: nada es real, no hay respuestas incorrectas, piensa en voz alta.
- `id` de las tareas: `t1`, `t2`, … `prototypeId`: `"local"` salvo que el usuario diga otro.

## Formato exacto

```json
{
  "v": 1,
  "name": "Compra en la tienda móvil",
  "description": "Saber si el flujo de compra se entiende sin ayuda",
  "prototypeId": "local",
  "welcome": "Gracias por ayudarnos. Vas a usar un prototipo: nada es real y no hay respuestas incorrectas. Piensa en voz alta.",
  "tasks": [
    {
      "id": "t1",
      "kind": "task",
      "title": "Comprar una planta grande",
      "instruction": "Quieres regalar una planta a tu mamá. Encuentra una grande y cómprala.",
      "startPath": "/index.html",
      "success": { "type": "reached", "path": "/gracias.html" }
    },
    {
      "id": "t2",
      "kind": "first-click",
      "title": "Encontrar el carrito",
      "instruction": "¿Dónde tocarías para ver lo que llevas en tu carrito?",
      "startPath": "/index.html",
      "success": { "type": "tapped", "selector": ".cart-link" }
    },
    {
      "id": "t3",
      "kind": "task",
      "title": "Costo del envío",
      "instruction": "Averigua cuánto cuesta el envío a tu casa.",
      "success": { "type": "manual" }
    }
  ]
}
```

Campos opcionales: `description`, `welcome`, `consent` (texto de la casilla de consentimiento),
`variants` (A/B: `[{ "id": "A", "name": "Home normal", "startPath": "/index.html" }, …]`).

## Antes de entregar

- Cada `path` y `selector` existe en el HTML. Verifícalo, no lo inventes.
- No hay dos tareas con el mismo `id`.
- El JSON es válido y no lleva comentarios.
