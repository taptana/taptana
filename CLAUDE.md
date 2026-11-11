# Taptana

Herramienta open source (MIT) de pruebas de usabilidad para prototipos HTML, pensada mobile first.

## Para quién es

Diseñadores que hacen prototipos HTML con vibe coding y quieren probarlos con usuarios reales.
El dueño del proyecto es diseñador, no programador: explicar cada paso en lenguaje simple,
sin asumir conocimiento de backend, y justificar las decisiones técnicas en términos de
qué resuelven para la prueba de usabilidad.

## Cómo se usa (v1)

1. `pnpm start` compila si hace falta, arranca el servidor y abre el panel en **Inicio**.
2. El diseñador sube su prototipo (`.html` o `.zip`), arma un estudio por bloques y lo prueba
   sin grabar.
3. Comparte el link o el QR del estudio. El participante lo abre en su celular (misma red
   Wi-Fi), acepta el consentimiento y recorre los bloques.
4. El diseñador lee el reporte: puntaje, éxito, embudo, mapas de calor, respuestas y qué arreglar.

"Ver un ejemplo" (Inicio) carga la tienda de ejemplo, su estudio y sesiones ya grabadas.

## Posicionamiento y modelo

- Alternativa open source a Maze, para prototipos HTML reales en celulares reales.
- Modelo tipo Penpot: todo el código es abierto y cualquiera lo instala en su infraestructura.
  A futuro, un servidor hospedado. Ver `docs/servidor-hospedado.md`.
- **Licencia: MIT en todos los paquetes.** Decidido. No se cambia sin discutirlo explícitamente.
- Ganamos en "funciona con cualquier HTML, lo instalo donde quiera, mis datos son míos".

## Hoja de ruta

- **v1 (actual): lista para piloto.** Estudios por bloques, apps de una sola página, reporte
  con puntaje y resumen, privacidad sin huecos, guardia del panel, Docker, demo en Pages.
  El plan y el contrato entre paquetes: `docs/plan-v1.md`.
- **Hecho después de v1:** `packages/mcp`, la API como herramientas para una IA (stdio y
  `POST /mcp`). Ver `docs/mcp.md`.
- **Después:** cuentas y equipos, servidor hospedado público (que también abre el MCP a las IA
  en la web).
- **Fuera de alcance por ahora** (plan, sección 6): HTTPS propio, reclutamiento, card sorting,
  tree testing, test de 5 segundos, clips de video, comparar versiones, Postgres.

## Stack y decisiones técnicas

| Decisión | Elección | Por qué |
|---|---|---|
| Lenguaje | TypeScript en todo el monorepo | Tipos compartidos entre recorder, panel y server |
| Monorepo | pnpm workspaces | Un solo repo, varios paquetes, sin herramientas extra |
| Runtime | Node 22.5+ | Trae SQLite nativo (`node:sqlite`) |
| Base de datos | `node:sqlite` (DatabaseSync) | Sin dependencias que requieran compilar |
| Servidor HTTP | Hono + `@hono/node-server` | Liviano, portable, mismo código en Node y Docker |
| Grabación | rrweb 2.x | Graba el DOM y lo reproduce fielmente, sin video |
| Reproducción | rrweb-player 2.x | Reproductor listo con línea de tiempo |
| Panel | React + Vite + Tailwind v4 + shadcn en `packages/web` | Se compila a estáticos que Hono sirve |
| Zip | `fflate` | JavaScript puro |
| Presentación (.pptx) | `pptxgenjs` en `packages/web` | JavaScript puro (MIT), se carga solo al descargar |
| Red | Escucha en `0.0.0.0`, puerto 4321 (o el siguiente libre) | Accesible desde el celular en la misma Wi-Fi |
| Pruebas con navegador | Playwright (devDependency de la raíz) | Solo para e2e, semillas y capturas; nunca en producción |

Reglas duras:

- **Nunca** agregar una dependencia nativa a lo que ejecuta el servidor (nada de node-gyp ni
  prebuilds en `server`, `recorder` o `shared`). Herramientas de build con binarios
  precompilados (esbuild, Tailwind v4) y Playwright están bien: no corren en producción.
- **Nunca** acoplar a un proveedor cloud. Todo tiene que correr con `node` y una carpeta.
- **El servidor nunca llama a un modelo de IA.** La IA la pone el usuario; Taptana da un
  formato importable, un prompt para copiar y un MCP al que la IA se conecta.
