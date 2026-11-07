# Propuesta v0.1: estructura de carpetas y formato de eventos

Este documento es para revisar antes de escribir código. Está en dos partes:

1. Cómo se organizan las carpetas y qué hace cada pieza.
2. Qué datos graba Taptana y con qué forma viajan y se guardan.

Al final hay una lista de decisiones abiertas donde necesito tu opinión.

---

## 1. Cómo funciona todo junto (en una imagen mental)

```
  LAPTOP DEL DISEÑADOR                          CELULAR DEL PARTICIPANTE
  ┌──────────────────────────────┐              ┌───────────────────────────┐
  │ taptana dev ./mi-prototipo   │              │ Navegador                 │
  │                              │   Wi-Fi      │                           │
  │  Servidor (Hono)             │◄────────────►│  Prototipo HTML           │
  │   • sirve el prototipo       │  HTTP        │   + recorder.js inyectado │
  │   • inyecta recorder.js      │              │                           │
  │   • recibe lotes de eventos  │◄─────────────│  Cada 3 s manda un lote   │
  │   • guarda en SQLite         │  POST        │  Al cerrar: sendBeacon    │
  │   • /sessions para revisar   │              └───────────────────────────┘
  └──────────────────────────────┘
```

Tres piezas con tres responsabilidades:

- **recorder**: corre en el celular. Observa y empaqueta. No decide nada.
- **server**: corre en la laptop. Sirve, recibe, guarda y muestra.
- **shared**: el "diccionario" que ambos comparten para hablar el mismo idioma (los tipos).

---

## 2. Estructura de carpetas

```
taptana/
├── CLAUDE.md                    Contexto y decisiones para quien programe (humano o IA)
├── README.md                    Cómo instalar y usar
├── LICENSE                      MIT
├── package.json                 Raíz del monorepo (scripts globales)
├── pnpm-workspace.yaml          Dice a pnpm dónde están los paquetes
├── tsconfig.base.json           Config de TypeScript compartida
│
├── packages/
│   │
│   ├── shared/                  @taptana/shared
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts         Exporta todo
│   │       ├── events.ts        Tipos de eventos (ver sección 3)
│   │       ├── session.ts       Tipos de sesión, página y dispositivo
│   │       └── api.ts           Forma de las peticiones y respuestas HTTP
│   │
│   ├── recorder/                @taptana/recorder
│   │   ├── package.json
│   │   ├── build.mjs            Script de esbuild: todo a un solo recorder.js
│   │   └── src/
│   │       ├── index.ts         Punto de entrada: arranca todo al cargar la página
│   │       ├── session.ts       Crea o recupera el sessionId (sessionStorage)
│   │       ├── rrweb.ts         Configura rrweb con maskAllInputs
│   │       ├── gestures.ts      Detecta toques y deslizamientos (touchstart/touchend)
│   │       ├── scroll.ts        Registra scroll con límite de frecuencia
│   │       ├── viewport.ts      Tamaño de pantalla, orientación, cambios
│   │       └── transport.ts     Cola de eventos, envío por lotes y sendBeacon
│   │
│   └── server/                  @taptana/server  (binario: `taptana`)
│       ├── package.json
│       ├── public/
│       │   ├── recorder.js      Copia del bundle del recorder (se genera en build)
│       │   ├── rrweb-player.js  Reproductor (copiado de node_modules en build)
│       │   └── rrweb-player.css
│       ├── views/
│       │   ├── sessions.html    Lista de sesiones
│       │   └── session.html     Reproductor de una sesión
│       └── src/
│           ├── cli.ts           Comando `taptana dev <carpeta>`
│           ├── app.ts           Crea la app Hono y monta las rutas
│           ├── inject.ts        Inserta <script src="/__taptana/recorder.js"> en cada HTML
│           ├── static.ts        Sirve la carpeta del prototipo
│           ├── network.ts       Detecta la IP local y genera el QR
│           ├── db/
│           │   ├── index.ts     Abre SQLite y aplica el esquema
│           │   ├── schema.sql   Tablas (ver sección 4)
│           │   └── sessions.ts  Consultas: crear sesión, guardar lote, listar, leer
│           └── routes/
│               ├── api.ts       POST /api/events, GET /api/sessions, GET /api/sessions/:id
│               └── sessions.ts  GET /sessions y GET /sessions/:id (páginas HTML)
│
├── examples/
│   └── tienda/                  Prototipo de ejemplo: tienda móvil con 4 páginas
│       ├── index.html           Home con lista de productos
│       ├── producto.html        Detalle de un producto
│       ├── carrito.html         Carrito con formulario (para ver el enmascarado)
│       ├── gracias.html         Confirmación
│       ├── styles.css
│       └── app.js               Carrito en localStorage, algo de interacción
│
└── docs/
    └── propuesta-v0.1.md        Este documento
```

