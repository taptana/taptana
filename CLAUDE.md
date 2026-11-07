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

## Hoja de ruta

- **v0.1 (actual):** grabación local, una laptop, una red Wi-Fi, HTTP simple.
- **Después:** servidor compartido instalable en cualquier lado (Node, Docker, Azure).
  Por eso: cero dependencias de un proveedor específico, nada de servicios cloud propietarios.
- **Fuera de v0.1:** tareas, consentimiento, panel completo, mapas de calor, login, HTTPS.

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
| QR en terminal | qrcode-terminal | Sin dependencias nativas |
| Red | Escucha en `0.0.0.0`, puerto 4321 por defecto | Accesible desde el celular en la misma Wi-Fi |
| Privacidad | `maskAllInputs: true` en rrweb | Todo texto escrito por el participante se enmascara |

Reglas duras:

- **Nunca** agregar una dependencia que necesite compilación nativa (node-gyp, prebuilds).
- **Nunca** acoplar a un proveedor cloud. Todo tiene que correr con `node` y una carpeta.
- Las entradas de texto siempre van enmascaradas. No hay opción para desactivarlo en v0.1.

## Estructura del monorepo

```
taptana/
├── packages/
│   ├── shared/      Tipos y formato de eventos (sin dependencias)
│   ├── recorder/    Script que se inyecta en el prototipo (corre en el celular)
│   └── server/      CLI `taptana`, servidor Hono, SQLite, página /sessions
├── examples/
│   └── tienda/      Prototipo HTML de ejemplo con varias páginas
└── docs/            Propuestas y decisiones de diseño
```

Dependencias entre paquetes: `shared` no depende de nadie. `recorder` y `server` dependen
de `shared`. `server` empaqueta el bundle de `recorder` para inyectarlo.

Detalle completo de carpetas y del formato de eventos en `docs/propuesta-v0.1.md`.

## Formato de eventos (resumen)

Todo lo que graba el recorder viaja en lotes (`EventBatch`) a `POST /api/events`.
Cada lote lleva `sessionId`, `pageId`, y una lista de `events`. Hay dos familias:

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
- Sin frameworks de frontend en `/sessions`: HTML + CSS + JS plano servido por Hono.
- Mensajes de commit en inglés, imperativo, cortos. Documentación para el dueño en español.
- Nombres de código (variables, tipos, rutas) en inglés.

## Comandos

```
pnpm install
pnpm -r build
pnpm --filter @taptana/server dev ./examples/tienda   # arranca el servidor en desarrollo
pnpm -r test
```
