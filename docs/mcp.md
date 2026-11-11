# Conecta tu IA a Taptana (MCP)

MCP es una forma estándar de que una herramienta de IA use otros programas. Si conectas tu IA
a Taptana, puede ver tus prototipos y sus pantallas, armar un estudio, revisarlo, guardarlo y
leer el reporte, sin que copies y pegues nada.

**Taptana sigue sin llamar a ningún modelo de IA.** Es al revés: tu IA (con tu cuenta, o un
modelo que corre en tu computadora) le pide cosas a Taptana. Tú decides qué IA usar.

## Antes de empezar

1. Taptana tiene que estar corriendo: `pnpm start` en la carpeta de Taptana.
2. Elige una de las dos formas de conectar:
   - **Con la dirección (URL):** `http://localhost:4321/mcp`. Es lo más simple si tu
     herramienta acepta una URL. Si Taptana usa otro puerto, cámbialo.
   - **Con un comando (stdio):** tu herramienta arranca un programita que habla con Taptana.
     Sirve para las herramientas que no aceptan URL. El comando es
     `node /ruta/a/taptana/packages/mcp/dist/bin.js`.

No tienes que adivinar la ruta: en el panel, abre un estudio, menú "⋯" → **Armar con IA** →
**Conecta tu IA (MCP)**. Ahí está la configuración lista para copiar, con la ruta de tu
computadora.

Si tu herramienta está en la misma computadora que Taptana, no hace falta ninguna llave. Si
está en otra (o Taptana corre en Docker), necesitas la llave del panel: es lo que va después de
`key=` en el link "Panel desde otro dispositivo" que muestra Taptana al arrancar. Con la URL va
en la cabecera `Authorization: Bearer <llave>`; con el comando, en la variable `TAPTANA_KEY`.

## Configurarlo en tu herramienta

Los nombres de menús y archivos cambian seguido entre versiones. Si algo no coincide,
**revisa la documentación de tu herramienta** en la parte de "MCP servers".

### Claude Desktop

Abre Configuración → Desarrollador → Editar configuración. Se abre el archivo
`claude_desktop_config.json`. Pega esto (cambia la ruta por la tuya) y reinicia Claude Desktop:

```json
{
  "mcpServers": {
    "taptana": {
      "command": "node",
      "args": ["/ruta/a/taptana/packages/mcp/dist/bin.js"],
      "env": { "TAPTANA_URL": "http://localhost:4321" }
    }
  }
}
```

Claude Desktop usa el comando, no la URL: los "conectores" que se agregan con una dirección
necesitan un servidor público con HTTPS (ver "Límites").

### Claude Code

En la terminal, con la URL:

```
claude mcp add --transport http taptana http://localhost:4321/mcp
```

O con el comando:

```
claude mcp add taptana -e TAPTANA_URL=http://localhost:4321 -- node /ruta/a/taptana/packages/mcp/dist/bin.js
```

Para ver que quedó conectado: `claude mcp list`, o `/mcp` dentro de Claude Code.

### Cursor

En Configuración de Cursor → MCP, agrega un servidor. Se guarda en `~/.cursor/mcp.json` (para
todos tus proyectos) o en `.cursor/mcp.json` (solo este). Con la URL:

```json
{
  "mcpServers": {
    "taptana": { "url": "http://localhost:4321/mcp" }
  }
}
```

O con el comando, igual que en Claude Desktop (`command`, `args`, `env`).

### LM Studio (un modelo en tu computadora)

En LM Studio, en la pestaña del chat, busca "Program" → "Install" → "Edit mcp.json" (revisa la
documentación de tu versión). Usa el mismo formato que Cursor:

```json
{
  "mcpServers": {
    "taptana": { "url": "http://localhost:4321/mcp" }
  }
}
```

Elige un modelo que sepa usar herramientas ("tool use"). Los modelos chicos a veces se
equivocan con el formato: Taptana revisa todo antes de guardar y le explica los errores, así
que suele corregirse solo.

### Otras herramientas

Cualquier herramienta compatible con MCP sirve. Busca dónde agrega "MCP servers" y usa la URL
`http://localhost:4321/mcp` (transporte "Streamable HTTP") o el comando de arriba (transporte
"stdio"). En vez de la ruta a `bin.js` también sirve `taptana mcp` si tienes el comando
`taptana` instalado.

