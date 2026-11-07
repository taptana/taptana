# Taptana

Herramienta open source (MIT) de pruebas de usabilidad para prototipos HTML, pensada mobile first.

## Para quién es

Diseñadores que hacen prototipos HTML con vibe coding y quieren probarlos con usuarios reales.
El dueño del proyecto es diseñador, no programador: explicar cada paso en lenguaje simple,
sin asumir conocimiento de backend, y justificar las decisiones técnicas en términos de
qué resuelven para la prueba de usabilidad.

## Cómo se usa (v0.1)

1. El diseñador corre `taptana dev ./mi-prototipo` en su laptop.
2. La terminal muestra la IP local y un código QR.
3. El participante escanea el QR con su celular (misma red Wi-Fi) y usa el prototipo.
4. Todo lo que hace se graba. El diseñador abre `http://<ip>:4321/sessions` y lo reproduce.

Es una prueba moderada en local: diseñador y participante están en el mismo lugar.

## Posicionamiento y modelo

- Alternativa open source a Maze, para prototipos HTML reales en celulares reales.
- Modelo tipo Penpot: todo el código es abierto y cualquiera lo instala en su infraestructura.
  Nosotros ofreceremos además un servidor hospedado (para probar en vivo sin instalar y, a
  futuro, para monetizar). Ver `docs/servidor-hospedado.md`.
- **Licencia: MIT en todos los paquetes.** Decidido. No se cambia sin discutirlo explícitamente.
- No competimos en reportes el primer año. Ganamos en "funciona con cualquier HTML, lo instalo
  donde quiera, mis datos son míos".

## Hoja de ruta

- **v0.1 (actual):** grabación local, una laptop, una red Wi-Fi, HTTP simple.
- **v0.2:** modo servidor (`taptana serve`): subir un zip del prototipo, obtener un link,
  imagen Docker. Recorder usable como script independiente en cualquier HTML.
- **v0.3 (hecho, salvo MCP):** tareas y consentimiento, formato `Study` importable, constructor
  en el panel, skill para que una IA arme el estudio. Pendiente: `packages/mcp`.
  Ver `docs/estudios-con-ia.md` y `docs/constructor-de-estudios.md`.
- **v0.4:** métricas: tiempo por tarea, éxito, mapas de toques.
- **v0.5:** cuentas y equipos. Recién aquí tiene sentido el hospedado con pago.
- **Fuera de v0.1:** tareas, consentimiento, panel completo, mapas de calor, login, HTTPS.
- Servidor compartido instalable en cualquier lado (Node, Docker, Azure). Por eso: cero
  dependencias de un proveedor específico, nada de servicios cloud propietarios.

## Stack y decisiones técnicas

| Decisión | Elección | Por qué |
|---|---|---|
| Lenguaje | TypeScript en todo el monorepo | Tipos compartidos entre recorder y server |
| Monorepo | pnpm workspaces | Un solo repo, varios paquetes, sin herramientas extra |
| Runtime | Node 22+ | Trae SQLite nativo (`node:sqlite`) |
| Base de datos | `node:sqlite` (DatabaseSync) | Sin dependencias que requieran compilar (nada de better-sqlite3) |
| Servidor HTTP | Hono + `@hono/node-server` | Liviano, portable, mismo código sirve para Node y Docker después |
| Grabación | rrweb 2.x | Graba el DOM y lo reproduce fielmente, sin video |
| Reproducción | rrweb-player 2.x | Reproductor listo con línea de tiempo |
| Panel | React + Vite + Tailwind v4 + shadcn en `packages/web` | Sin construir un sistema de diseño; se compila a estáticos que Hono sirve |
| QR en terminal | qrcode-terminal | Sin dependencias nativas |
| Red | Escucha en `0.0.0.0`, puerto 4321 por defecto | Accesible desde el celular en la misma Wi-Fi |
| Privacidad | `maskAllInputs: true` en rrweb | Todo texto escrito por el participante se enmascara |

Reglas duras:

- **Nunca** agregar una dependencia nativa a lo que ejecuta el servidor (nada de node-gyp ni
  prebuilds en `server`, `recorder` o `shared`). Herramientas de build con binarios
  precompilados (esbuild, Tailwind v4) están bien: solo corren al construir, nunca en producción.
- **Nunca** acoplar a un proveedor cloud. Todo tiene que correr con `node` y una carpeta.
- Las entradas de texto siempre van enmascaradas. No hay opción para desactivarlo en v0.1.

## Decisiones de arquitectura pensando en el servidor hospedado

Son baratas en v0.1 y caras después. Se aplican desde el primer commit de código:

1. **Un solo binario, dos modos.** `taptana dev <carpeta>` (local) y, más adelante,
   `taptana serve` (compartido). Mismo código, misma base, misma página de sesiones.
   Solo cambia de dónde salen los prototipos: carpeta local hoy, zip subido mañana.
2. **El recorder funciona solo.** Se puede pegar como `<script>` en cualquier HTML alojado
   en cualquier lado. Lee el endpoint y el prototipo de atributos `data-*` del script.
   Nunca asume que el servidor es el mismo origen. El server responde CORS en `/api/`.
3. **Los datos pertenecen a un prototipo.** Tabla `prototypes`; cada sesión apunta a una.
   En v0.1 hay un solo prototipo (la carpeta servida), creado automáticamente.
4. **Base de datos detrás de una interfaz.** `Store` con pocas funciones. Implementación
   SQLite hoy; Postgres mañana sin tocar rutas.
5. **Configuración por variables de entorno y flags.** `TAPTANA_PORT`, `TAPTANA_DATA_DIR`,
   `TAPTANA_HOST`. Los flags del CLI las sobreescriben. Sin archivos de configuración.
6. **API con versión.** Todo bajo `/api/v1/`.

Lo que NO se hace antes de v0.4: usuarios y login, multi-tenant real, planes de pago, Postgres.

## Estructura del monorepo

```
taptana/
├── packages/
│   ├── shared/      Tipos y formato de eventos (sin dependencias)
│   ├── recorder/    Script que se inyecta en el prototipo (corre en el celular)
│   ├── web/         Panel: React + Vite + shadcn. Modo http (servidor) y modo demo (Pages)
│   └── server/      CLI `taptana`, servidor Hono, SQLite, sirve el panel compilado
├── examples/
│   └── tienda/      Prototipo HTML de ejemplo con varias páginas (+ study.json de muestra)
├── skills/
│   └── taptana-study/   Skill para que una IA escriba un study.json leyendo el prototipo
├── .github/workflows/pages.yml   Publica panel + ejemplo en GitHub Pages en cada push a main
├── .devcontainer/   Codespaces con Node 22 y pnpm, para correr el servidor real sin instalar
└── docs/            Propuestas y decisiones de diseño
    ├── propuesta-v0.1.md       Carpetas, formato de eventos, esquema SQLite
    ├── servidor-hospedado.md   Cómo será la versión para probar en vivo sin instalar
    └── estudios-con-ia.md      Formato Study, skill y MCP para crear estudios con IA
```

El servidor nunca llama a un modelo de IA. La IA la pone el usuario con su herramienta; Taptana
solo expone un formato de estudio importable y, después, un MCP sobre su propia API.

Dependencias entre paquetes: `shared` no depende de nadie. `recorder`, `web` y `server`
dependen de `shared`. `server` empaqueta el bundle de `recorder` para inyectarlo y los
estáticos de `web` para servir el panel.

## Probar sin servidor

- El recorder tiene dos transportes: `http` (lotes a la API) y `local` (IndexedDB + botón
  "exportar sesión" que descarga un `.json`). Se elige con `data-transport` en el `<script>`.
- El panel tiene dos fuentes de datos: `http.ts` (API real) y `static.ts` (JSON incluidos en
  el sitio, modo demo). El panel también importa un `.json` exportado por el recorder.
- GitHub Pages publica el panel en modo demo y el prototipo de ejemplo con recorder local.
- Codespaces corre el servidor real con URL pública. Es la forma de probar `taptana dev`
  desde un celular sin instalar nada.

Detalle completo de carpetas y del formato de eventos en `docs/propuesta-v0.1.md`.

