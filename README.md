# Taptana

Pruebas de usabilidad para prototipos HTML, pensadas mobile first. Open source, licencia MIT.

Sirve tu prototipo en la red Wi-Fi, muestra un QR, y graba lo que el participante hace en su
celular: pantalla, toques, deslizamientos, scroll y navegación entre páginas. Después lo
reproduces en un panel. Todo lo que el participante escribe en formularios se graba
enmascarado.

Es una alternativa open source a Maze para prototipos HTML reales, en celulares reales, con tus
datos en tu máquina. Modelo tipo Penpot: cualquiera lo instala donde quiera; más adelante
habrá un servidor hospedado para probarlo sin instalar.

**Estado: v0.1.** Funciona la grabación local, el QR, el panel y la reproducción. Fuera de esta
versión: tareas, consentimiento, métricas, mapas de calor, cuentas.

## Probar en 2 minutos

Necesitas Node 22 o más nuevo y pnpm.

```bash
git clone https://github.com/taptana/taptana
cd taptana
pnpm install
pnpm build
pnpm dev            # sirve examples/tienda
```

La terminal muestra la IP local y un QR. Escanéalo con un celular en la misma Wi-Fi, usa la
tienda de ejemplo, y abre `http://<ip>:4321/sessions` en la laptop para ver la grabación.

Para probar con tu propio prototipo:

```bash
node packages/server/dist/cli.js dev ./mi-prototipo
```

(Cuando `@taptana/server` esté publicado en npm, será `npx taptana dev ./mi-prototipo`.)

## Qué hay en el panel

- **Sesiones:** fecha, dispositivo, tamaño de pantalla, duración, páginas, toques.
- **Reproductor:** la sesión como video (rrweb), con marcas en la línea de tiempo por cada
  toque, deslizamiento y cambio de página, y una lista "Qué hizo" para saltar a cada paso.
- **Importar y exportar** sesiones como archivos `.json`.

## Estudios: tareas con criterio de éxito

En el panel, **Estudios** → "Nuevo estudio": nombre, bienvenida, y tareas con instrucción,
página de inicio y criterio de éxito (llegó a una página, tocó un elemento, o lo decide el
moderador). Hay tareas normales y de **first click** (terminan en el primer toque), y variantes
**A/B** (cada participante recibe una al azar).

El estudio tiene un link con QR: `http://<ip>:4321/?study=<id>`. El participante ve la
bienvenida y una casilla de consentimiento; hasta que acepta, no se envía nada. Luego una barra
con la tarea y los botones "Listo" / "No pude". En el panel, cada sesión muestra el resultado
por tarea y el moderador puede corregirlo a mano.

**Que lo escriba una IA.** En el constructor, "Copiar prompt para IA" arma un prompt con las
páginas de tu prototipo y el formato exacto; pégalo en la IA que uses y guarda la respuesta como
`study.json`. También hay una skill para Claude Code en `skills/taptana-study/` que lee el
prototipo y escribe el archivo. Se importa desde Estudios → "Importar study.json". Taptana nunca
llama a un modelo: la IA la pones tú. Ejemplo: `examples/tienda/study.json`.

## Probar sin servidor

- **Panel en GitHub Pages (modo demo):** el panel con tres sesiones de ejemplo, y el prototipo
  de ejemplo con el recorder en modo local. Se publica solo desde `main` con
  `.github/workflows/pages.yml`. Activar una vez en Settings → Pages → Source: GitHub Actions.
- **Modo local del recorder:** con `data-transport="local"` en la etiqueta del script, la
  grabación se guarda en el navegador del celular y un botón flotante la exporta como `.json`.
  Ese archivo se importa en cualquier panel.
- **Codespaces:** abre el repo en GitHub Codespaces. Corre `pnpm dev`, haz público el puerto
  4321, y abre esa URL desde el celular.

## Usar el recorder en un prototipo alojado en otro lado

Pega esto antes de `</body>` en cada HTML, apuntando a tu Taptana:

```html
<script src="https://taptana.midominio.com/__taptana/recorder.js"
        data-endpoint="https://taptana.midominio.com"
        data-prototype="mi-prototipo"></script>
```

## Comandos

```bash
pnpm build        # compila todos los paquetes
pnpm test         # pruebas (node --test)
pnpm dev          # servidor con examples/tienda
pnpm seed         # importa sesiones de ejemplo en .taptana/taptana.db
pnpm site         # arma el sitio estático de GitHub Pages en ./site
pnpm --filter @taptana/web dev   # panel con recarga instantánea (proxy a :4321)
```

Variables de entorno: `TAPTANA_PORT` (4321), `TAPTANA_HOST` (0.0.0.0), `TAPTANA_DATA_DIR`
(`.taptana`). Flags: `--port`, `--host`, `--data-dir`, `--record-self`, `--no-qr`.

## Estructura

```
packages/shared     tipos y formato de eventos
packages/recorder   script que se inyecta en el prototipo
packages/web        panel (React + Vite + Tailwind + shadcn)
packages/server     CLI `taptana`, servidor Hono, SQLite
examples/tienda     prototipo de ejemplo
docs/               decisiones de diseño y hoja de ruta
```

Más contexto y decisiones en `CLAUDE.md` y en `docs/`.

## Licencia

MIT.