## Qué pedirle

- "Arma un estudio para la Tienda de ejemplo: quiero saber si la gente encuentra el costo de
  envío. Dame el link para probarlo."
- "¿Cómo le fue al estudio Compra en Verde? ¿Qué arreglo primero?"
- "Duplica el estudio de compra y agrégale una pregunta sobre el precio al final."

Muchas herramientas muestran además un atajo llamado **armar_estudio**: lo eliges, escribes
qué quieres averiguar y la IA sigue los pasos sola (lee el formato, mira las pantallas, arma,
revisa, guarda y te da el link para probarlo sin grabar).

Lo que la IA guarda es un borrador tuyo: ábrelo en el panel, pruébalo con **Probar estudio** y
ajusta lo que haga falta antes de compartirlo. La IA propone; tú decides.

## Qué puede ver tu IA

- Los nombres de tus prototipos y sus pantallas.
- El HTML de cada pantalla (sin el código JavaScript, los estilos ni las imágenes incrustadas),
  para usar los textos, links y botones reales al escribir las tareas y saber qué tocar.
- Tus estudios completos (bloques, textos, ajustes).
- El resumen del reporte: puntaje, éxito por tarea, embudo, toques sin efecto, "qué arreglar" y
  las respuestas a las preguntas, **incluidas las respuestas abiertas** que escribieron los
  participantes (sin sus nombres ni apodos).

Qué **no** puede ver ni hacer:

- Las grabaciones, los mapas de calor ni lo que hizo cada persona paso a paso.
- Borrar nada. Puede crear y cambiar estudios, y subir un prototipo de una sola página.
- Cambiar un estudio que ya tiene sesiones sin que tú se lo confirmes (te sugiere duplicarlo).

Ten en cuenta que lo que la IA lee pasa por la herramienta y el modelo que elegiste: si usas
una IA en la nube, las respuestas de los participantes viajan a ese servicio. Con un modelo
local (LM Studio), todo queda en tu computadora.

## Límites

- **Solo en tu red.** Taptana corre en tu computadora, así que tu IA tiene que estar en la
  misma computadora (o en tu red, con la llave).
- **Las IA en la web (como claude.ai o ChatGPT en el navegador) no pueden conectarse**: para
  eso Taptana necesitaría una dirección pública con HTTPS. Eso es para la versión hospedada
  ([servidor-hospedado.md](servidor-hospedado.md)).
- En la [demo en línea](https://taptana.github.io/taptana/) no hay MCP: todo vive en tu
  navegador. Instala Taptana para usarlo.

## Si algo no anda

- **"No pude conectarme con Taptana"**: Taptana no está corriendo, o usa otro puerto. Corre
  `pnpm start` y fíjate en el puerto que imprime.
- **"Taptana pidió la llave del panel"**: tu herramienta está en otra computadora o Taptana en
  Docker. Agrega la llave como dice "Antes de empezar".
- **La herramienta no muestra las funciones de Taptana**: reiníciala después de cambiar la
  configuración, y revisa que la ruta a `bin.js` exista (corre `pnpm build` si no).

## Para quien programa

El MCP vive en `packages/mcp`, sin dependencias. El núcleo recibe mensajes JSON-RPC y llama a
la API de Taptana (`/api/v1`); dos transportes lo usan: stdio (`taptana-mcp`, habla por HTTP con
un Taptana corriendo; variables `TAPTANA_URL` y `TAPTANA_KEY`) y `POST /mcp` en el servidor
(sin estado, pasa por la misma guardia que el panel). La guía del formato que entrega
`get_study_format` sale de [`skills/taptana-study/SKILL.md`](../skills/taptana-study/SKILL.md).

Herramientas: `get_info`, `get_study_format`, `list_prototypes`, `list_screens`,
`get_screen_html` (usa `GET /api/v1/prototypes/:id/source?path=`), `list_studies`, `get_study`, `validate_study`, `create_study`, `update_study`,
`duplicate_study`, `get_report`, `upload_prototype`. Prompt: `armar_estudio`.