## Formato de eventos (resumen)

Todo lo que graba el recorder viaja en lotes (`EventBatch`) a `POST /api/v1/events`.
Cada lote lleva `prototypeId`, `sessionId`, `pageId`, y una lista de `events`. Hay dos familias:

- `rrweb`: eventos crudos de rrweb (snapshot del DOM, mutaciones, scroll, etc.). Son los que
  alimentan al reproductor.
- `taptana`: eventos propios de interés para usabilidad: `tap`, `swipe`, `scroll`, `viewport`,
  `navigation`. Son resúmenes legibles para después listar, buscar y analizar.

La sesión se mantiene al navegar entre páginas con `sessionStorage` (vive mientras la
pestaña esté abierta). Cada carga de página es un `pageId` nuevo dentro de la misma sesión.

## Convenciones de código

- ESM en todos los paquetes (`"type": "module"`).
- `pnpm -r build` compila todo. `pnpm -r test` corre pruebas con `node --test` (sin frameworks).
- El recorder se compila con esbuild a un solo archivo IIFE: `recorder.js`.
- El panel es React con shadcn. Los componentes de shadcn se copian a `packages/web/src/components/ui/`,
  no se instalan como dependencia.
- El panel nunca accede a datos directamente: siempre a través de `api/client.ts`, para que el
  modo demo y el modo real sean intercambiables.
- Mensajes de commit en inglés, imperativo, cortos. Documentación para el dueño en español.
- Nombres de código (variables, tipos, rutas) en inglés.

## Git

- Se trabaja directamente en `main`. Sin ramas de feature mientras seamos un equipo chico.
  Las ramas y los pull requests llegan cuando haya contribuidores externos.
- Commits pequeños y frecuentes, uno por paso explicable.

## Comandos

```
pnpm install
pnpm -r build
pnpm --filter @taptana/server dev ./examples/tienda   # arranca el servidor en desarrollo
pnpm --filter @taptana/web dev                        # panel con recarga instantánea
pnpm seed                                             # sesiones de ejemplo en la base local
pnpm site                                             # sitio estático para GitHub Pages en ./site
pnpm -r test
```

Las sesiones de ejemplo viven en `packages/server/seed/*.json`. Son grabaciones reales del
prototipo de ejemplo hechas con Playwright; se usan para `pnpm seed` y para la demo en Pages.

## Estudios (v0.3, implementado)

- Formato `Study` en `shared` (`study.ts`), validado con `validateStudy`. Tareas con `kind`
  (`task`, `first-click`) y `success` (`reached`, `tapped`, `manual`). Variantes A/B opcionales.
- Server: tabla `studies`, columnas `study_id`, `variant_id`, `manual_results` en `sessions`.
  Resultados por tarea en `results.ts` (función pura, probada). Rutas `/api/v1/studies`,
  `/api/v1/prototypes/:id/pages`, `/api/v1/qr.svg`, `PATCH /api/v1/sessions/:id`.
- Recorder: `study.ts`. `?study=<id>` → bienvenida + consentimiento (lotes retenidos hasta
  aceptar), barra de tarea, first click con cinta inferior que no intercepta toques, eventos
  `study` y `task`. Tras un toque que cierra una tarea, la siguiente se dibuja 350 ms después
  para que el clic llegue al prototipo y no a nuestra barra.
- Panel: `pages/Studies.tsx`, `pages/StudyEditor.tsx` (constructor, link con QR, "Copiar prompt
  para IA"), resultados en `Sessions.tsx` y `Player.tsx` con marcas manuales.
- `skills/taptana-study/SKILL.md`: skill para que una IA escriba el `study.json`.
- Detalles y decisiones en `docs/constructor-de-estudios.md`.

## Estado de v0.1

Implementado y probado end-to-end (Playwright emulando iPhone y Android): grabación con la
misma sesión entre páginas, enmascarado de inputs, lotes por HTTP y sendBeacon, modo local con
exportar e importar, panel con reproductor y marcas en la línea de tiempo, `pnpm seed`,
`--record-self`, sitio estático para Pages, devcontainer para Codespaces.
