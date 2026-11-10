---
name: taptana-study
description: Diseña un estudio de usabilidad para un prototipo HTML y lo escribe como un study.json (formato de bloques, v2) que Taptana importa. Úsala cuando el usuario pida "arma un estudio", "crea las tareas de la prueba", "genera el study.json" o quiera probar un prototipo con participantes usando Taptana.
---

# Crear un estudio de Taptana

Taptana graba a participantes reales usando un prototipo HTML en su celular. Un **estudio** es
una lista de **bloques** que la persona recorre en orden: contexto, tareas sobre el prototipo y
preguntas. Tu trabajo: leer el prototipo, diseñar un estudio corto y bueno, y escribir
`study.json` con el formato exacto de abajo.

## Pasos

1. **Lee el prototipo.** Lista los archivos `.html` de la carpeta que el usuario indique (o la
   carpeta actual). Para cada pantalla anota: su identificador (ver "Pantallas"), título,
   a dónde lleva, botones y formularios principales, y los `id` y clases de los elementos que
   importan (botón de comprar, enlace al carrito).
2. **Entiende el flujo.** El recorrido principal (por ejemplo: inicio → producto → carrito →
   confirmación) y los secundarios (filtros, ayuda, cuenta).
3. **Pregunta solo si hace falta.** Si el usuario no dijo qué quiere averiguar, asume el flujo
   principal y dilo en `description`. No hagas un interrogatorio.
4. **Escribe los bloques** siguiendo las reglas de abajo.
5. **Guarda `study.json`** en la carpeta del prototipo (o donde el usuario pida) y explica en
   dos líneas cómo importarlo: en el panel de Taptana, Estudios → **Importar** (se puede elegir
   el archivo o pegar el JSON). Si el prototipo del archivo no existe ahí, el panel pregunta
   cuál usar.

## Pantallas

Las reglas y los caminos nombran pantallas con un identificador:

- Una página: `/producto.html` (sin parámetros; `/` es `/index.html`).
- Una ruta por hash en una app de una sola página: `/index.html#/carrito`.
- Una pantalla que se muestra y oculta en la misma página: `/index.html~checkout`, donde
  `checkout` sale del atributo `data-screen` (o del `id`) del contenedor visible.

Usa solo pantallas que existan en el HTML. No inventes rutas.

## Tipos de bloque

| `kind` | Qué es | Campos |
|---|---|---|
| `context` | Texto para situar a la persona | `title`, `text` |
| `task` | Una tarea sobre el prototipo | `title`, `instruction`, `startPath`, `success`, `expectedPath` |
| `first-click` | "¿Dónde tocarías para…?" Termina en el primer toque | `title`, `instruction`, `startPath`, `success` (solo `tapped` o `reached`) |
| `scale` | Escala de opinión de 1 a `max` | `question`, `max` (5, 7 o 10), `minLabel`, `maxLabel` |
| `choice` | Opción múltiple | `question`, `options` (2 a 12), `multiple` |
| `yesno` | Sí o no | `question` |
| `text` | Respuesta abierta | `question`, `placeholder` |

Todo bloque lleva un `id` único y corto (letras, números, guion): `t1`, `facilidad`, `mejora`.
Las preguntas aceptan además `description` y `required` (obligatoria).

## Cómo se sabe que una tarea se logró (`success`)

Elige la regla más automática que sea verdad:

- `{ "type": "reached", "path": "/gracias.html" }`: llegó a esa pantalla. La mejor cuando el
  flujo termina en una pantalla clara.
- `{ "type": "tapped", "selector": "#agregar" }`: tocó ese elemento. Selectores simples y
  específicos tomados del HTML real: `#id`, `.clase`, `button.clase`. Nunca solo una etiqueta
  (`a`, `button`): acreditaría cualquier toque.
- `{ "type": "visible", "text": "Pedido confirmado" }` o `{ "type": "visible", "selector": ".toast-ok" }`:
  apareció ese texto o elemento. Para prototipos que no cambian de pantalla.
- `{ "type": "manual" }`: lo decide el moderador ("averigua cuánto cuesta el envío").

## Reglas para un buen estudio

- **Corto**: de 5 a 9 bloques, 5 minutos. Dos o tres tareas, y preguntas que valgan la pena.
- **Instrucción en palabras del participante.** De tú, con un escenario concreto, sin nombrar
  botones ni jerga de la interfaz. Bien: "Quieres regalarle a tu mamá una planta grande.
  Encuentra una y cómprala." Mal: "Toca Agregar al carrito y luego Pagar."