### Por qué así

- **`shared` no tiene dependencias.** Es solo tipos. Así el recorder puede ser muy liviano.
- **El recorder se compila a un único archivo.** Es lo único que viaja al celular. Mientras más
  chico, más rápido carga el prototipo.
- **El server copia `recorder.js` a su carpeta `public/`.** Cuando publiquemos `@taptana/server`
  en npm, ya trae el recorder adentro. Quien instala no necesita compilar nada.
- **Las vistas son HTML plano.** `/sessions` es una página sencilla sin React ni nada. Para v0.1
  alcanza, y evita una capa más de build.
- **`examples/tienda` tiene un formulario a propósito.** Para que al reproducir se vea que lo
  escrito aparece como asteriscos.

### Rutas que expone el servidor

| Ruta | Quién la usa | Qué hace |
|---|---|---|
| `GET /` y `GET /*.html` | Celular | Sirve el prototipo con el recorder inyectado |
| `GET /__taptana/recorder.js` | Celular | El script de grabación |
| `POST /api/events` | Celular | Recibe un lote de eventos |
| `GET /sessions` | Laptop | Lista de sesiones |
| `GET /sessions/:id` | Laptop | Reproductor de una sesión |
| `GET /api/sessions` | Laptop | Lista en JSON (la usa la página) |
| `GET /api/sessions/:id/events` | Laptop | Eventos en JSON (los usa el reproductor) |

Todo lo propio de Taptana vive bajo `/__taptana/` y `/api/` y `/sessions` para no chocar con
archivos del prototipo. Si tu prototipo tuviera una página `sessions.html` no hay conflicto porque
la ruta es distinta.

---

## 3. Formato de eventos

### 3.1 Las tres ideas clave

**Sesión.** Una visita de una persona. Empieza cuando abre el prototipo y termina cuando
cierra la pestaña. Al navegar entre páginas del prototipo la sesión **sigue siendo la misma**.
Lo logramos guardando el `sessionId` en `sessionStorage`, que el navegador conserva mientras la
pestaña viva y borra al cerrarla. Justo lo que queremos: cada participante nuevo, sesión nueva.

**Página.** Cada vez que el navegador carga un HTML. Una sesión tiene varias páginas.
Importa porque rrweb necesita tomar una "foto completa" del DOM al empezar cada página.
El reproductor usa esas fotos como puntos de inicio.

**Evento.** Algo que pasó en un instante. Hay dos familias:

| Familia | Qué es | Para qué sirve |
|---|---|---|
| `rrweb` | Lo que rrweb graba por su cuenta: la foto inicial del DOM, cada cambio, cada movimiento | Reproducir la sesión como video |
| `taptana` | Resúmenes que calculamos nosotros: un toque aquí, un deslizamiento allá | Entender qué hizo el usuario sin mirar el video entero. En el futuro: marcadores en la línea de tiempo, mapas de calor, métricas |

¿Por qué las dos, si rrweb ya graba los toques? Porque rrweb graba *coordenadas crudas* a
mucha frecuencia (ideal para reproducir, malo para analizar). Nuestros eventos `taptana` dicen
"tocó el botón Comprar" en una sola línea. Son los que después vas a querer listar o contar.

### 3.2 Tiempos

Todos los tiempos son **milisegundos desde 1970** (lo que da `Date.now()`), en el reloj del
celular. rrweb usa el mismo formato, así que todo queda alineado sin conversiones.
La duración de una sesión se calcula como último evento menos primer evento.

### 3.3 Lo que viaja: un lote

