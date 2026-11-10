# Estudios creados con IA

Meta: que puedas decirle a una IA "arma un estudio de usabilidad para este prototipo" y que el
resultado entre a Taptana sin trabajo manual.

**Taptana nunca llama a un modelo de IA.** La IA la pones tú, con tu herramienta y tu cuenta
(Claude, ChatGPT, Cursor, la que uses). Taptana solo define un formato de estudio que cualquier
IA puede escribir, y lo importa. Así el servidor sigue simple, local y sin llaves que cuidar.

## Dos formas de hacerlo

### 1. Desde el panel: "Armar con IA"

Para cualquier chat de IA, sin instalar nada.

1. En el panel, abre un estudio y toca **Armar con IA** en el menú "⋯" de arriba (al crear uno
   nuevo, aparece como opción en el último paso).
2. Escribe en una línea qué quieres averiguar (opcional) y toca **Copiar prompt para IA**. El prompt ya
   lleva el nombre de tu prototipo, sus pantallas y el formato exacto.
3. Pégalo en tu IA. Te responde con un JSON.
4. Copia ese JSON y **pégalo** en el mismo cuadro del panel. Taptana lo revisa, te muestra
   cualquier problema en español y arma los bloques.
5. Revisa cada tarea en el constructor, pruébala con **Probar estudio** y ajusta lo que haga
   falta. La IA propone; tú decides.

### 2. Desde un asistente que lee tus archivos: la skill

Para Claude Code, Cursor y similares, que pueden leer la carpeta de tu prototipo.

La skill es un archivo de instrucciones: [`skills/taptana-study/SKILL.md`](../skills/taptana-study/SKILL.md).
Cópiala a las skills de tu asistente (o pásale el archivo) y pide: "usa la skill de Taptana
para armar un estudio de este prototipo". El asistente lee los HTML, escribe un `study.json` y
tú lo importas en Estudios → menú "⋯" → **Importar estudio** (archivo o pegando el JSON). Si el prototipo que
nombra el archivo no existe en tu Taptana, el panel te pregunta cuál usar.

## El formato (v2, por bloques)

Un estudio es un JSON con datos generales y una lista de `blocks` en el orden en que los ve el
participante. Ejemplo completo y real: [`examples/tienda/study.json`](../examples/tienda/study.json).

```json
{
  "v": 2,
  "name": "Compra en Verde",
  "prototypeId": "pr_ejemplo",
  "welcome": "Gracias por ayudarnos. Nada es real y no hay respuestas incorrectas.",
  "thanks": "Eso era todo. Ya puedes cerrar esta página.",
  "settings": { "advance": "auto", "askName": true },
  "blocks": [
    { "id": "contexto", "kind": "context", "title": "Antes de empezar",
      "text": "Imagina que quieres regalarle una planta a tu mamá." },
    { "id": "t1", "kind": "task", "title": "Comprar una planta grande",
      "instruction": "Quieres regalarle a tu mamá una planta grande. Encuentra una y cómprala.",
      "startPath": "/index.html",
      "success": { "type": "reached", "path": "/gracias.html" },
      "expectedPath": ["/index.html", "/producto.html", "/carrito.html", "/gracias.html"] },
    { "id": "facilidad", "kind": "scale", "question": "¿Qué tan fácil fue comprar la planta?",
      "max": 5, "minLabel": "Muy difícil", "maxLabel": "Muy fácil" },
    { "id": "t2", "kind": "first-click", "title": "Encontrar el carrito",
      "instruction": "¿Dónde tocarías para ver lo que llevas en tu carrito?",
      "startPath": "/index.html",
      "success": { "type": "tapped", "selector": ".cart-link" } },
    { "id": "volveria", "kind": "yesno", "question": "¿Comprarías aquí desde tu celular?" },
    { "id": "decision", "kind": "choice", "question": "¿Qué te ayudaría a decidirte?",
      "multiple": true, "options": ["Fotos reales", "Opiniones", "Saber cuánto mide"] },
    { "id": "t3", "kind": "task", "title": "Costo del envío",
      "instruction": "Averigua cuánto cuesta el envío a tu casa.",
      "success": { "type": "manual" } },
    { "id": "mejora", "kind": "text", "question": "Si pudieras cambiar una sola cosa, ¿cuál sería?" }
  ]
}
```

### Bloques

| `kind` | Para qué | Campos propios |
|---|---|---|
| `context` | Situar a la persona antes de una tarea | `title`, `text` |
| `task` | Tarea sobre el prototipo | `title`, `instruction`, `startPath`, `success`, `expectedPath` |
| `first-click` | "¿Dónde tocarías para…?" Solo cuenta el primer toque | `title`, `instruction`, `startPath`, `success` |
| `scale` | Opinión de 1 a `max` (5, 7 o 10) | `question`, `max`, `minLabel`, `maxLabel` |
| `choice` | Opción múltiple (2 a 12 opciones) | `question`, `options`, `multiple` |
| `yesno` | Sí o no | `question` |
| `text` | Respuesta abierta | `question`, `placeholder` |

Cada bloque lleva un `id` único. Las preguntas aceptan `description` y `required`.

### Cómo se sabe que una tarea se logró

| Regla | Significa | Úsala cuando |
|---|---|---|
| `{ "type": "reached", "path": "/gracias.html" }` | Llegó a esa pantalla | El flujo termina en una pantalla clara |
| `{ "type": "tapped", "selector": "#agregar" }` | Tocó ese elemento | La tarea es encontrar algo concreto |
| `{ "type": "visible", "text": "Pedido confirmado" }` | Apareció ese texto (o un `selector`) | El prototipo no cambia de pantalla |
| `{ "type": "manual" }` | Lo decides tú al revisar | Ninguna de las anteriores alcanza |

Las pantallas se nombran así: `/producto.html` (una página), `/index.html#/carrito` (ruta por
hash) o `/index.html~checkout` (una pantalla que se muestra y oculta en la misma página). Más
en [prototipos.md](prototipos.md).

### Ajustes

- `settings.advance`: `"auto"` (por defecto) termina la tarea sola cuando se cumple la regla;
  `"manual"` espera a que la persona toque "Listo, terminé".
- `settings.askName`: pide un nombre o apodo (opcional para la persona) en la bienvenida.
- `consent`: el texto de la casilla de consentimiento. Si falta, se usa el estándar.
- `variants`: versiones A/B con distinta pantalla de inicio.
- `closed: true`: el estudio ya no recibe respuestas.

### Compatibilidad

El formato anterior (`"v": 1` con una lista `tasks`) se sigue importando: Taptana lo convierte
a bloques conservando los ids. Hay una copia para pruebas en
[`examples/tienda/study-v1.json`](../examples/tienda/study-v1.json).

Al importar, Taptana valida todo y explica los problemas en español, con el bloque y el campo
("La tarea 2 no tiene instrucción"). Algunos son solo avisos: por ejemplo, un selector que es
solo una etiqueta (`a`) se acepta, pero avisa que cualquier enlace contaría como acierto.

## Lo que viene después: MCP

Un MCP (`packages/mcp`, todavía no existe) expondrá la API de Taptana como herramientas para
que una IA cree el estudio directo y, sobre todo, lea las sesiones: "resume las pruebas de
hoy", "dónde se trabaron en la tarea 2". Será delgado, sobre la API que ya existe, y opcional.

## Lo que no hacemos

- No metemos una IA dentro de Taptana.
- No generamos el prototipo: eso ya lo hace tu herramienta de diseño o de código.
- No mandamos tus grabaciones a ningún lado. Si quieres que una IA las lea, tú exportas el CSV
  o las sesiones y decides con quién compartirlas.