- **Privacidad** (no hay opciones para desactivarla):
  - En un estudio nada sale del celular antes del consentimiento; si rechaza o termina, esa
    pestaña no graba más.
  - Lo escrito en el prototipo se enmascara en el celular: campos, `contenteditable`, texto que
    el prototipo repite, y valores de la URL (`maskUrl`). `target.text` de un campo es su etiqueta.
  - El panel, la API y `/mcp` pasan por la guardia (`panel-guard.ts`); solo son públicos
    `POST /events`, `GET /studies/:id` y `GET /info` reducido.
  - El MCP nunca entrega grabaciones, eventos de rrweb ni nombres de participantes, y no tiene
    herramientas para borrar.
- Textos de interfaz en español, de tú. Identificadores de código en inglés.

## Decisiones de arquitectura

1. **Un solo binario.** `taptana start [carpeta]` (abre el navegador), `taptana dev [carpeta]`
   (no lo abre), `taptana seed [archivos]`, `taptana mcp` (el MCP por stdio). Sin carpeta,
   sirve el panel y los prototipos subidos.
2. **El recorder funciona solo.** Se pega como `<script>` en cualquier HTML. Lee
   `data-endpoint`, `data-prototype`, `data-transport`, `data-base`, `data-export`. Nunca asume
   que el servidor es el mismo origen.
3. **Los datos pertenecen a un prototipo.** Tabla `prototypes`; cada sesión y estudio apunta a uno.
4. **Base de datos detrás de una interfaz** (`Store`). SQLite hoy.
5. **Configuración por variables de entorno y flags**: `TAPTANA_PORT`, `TAPTANA_HOST`,
   `TAPTANA_DATA_DIR`, `TAPTANA_PANEL=open`, `TAPTANA_PUBLIC_URL`. Flags: `--port`, `--host`,
   `--data-dir`, `--no-open`, `--no-qr`, `--open-panel`, `--record-self`. Sin archivos de configuración.
6. **API con versión.** Todo bajo `/api/v1/`.
7. **`packages/shared` es el contrato.** Formato del estudio, eventos, pantallas, resultados y
   reporte viven ahí como funciones puras con pruebas. Servidor y demo calculan con lo mismo.
8. **El MCP es un cliente más de la API.** `packages/mcp` no tiene dependencias en ejecución:
   implementa a mano la parte de MCP que usa (JSON-RPC: `initialize`, `ping`, `tools/*`,
   `prompts/*`). Su núcleo (`createMcpHandler({ request })`) no sabe de transportes: stdio
   llama por HTTP a un Taptana corriendo; `POST /mcp` llama a la propia app con `app.request`.
   La guía del formato (`get_study_format`) es la skill `skills/taptana-study/SKILL.md`,
   copiada en el build: una sola fuente.

## Estructura del monorepo

```
taptana/
├── packages/
│   ├── shared/      Contrato: study.ts, validate.ts, events.ts, screen.ts, results.ts,
│   │                report.ts, insights.ts, deck.ts, preview.ts, api.ts (sin dependencias)
│   ├── recorder/    Script que corre en el celular: rrweb, gestos, pantallas (screens.ts),
│   │                flujo del participante (study.ts, study-ui.ts), privacidad, cola de envío
│   ├── mcp/         MCP para herramientas de IA: núcleo JSON-RPC, herramientas, stdio
│   │                (`taptana-mcp`), resumen del reporte. Sin dependencias (el SDK oficial
│   │                solo como devDependency, para la prueba con un cliente real)
│   ├── web/         Panel: React + Vite + shadcn. Modo http (servidor) y modo demo (Pages)
│   └── server/      CLI `taptana`, Hono, SQLite, guardia del panel, subidas, ejemplo
│       └── seed/    Sesiones de ejemplo (*.json), grabadas con scripts/record-seed.mjs
├── examples/tienda/ Prototipo de ejemplo + study.json (v2) + study-v1.json (formato viejo)
├── skills/taptana-study/   Skill para que una IA escriba un study.json (y guía del MCP)
├── scripts/
│   ├── start.mjs         `pnpm start`: revisa Node, instala/compila si hace falta, arranca
│   ├── build-site.mjs    Demo estática para Pages en ./site (TAPTANA_BASE)
│   ├── serve-site.mjs    Sirve ./site como Pages, para revisarla en local
│   ├── record-seed.mjs   Regenera packages/server/seed con participantes de Playwright
│   ├── screenshots.mjs   Regenera docs/img
│   └── lib/              Arranque del servidor y carga de Playwright para los scripts
├── tests/e2e/       Pruebas de punta a punta (`node --test` + Playwright), `pnpm e2e`
├── Dockerfile, docker-compose.yml   Servidor en contenedor, datos en /data
├── .github/workflows/   ci.yml (build + pruebas), pages.yml (publica la demo desde main)
├── .devcontainer/   Codespaces con Node 22 y pnpm
└── docs/
    ├── plan-v1.md              Plan y contrato de v1 (la referencia)
    ├── guia.md                 Guía para diseñadores: prueba moderada y no moderada, métricas
    ├── prototipos.md           Qué HTML funciona, apps de una página, data-screen
    ├── estudios-con-ia.md      Formato de bloques, prompt, skill
    ├── mcp.md                  Conectar una IA por MCP: configuración por herramienta, límites
    ├── servidor-hospedado.md   A dónde vamos con el hospedado
    ├── img/                    Capturas (generadas)
    └── propuesta-v0.1.md, constructor-de-estudios.md   Históricos
```