```ts
// Lo que el recorder manda a POST /api/events
interface EventBatch {
  v: 1;                    // versión del formato, para poder cambiarlo después
  sessionId: string;       // ej. "s_7Kq2mNp4xR"
  pageId: string;          // ej. "p_3fLw9Az1bT"
  seq: number;             // 0, 1, 2... número del lote dentro de la página
  sentAt: number;          // cuándo se envió
  events: TaptanaEvent[];  // la carga útil, en orden
  // Solo en el primer lote de cada página (seq === 0):
  page?: PageInfo;
  device?: DeviceInfo;
}

interface PageInfo {
  path: string;            // "/producto.html?id=3"
  title: string;           // <title> de la página
  referrer: string;        // de dónde vino (vacío si es la primera)
  startedAt: number;
}

interface DeviceInfo {
  userAgent: string;       // texto largo del navegador; lo resumimos en el server
  screen: { width: number; height: number };     // pantalla física
  viewport: { width: number; height: number };   // área visible
  dpr: number;             // densidad de píxeles (2 o 3 en celulares)
  touch: boolean;          // ¿tiene pantalla táctil?
  language: string;        // "es-PE"
}
```

¿Por qué `device` solo en el primer lote? Para no mandar el user agent (unos 150 caracteres)
cada 3 segundos. El server lo guarda una vez en la tabla de sesiones.

### 3.4 Los eventos

```ts
type TaptanaEvent = RrwebEvent | TapEvent | SwipeEvent | ScrollEvent | ViewportEvent | NavigationEvent;

// ── Familia rrweb ───────────────────────────────────────────────
interface RrwebEvent {
  kind: 'rrweb';
  t: number;
  data: unknown;           // el evento tal cual lo produce rrweb; no lo tocamos
}

// ── Familia taptana ─────────────────────────────────────────────
interface TapEvent {
  kind: 'taptana';
  type: 'tap';
  t: number;
  x: number;  y: number;   // posición en el viewport, en píxeles CSS
  target: TargetInfo;      // qué tocó
}

interface SwipeEvent {
  kind: 'taptana';
  type: 'swipe';
  t: number;               // cuándo terminó el gesto
  direction: 'up' | 'down' | 'left' | 'right';
  startX: number; startY: number;
  endX: number;   endY: number;
  durationMs: number;
}

interface ScrollEvent {
  kind: 'taptana';
  type: 'scroll';
  t: number;
  x: number;  y: number;   // posición del scroll
  depth: number;           // 0 a 1: qué tan abajo llegó (y + alto visible) / alto total
}

interface ViewportEvent {
  kind: 'taptana';
  type: 'viewport';
  t: number;
  width: number; height: number;
  orientation: 'portrait' | 'landscape';
}

interface NavigationEvent {
  kind: 'taptana';
  type: 'navigation';
  t: number;
  from: string;            // path anterior ("" si es la entrada)
  to: string;              // path nuevo
}

// Describe el elemento tocado sin guardar contenido sensible
interface TargetInfo {
  tag: string;             // "button", "a", "input"
  id?: string;             // id del elemento si tiene
  text?: string;           // texto visible, máximo 40 caracteres, NUNCA de inputs
  selector: string;        // ruta CSS corta: "main > .card:nth-child(2) > button"
  role?: string;           // aria-role si tiene
}
```

### 3.5 Cómo detectamos cada cosa (reglas simples)

| Evento | Regla |
|---|---|
| `tap` | Dedo baja y sube en menos de 300 ms, moviéndose menos de 10 px |
| `swipe` | Dedo baja y sube en menos de 600 ms, moviéndose más de 40 px. La dirección es la del eje con más desplazamiento |
| `scroll` | Se registra como máximo una vez cada 250 ms mientras se hace scroll, y una vez más al detenerse |
| `viewport` | Uno al cargar la página y uno cada vez que cambia el tamaño u orientación |
| `navigation` | Uno al cargar cada página (`from` sale del referrer o de sessionStorage) |

En laptop (sin táctil) los `tap` salen del click del mouse, para poder probar sin celular.
No hay `swipe` con mouse.

Un `scroll` largo con el dedo produce varios `scroll` y ningún `swipe`, porque el gesto dura
más de 600 ms. Un "flick" rápido produce un `swipe` y luego varios `scroll` por la inercia.
Para v0.1 lo dejamos así; se puede afinar viendo grabaciones reales.

### 3.6 Enmascarado

rrweb con `maskAllInputs: true` reemplaza cada carácter escrito en `<input>`, `<textarea>` y
`<select>` por `*` **antes** de que salga del celular. El texto real nunca llega al servidor.
Además, `TargetInfo.text` nunca se llena para inputs. Lo que sí se graba: que el campo recibió
foco, cuántos caracteres se escribieron (por la cantidad de asteriscos) y cuándo.

### 3.7 Envío