- **Una tarea por flujo**, de lo fácil a lo difícil.
- **`startPath`** en cada tarea: la pantalla donde empieza. En primer clic, la pantalla donde
  está el elemento que se busca.
- **`expectedPath`** en las tareas con `reached`: las pantallas del camino más corto, en orden,
  empezando por `startPath` y terminando en la pantalla de la regla. Con eso el reporte
  distingue éxito directo de indirecto y dibuja el embudo.
- **Después de la tarea principal, una escala** de facilidad ("¿Qué tan fácil fue…?", `max: 5`,
  con `minLabel` y `maxLabel`).
- **Cierra con una pregunta abierta** ("Si pudieras cambiar una sola cosa…").
- **`welcome`** breve y cálido: nada es real, no hay respuestas incorrectas, cuánto toma.
- `prototypeId`: el id que el usuario te dé (lo muestra el panel en Prototipos). Si no lo
  sabes, pon `"pr_ejemplo"`: al importar, el panel deja elegir el prototipo correcto.

## Formato exacto

```json
{
  "v": 2,
  "name": "Compra en Verde",
  "description": "Saber si el flujo de compra se entiende sin ayuda y si el carrito se encuentra",
  "prototypeId": "pr_ejemplo",
  "welcome": "Gracias por ayudarnos. Vas a usar el prototipo de una tienda de plantas: nada es real y no vas a pagar nada. Toma unos 5 minutos.",
  "thanks": "Eso era todo. Ya puedes cerrar esta página.",
  "settings": { "advance": "auto", "askName": true },
  "blocks": [
    {
      "id": "contexto",
      "kind": "context",
      "title": "Antes de empezar",
      "text": "Imagina que se acerca el cumpleaños de tu mamá y quieres regalarle una planta. Si te piden datos, inventa cualquiera."
    },
    {
      "id": "t1",
      "kind": "task",
      "title": "Comprar una planta grande",
      "instruction": "Quieres regalarle a tu mamá una planta grande. Encuentra una y cómprala.",
      "startPath": "/index.html",
      "success": { "type": "reached", "path": "/gracias.html" },
      "expectedPath": ["/index.html", "/producto.html", "/carrito.html", "/gracias.html"]
    },
    {
      "id": "facilidad",
      "kind": "scale",
      "question": "¿Qué tan fácil fue comprar la planta?",
      "max": 5,
      "minLabel": "Muy difícil",
      "maxLabel": "Muy fácil",
      "required": true
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
      "id": "volveria",
      "kind": "yesno",
      "question": "¿Comprarías en una tienda como esta desde tu celular?"
    },
    {
      "id": "decision",
      "kind": "choice",
      "question": "¿Qué te ayudaría a decidirte por una planta?",
      "multiple": true,
      "options": ["Fotos reales de la planta", "Opiniones de otras personas", "Saber cuánto mide"]
    },
    {
      "id": "t3",
      "kind": "task",
      "title": "Costo del envío",
      "instruction": "Averigua cuánto cuesta el envío de una planta pequeña a tu casa.",
      "success": { "type": "manual" }
    },
    {
      "id": "mejora",
      "kind": "text",
      "question": "Si pudieras cambiar una sola cosa de esta tienda, ¿cuál sería?"
    }
  ]
}
```

Campos opcionales del estudio: `description`, `welcome`, `consent` (texto de la casilla de
consentimiento; si falta se usa uno estándar), `thanks`, `settings` (`advance`: `"auto"` termina
la tarea sola al cumplirse la regla, `"manual"` espera a que la persona toque "Listo";
`askName`: pide un nombre o apodo opcional) y `variants` para pruebas A/B
(`[{ "id": "A", "name": "Inicio normal", "startPath": "/index.html" }, …]`).

Topes de texto: nombre 120 caracteres, instrucción 600, pregunta 300, opción 120.

El formato anterior (`"v": 1` con `tasks`) todavía se importa, pero escribe siempre v2.

## Antes de entregar

- Cada `path`, `startPath`, pantalla de `expectedPath` y `selector` existe en el HTML.
  Verifícalo, no lo inventes.
- No hay dos bloques con el mismo `id`.
- Las tareas de primer clic usan `tapped` o `reached`, y su `startPath` muestra el elemento.
- Las `choice` tienen entre 2 y 12 opciones; las `scale`, `max` 5, 7 o 10.
- El JSON es válido y no lleva comentarios.