Dependencias entre paquetes: `shared` no depende de nadie. `recorder`, `web` y `mcp`
dependen de `shared`; `server` depende de `shared` y `mcp`. El build de `server` copia a su carpeta el bundle de `recorder`
(`public/recorder.js`), el panel compilado (`public/panel`) y el ejemplo (`example/tienda`),
con `packages/server/scripts/copy-assets.mjs`. Por eso el orden de build importa (`pnpm build`
lo respeta) y, tras cambiar `web` o `recorder`, hay que volver a compilar `server`.

## Formato del estudio (v2, bloques)

`Study { v: 2, name, prototypeId, welcome?, consent?, thanks?, blocks, variants?, settings?, closed? }`.
Bloques: `context`, `task`, `first-click`, `scale`, `choice`, `yesno`, `text`. Reglas de éxito:
`reached` (pantalla), `tapped` (selector), `visible` (selector o texto), `manual`.

- `validateStudy` acepta v1 (`tasks`) y v2 y devuelve siempre v2, con errores y avisos en
  español. `normalizeStudy` hace lo mismo con lo ya guardado. **Fuera de `shared` nadie lee
  `study.tasks`**: usar `study.blocks`, `taskBlocks(study)`, `questionBlocks(study)`.
- Los ids de bloque no se reutilizan (`newBlockId`).
- Una pantalla es un `ScreenId` (`screen.ts`): `/producto.html`, `/index.html#/carrito` o
  `/index.html~checkout` (virtual). Comparar siempre con `sameScreen`.

## Eventos (resumen)

El recorder manda lotes (`EventBatch`) a `POST /api/v1/events` con `prototypeId`, `sessionId`,
`pageId`, `seq` y `events`. Un lote repetido (misma sesión, página y `seq`) se ignora.

- `rrweb`: eventos crudos para el reproductor y para el fondo de los mapas de calor.
- `taptana`: `tap`, `swipe`, `scroll`, `viewport`, `navigation` (con `via` y `title`), `study`
  (start, finish), `task` (start, goal, done, skip) y `answer`.

La sesión vive en `sessionStorage` (una pestaña). Cada carga de página es un `pageId` nuevo.
`pageCount` cuenta cargas; `screenCount`, pantallas distintas.

## Servidor

- **Rutas de página**: `/panel` (el panel; `/sessions` redirige), `/p/<id>/` (prototipos
  subidos, con respaldo de app de una página y redirección por `Referer` para rutas
  absolutas), `/` (la carpeta servida, el prototipo marcado "Abrir en la raíz" o una página
  amable), `/__taptana/recorder.js`.
- **MCP** (`routes/mcp.ts`): `POST /mcp`, sin estado (respuesta JSON; 202 para
  notificaciones; `GET` → 405). Pasa por `guard.mcp`, que además acepta
  `Authorization: Bearer <llave>`.
- **API** (`routes/api.ts`): `/info`, `/events`, `/sessions` (lista, detalle, eventos,
  export, import con 409 salvo `?replace=1`, PATCH con `manual`/`label`/`notes`/`excluded`),
  `/studies` (CRUD, `/report?variant=&device=`, `/export.csv`, `/duplicate`), `/prototypes`
  (subir, nueva versión, PATCH `name`/`root`, `/screens`, `/source?path=` con el HTML en disco), `/example`, `/qr.svg`.
- **Guardia del panel**: pasa la conexión local, la que trae la llave (`?key=` → cookie) o
  todo si el modo es abierto. Bloquea peticiones entre sitios. La llave está en
  `<dataDir>/panel.key` y la terminal imprime el link. En Docker no hay conexión "local": el
  panel se abre siempre con el link con llave de los registros.
- **Datos**: `<dataDir>/taptana.db` y `<dataDir>/prototypes/<id>/`. Con `pnpm start`, `./.taptana`.
- **Ejemplo**: `POST /example` y `taptana seed` crean el prototipo `pr_ejemplo`, el estudio
  `st_demo_compra` y las sesiones de `seed/`. Es idempotente.

## Recorder: modos