- El recorder acumula eventos en memoria.
- Cada **3 segundos**, o si hay más de **200 eventos**, manda un lote con `fetch`.
- Si falla el envío, los eventos se quedan en la cola y se reintentan en el siguiente ciclo.
- Al cerrar o cambiar de página (`visibilitychange` → hidden, y `pagehide`), manda lo que queda
  con `navigator.sendBeacon`, que el navegador garantiza entregar aunque la página ya no exista.
- Límite de sendBeacon: 64 KB. Si la cola es más grande, se manda en varios beacons.

---

## 4. Cómo se guarda en SQLite

Tres tablas, directas:

```sql
CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,
  started_at    INTEGER NOT NULL,     -- ms epoch, del primer evento
  last_seen_at  INTEGER NOT NULL,     -- se actualiza con cada lote
  user_agent    TEXT,
  device_label  TEXT,                 -- "iPhone · Safari 18", calculado del user agent
  screen_w      INTEGER, screen_h INTEGER,
  viewport_w    INTEGER, viewport_h INTEGER,
  dpr           REAL,
  touch         INTEGER,              -- 0 o 1
  language      TEXT,
  entry_path    TEXT                  -- primera página que abrió
);

CREATE TABLE pages (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES sessions(id),
  path          TEXT NOT NULL,
  title         TEXT,
  started_at    INTEGER NOT NULL
);

CREATE TABLE events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    TEXT NOT NULL REFERENCES sessions(id),
  page_id       TEXT NOT NULL REFERENCES pages(id),
  t             INTEGER NOT NULL,     -- ms epoch
  kind          TEXT NOT NULL,        -- 'rrweb' | 'taptana'
  type          TEXT,                 -- 'tap', 'swipe'... (NULL para rrweb)
  data          TEXT NOT NULL         -- el evento completo en JSON
);

CREATE INDEX events_session_t ON events (session_id, t);
```

Un evento por fila, con el JSON completo en `data`. Las columnas `kind` y `type` están
duplicadas fuera del JSON para poder filtrar rápido ("dame solo los taps de esta sesión")
sin abrir cada JSON.

El archivo de la base vive en `.taptana/taptana.db` dentro de la carpeta desde donde corres el
comando. Agregamos `.taptana/` al `.gitignore` del ejemplo.

### Lo que muestra `/sessions`

| Columna | De dónde sale |
|---|---|
| Fecha | `started_at` |
| Dispositivo | `device_label` + `viewport_w×viewport_h` |
| Duración | `last_seen_at - started_at` |
| Páginas | `COUNT(*)` en `pages` |
| Toques | `COUNT(*)` en `events WHERE type = 'tap'` |

Al hacer clic se abre `/sessions/:id` con rrweb-player cargando todos los eventos `rrweb` de la
sesión en orden. Como cada página tiene su propia foto inicial, el reproductor cambia de página
solo, siguiendo el tiempo real.

---

## 5. Decisiones abiertas (necesito tu opinión)

1. **Puerto por defecto.** Propongo `4321`. Es fácil de recordar y rara vez está ocupado.
   ¿Te parece o prefieres otro?

2. **Nombre del comando.** Escribiste `taptan dev`. Asumo que es `taptana dev` (con la "a"
   final), igual que el proyecto. Si prefieres `taptan` como comando corto, se puede.

3. **Nombre del prototipo de ejemplo.** Propongo una tienda móvil de 4 páginas
   (home → producto → carrito con formulario → gracias). Es un flujo que cualquier participante
   entiende y tiene un formulario para demostrar el enmascarado. ¿Otro tema que prefieras?

4. **Umbrales de gestos.** Los números de la sección 3.5 (300 ms, 10 px, 40 px...) son puntos
   de partida razonables. Se pueden ajustar después con grabaciones reales. ¿Los dejamos así?

5. **Nueva sesión en cada recarga, o persistir.** Con `sessionStorage`, si el participante
   recarga la página la sesión continúa (bien). Si cierra la pestaña y vuelve a abrir, es una
   sesión nueva (bien para v0.1, cada participante nuevo abre el QR). ¿Confirmas?

6. **Mouse en laptop.** Propongo que el recorder también funcione con mouse para que puedas
   probar sin celular. Los eventos quedan marcados igual; en `/sessions` se ve `touch: no`.
   ¿Lo incluimos en v0.1?

Si todo está bien, el siguiente paso es armar el esqueleto del monorepo (package.json,
workspaces, tsconfig) y el paquete `shared` con exactamente estos tipos. Después el recorder,
después el server, y al final el ejemplo. Cada paso lo explico al terminarlo.