- **record**: lo normal. Con `?study=<id>` corre el estudio (bienvenida, consentimiento, bloques).
- **preview** (`window.name = 'taptana-preview'` o `?taptana-preview`): no hace nada.
- **demo** (`taptana-demo`): no graba; avisa pantallas y toques al panel por `postMessage`
  (así el constructor graba el camino correcto y elige elementos).
- **tryout** (`taptana-tryout` o `?tryout=1`): corre el estudio completo sin grabar ni enviar.
- Transportes: `http` (lotes a la API) y `local` (IndexedDB en el navegador; la demo).

## Panel

- Rutas (bajo `/panel` en local, la base del sitio en la demo): Inicio, `prototypes`,
  `studies`, `studies/new`, `studies/:id` (constructor a tres columnas), `studies/:id/report`,
  `studies/:id/presentation?variant=&device=`, `recordings`, `recordings/:id?t=<ms>`.
- **Presentación**: `buildDeck` (`shared/deck.ts`) arma las diapositivas como datos desde el
  reporte y sus frases, sin nombres ni ids de sesión. `components/deck/layout.ts` las convierte
  en figuras (texto ya ajustado a su caja); las dibujan la vista en pantalla (y su PDF con
  `window.print`) y `pptx.ts` con `pptxgenjs`, cargado con `import()` solo al descargar. Las
  ediciones (textos, escondidas) viven en `localStorage` por estudio, no en el servidor.
- **Nunca accede a datos directamente**: siempre por `api/client.ts`, con `http.ts` (API real)
  y `static.ts` (demo). Cada método existe en los dos.
- Componentes de shadcn copiados a `src/components/ui/`, no instalados. Sin `window.confirm`.
- Las etiquetas de resultados y tipos de bloque salen de `shared` (`OUTCOME_LABELS`,
  `BLOCK_KIND_LABELS`) para que todo el panel diga lo mismo.

## Demo en GitHub Pages

`scripts/build-site.mjs` arma `./site`: el panel en modo demo, `demo/*.json` (sesiones,
`events.json` con los eventos propios, `studies.json`, `pages.json`), el prototipo de ejemplo
en `prototipo/` con el recorder en modo local y `404.html` para enlaces profundos (Pages
responde 404 en la consola aunque la página se vea bien: limitación documentada). Los
prototipos que el visitante sube viven en IndexedDB y los sirve `public/sw.js`. Todo queda en
ese navegador.

## Convenciones de código

- ESM en todos los paquetes (`"type": "module"`).
- Pruebas con `node --test`, junto al código como `*.test.ts`. Lógica pura siempre con prueba.
- El recorder se compila con esbuild a un solo archivo IIFE: `recorder.js`.
- Comentarios en español, solo donde agregan información.
- Mensajes de commit en inglés, imperativo, cortos. Documentación para el dueño en español.

## Git

- Se trabaja directamente en `main`. Sin ramas de feature mientras seamos un equipo chico.
- Commits pequeños y frecuentes, uno por paso explicable.

## Comandos

```
pnpm start                      # instala/compila si hace falta, arranca y abre el panel
pnpm start ./examples/tienda    # lo mismo, sirviendo una carpeta
pnpm build                      # compila todo, en orden
pnpm test                       # pruebas unitarias de todos los paquetes
pnpm e2e                        # pruebas de punta a punta (necesita Chromium de Playwright)
pnpm dev                        # servidor con la tienda de ejemplo, sin abrir el navegador
pnpm --filter @taptana/web dev  # panel con recarga instantánea (contra un servidor en 4321)
pnpm seed                       # carga el ejemplo en la base local
pnpm seed:record                # vuelve a grabar packages/server/seed (Playwright)
pnpm screenshots                # vuelve a tomar docs/img (Playwright)
pnpm site                       # demo estática en ./site (TAPTANA_BASE=/taptana/)
node packages/mcp/dist/bin.js   # MCP por stdio contra un Taptana corriendo (TAPTANA_URL, TAPTANA_KEY)
docker compose up -d            # servidor en contenedor; el link del panel sale en los logs
```

Los scripts con navegador usan el Playwright del proyecto; `TAPTANA_CHROMIUM` apunta a un
Chromium ya instalado. Después de `pnpm seed:record`, correr `pnpm build` y revisar el reporte
del ejemplo.

## Limitaciones conocidas

- Prototipos subidos comparten origen con el panel: aceptado en local; el hospedado necesita
  un dominio aparte (`docs/servidor-hospedado.md`).
- El mapa de calor usa como fondo lo que vio un participante; en pantallas que cambian mucho
  según el estado, los toques de otros pueden no caer sobre lo mismo.
- Sin HTTPS propio, sin cuentas. Una sola red Wi-Fi salvo que se despliegue en un servidor.
