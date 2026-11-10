# Taptana v1: listo para piloto

Plan de construcción y contrato entre paquetes. Quien implemente una parte programa contra lo
que dice aquí. Identificadores en inglés; textos de interfaz en español, de tú.

Sale de una auditoría con ocho probadores (uso real como diseñador y como participante,
prototipos de una sola página, números del reporte, código, demo pública, comparación con Maze).
Sus hallazgos verificados están al final, por responsable.

## 0. Meta

Que un equipo de diseño pueda hacer un piloto real de pruebas de tareas con prototipos HTML:
subir el prototipo, armar el estudio por bloques como en Maze, compartir un link y leer un
reporte que diga qué pasó y qué arreglar. Fácil para alguien no técnico. Todo local.

"Listo" significa:

1. De cero a primer resultado sin leer documentación: `pnpm start` abre el panel en **Inicio**,
   que guía en 4 pasos y carga un ejemplo con un clic.
2. Funciona con prototipos reales hechos con IA: multipágina, de una sola página con rutas por
   hash o History API, de un solo archivo que muestra y oculta pantallas, y con rutas absolutas.
3. Un estudio es una lista de **bloques**: contexto, tarea, primer clic y preguntas (escala,
   opción múltiple, sí/no, abierta). Se puede **probar sin grabar** y **grabar el camino
   correcto haciéndolo** sobre el prototipo, sin escribir selectores CSS.
4. El reporte muestra, por bloque: puntaje de usabilidad, éxito directo/indirecto, misclicks,
   tiempos, embudo, mapas de calor sobre lo que el participante vio y respuestas; trae un
   resumen de qué arreglar; se filtra, se exporta a CSV y se imprime a PDF.
5. Los datos son confiables: sin duplicados, sesiones de prueba excluibles, tareas manuales sin
   revisar marcadas como "por revisar" (no como fracaso), definiciones a la vista.
6. Privacidad sin huecos: nada se graba sin consentimiento en un estudio; lo que se escribe en
   el prototipo no sale del celular ni por la URL ni por texto repetido en pantalla; el panel
   con las grabaciones no queda abierto a toda la red.
7. Hay pruebas automáticas de punta a punta en el repo y la demo de Pages muestra todo esto.

## 1. Contrato en `packages/shared`

### 1.1 Estudio v2 (bloques)

```ts
export type SuccessRule =
  | { type: 'reached'; path: string }                      // llegó a esta pantalla (ScreenId, ver 1.3)
  | { type: 'tapped'; selector: string }                   // tocó este elemento
  | { type: 'visible'; selector?: string; text?: string }  // aparece un elemento y/o un texto (al menos uno)
  | { type: 'manual' };                                    // lo decide el moderador

export type TaskKind = 'task' | 'first-click';
export type QuestionKind = 'scale' | 'choice' | 'yesno' | 'text';
export type BlockKind = TaskKind | QuestionKind | 'context';

export interface TaskBlock {
  id: string;
  kind?: TaskKind;              // por defecto 'task'
  title: string;                // para el panel
  instruction: string;          // lo que lee el participante
  startPath?: string;           // ScreenId por URL ("/index.html", "/index.html#/cart"); no aplica a pantallas virtuales
  success: SuccessRule;
  expectedPath?: string[];      // ScreenIds en orden
}
interface QuestionBase { id: string; question: string; description?: string; required?: boolean }
export interface ScaleBlock extends QuestionBase { kind: 'scale'; max: 5 | 7 | 10; minLabel?: string; maxLabel?: string } // de 1 a max
export interface ChoiceBlock extends QuestionBase { kind: 'choice'; options: string[]; multiple?: boolean }
export interface YesNoBlock extends QuestionBase { kind: 'yesno' }
export interface TextBlock extends QuestionBase { kind: 'text'; placeholder?: string }
export interface ContextBlock { id: string; kind: 'context'; title: string; text: string }
export type QuestionBlock = ScaleBlock | ChoiceBlock | YesNoBlock | TextBlock;
export type Block = TaskBlock | QuestionBlock | ContextBlock;
export type Task = TaskBlock; // alias de compatibilidad

export interface StudySettings {
  advance?: 'auto' | 'manual';  // 'auto' (por defecto): al cumplirse la regla, la tarea termina sola
  askName?: boolean;            // pedir nombre o alias (opcional para el participante) en la bienvenida
}

export interface Study {
  v: 2;
  name: string;
  description?: string;
  prototypeId: string;
  welcome?: string;
  consent?: string;
  thanks?: string;              // texto de la pantalla final
  blocks: Block[];
  variants?: StudyVariant[];
  settings?: StudySettings;
  closed?: boolean;             // true: ya no recibe respuestas
}
```

- `validateStudy(value)` acepta **v1** (`{ v: 1, tasks: [...] }`) y **v2**, y siempre devuelve un
  `Study` v2 normalizado (`tasks` → `blocks`). `normalizeStudy(record)` hace lo mismo con lo ya
  guardado (base de datos, IndexedDB, semillas). Fuera de `shared` nadie lee `study.tasks`.
- Helpers: `isTaskBlock`, `isQuestionBlock`, `taskBlocks(study)`, `questionBlocks(study)`,
  `newBlockId()` (`b_` + 6 caracteres al azar: **los ids no se reutilizan nunca**; los ids v1
  `t1…` se conservan al importar).
- Validación con **mensajes en español para diseñadores** ("Ponle un nombre al estudio",
  "La tarea 2 no tiene instrucción"), cada error con `blockId` y `field` cuando aplica:
  `validateStudy` devuelve `{ ok: false, error, issues: Array<{ message, blockId?, field? }> }`.
  Reglas: ids únicos entre todos los bloques; `choice` con 2 a 12 opciones no vacías;
  `scale.max` ∈ {5, 7, 10}; `visible` con `selector` o `text`; `reached` con `path` no vacío;
  primer clic solo con regla `tapped` o `reached`; topes de texto (pregunta 300, opción 120,
  instrucción 600, nombre 120); al menos un bloque.
- `DEFAULT_CONSENT_TEXT`: "Acepto que esta sesión se grabe (pantalla, toques y navegación) para
  mejorar este prototipo. Lo que escriba dentro del prototipo no se guarda; mis respuestas a las
  preguntas del estudio sí." `DEFAULT_THANKS_TEXT`: "Eso era todo. Puedes cerrar esta página."

### 1.2 Eventos

```ts
export interface NavigationEvent { kind: 'taptana'; type: 'navigation'; t: number; from: string; to: string;
  title?: string;                                  // título o encabezado de la pantalla
  via?: 'load' | 'history' | 'hash' | 'screen' }   // 'screen' = pantalla virtual (misma URL)
export interface TargetInfo { /* lo actual */ }    // text: en campos de formulario, su etiqueta (label, aria-label o placeholder), nunca su valor
export interface TapEvent { /* lo actual */ fixed?: boolean; vh?: number } // fixed: cayó en un elemento position:fixed; vh: alto del viewport
export interface TaskEvent { kind: 'taptana'; type: 'task'; t: number; taskId: string;
  action: 'start' | 'goal' | 'done' | 'skip';      // 'goal': el recorder vio cumplirse la regla
  auto?: boolean }                                 // done automático (advance: 'auto')
export interface AnswerEvent { kind: 'taptana'; type: 'answer'; t: number; blockId: string;
  value: number | boolean | string | string[] | null;   // null = la saltó
  durationMs?: number }
export interface StudyEvent { /* lo actual */ participant?: string }   // alias que escribió, si se pidió
```

- `target.interactive` cambia de significado: `true` si el elemento (o un ancestro cercano) es
  tocable por naturaleza (enlace, botón, campo, `role`, `onclick`, cursor de mano) **o si el
  toque tuvo efecto** (cambió el DOM, la pantalla, el foco o el scroll en los 350 ms
  siguientes). Misclick = toque sin efecto sobre algo no tocable.
- **URLs sin datos escritos**: `maskUrl(pathWithQuery)` en `shared` conserva la ruta y los
  nombres de los parámetros y reemplaza cada valor por `*` (`/buscar?q=*`). Se aplica a
  `navigation.to/from`, `PageInfo.path`, `PageInfo.referrer` y al `href` del evento Meta de rrweb.
- `validateEventBatch` valida `device` y `page` campo por campo (400 con mensaje claro) y
  descarta tipos de evento desconocidos.

### 1.3 Pantallas (`screen.ts`)

Un `ScreenId` identifica lo que el participante tiene delante:

- por URL: `/producto.html` (sin query; `/` y `/carpeta/` → `…/index.html`);
- por hash de ruta: `/index.html#/carrito` (solo si el hash empieza con `#/` o `#!`);
- virtual: `/index.html~checkout` (misma URL; el nombre sale de `data-screen`, del id del
  contenedor activo o del encabezado).

```ts
export function screenId(path: string): string;        // normaliza cualquiera de las formas (screenPath queda como alias)
export function sameScreen(a: string, b: string): boolean;
export function screenLabel(id: string): string;       // "producto", "carrito", "checkout"
```

`reached` compara con `sameScreen`; `samePath` queda como alias.

### 1.4 Resultados y reporte

```ts
export type TaskOutcome = 'success' | 'reported' | 'failed' | 'incomplete' | 'pending';   // sin cambios
export interface TaskResult { /* lo actual */ goalAt?: number }   // cuándo se cumplió la regla
export interface AnswerResult { blockId: string; value: AnswerEvent['value']; t: number; durationMs?: number }

export interface SessionSummary { /* lo actual */
  label?: string;        // etiqueta del moderador ("P3 · Ana")
  participant?: string;  // alias que escribió el participante
  notes?: string;        // notas del moderador
  excluded?: boolean;    // no cuenta en el reporte (pruebas internas)
  answers?: AnswerResult[];
  screenCount?: number;  // pantallas distintas (pageCount sigue siendo cargas de página)
}

export interface HeatPoint { x: number; y: number; vw: number; misclick: boolean; sessionId: string;
  fixed?: boolean; vy?: number; vh?: number }   // fixed: usar vy/vh (posición en el viewport)

export interface ScreenReport { /* lo actual; `path` es un ScreenId */
  title?: string;
  sample?: { sessionId: string; t: number; vw: number };   // instante de una sesión real para dibujar el fondo
  topMisclicks: Array<{ label: string; count: number }>;   // lo más tocado sin efecto
}

export interface TaskOutcomeCounts { direct: number; indirect: number; reported: number; failed: number; incomplete: number;
  review: number }   // tarea manual: tocó "Listo" y el moderador aún no decide

export interface TaskReport { /* lo actual */
  score: number | null;            // 0 a 100
  medianTimeMs: number | null;     // solo de quienes lo lograron
}

export interface QuestionReport {
  blockId: string; kind: QuestionKind; question: string;
  responses: number; skipped: number;
  average?: number;                                         // scale
  distribution?: Array<{ label: string; count: number }>;   // scale (1..max), choice (opciones), yesno (Sí / No)
  texts?: Array<{ sessionId: string; text: string; who?: string }>;   // text
}

export interface Insight { level: 'good' | 'warn' | 'bad'; text: string; blockId?: string; screen?: string }
export interface ReportFilter { variantId?: string; device?: 'touch' | 'desktop' }

export interface StudyReport { /* lo actual */
  score: number | null;
  excluded: number;                    // sesiones excluidas
  pendingReview: number;               // resultados manuales por revisar
  filter?: ReportFilter;
  insights: Insight[];                 // "qué arreglar", generado por reglas (sin IA)
  questions: QuestionReport[];
  order: Array<{ blockId: string; kind: BlockKind }>;   // orden del estudio, para pintar
}

export function computeStudyReport(study: StudyRecord, sessions: ReportSession[], filter?: ReportFilter): StudyReport;
export function computeAnswers(study: Study, events: TaptanaEvent[]): AnswerResult[];
export function studyCsv(study: StudyRecord, sessions: ReportSession[]): string;   // una fila por participante
```

Definiciones (el reporte las muestra en "Cómo se calcula"):

- **Participantes**: sesiones del estudio que aceptaron grabar y no están excluidas. Cada tarea
  cuenta solo a quienes la empezaron.
- **Tiempo de una tarea**: desde "Empezar tarea" hasta que se cumple la regla (`goal`), o hasta
  "Listo"/"No pude" si no se cumplió. Leer la instrucción no cuenta. Si la tarea se reinicia
  (recarga), vale el **último** inicio. El tiempo mediano es solo de quienes lo lograron.
- **Éxito**: se cumplió la regla o el moderador lo marcó. **Directo**: siguió exacto el camino
  esperado. Sin camino esperado (ni deducible), todo éxito es directo. Si se cumplió la regla
  y luego tocó "No pude", sigue siendo éxito (queda anotado en `reported`).
- **Tareas manuales**: tocar "Listo" las deja **por revisar** (`review`); no cuentan en la tasa
  de éxito ni en el puntaje hasta que el moderador las marque.
- **Primer clic**: termina en el primer toque; acierto si ese toque cumple `tapped`, o si lleva
  a la pantalla `reached` en los 2 s siguientes. Tocar en otro lado es "No pudo".
- **Misclick**: ver 1.2. Las sesiones antiguas sin el dato no cuentan misclicks. La tasa de un
  estudio promedia solo tareas con toques.
- **Puntaje de usabilidad de una tarea** = `100·directo + 50·indirecto − 50·tasaMisclick − penalizaciónTiempo`
  (tasas de 0 a 1 sobre los intentos ya decididos; `penalizaciónTiempo = clamp((segundosMedianosPorPantalla − 5) / 2, 0, 10)`),
  recortado a 0–100 y redondeado. Primer clic: `100·acierto`. **Del estudio**: promedio de las
  tareas con datos decididos. `null` si no hay.
- **Resumen** (`insights`, de 2 a 6 frases en español, ordenadas por gravedad): tarea con menor
  éxito, paso del embudo con mayor caída, pantalla con más misclicks y su elemento más tocado
  sin efecto, tarea más lenta, resultados por revisar, pregunta de escala con peor promedio, y
  lo que salió bien.
- **Mapas de calor**: `sample` sale del tamaño de pantalla más común; el panel dibuja los toques
  de pantallas de ancho parecido (±20 %) y dice cuántos quedaron fuera.

### 1.5 Vista previa (`preview.ts`)

El panel abre el prototipo en un `<iframe name="…">`. El nombre de la ventana sobrevive a la
navegación dentro del iframe; así el recorder sabe su modo en cada página.

```ts
export const PREVIEW_WINDOW = 'taptana-preview';  // solo mostrar: sin grabar, sin interfaz (también ?taptana-preview)
export const DEMO_WINDOW = 'taptana-demo';        // el panel observa: no graba, avisa pantallas y toques
export const TRYOUT_WINDOW = 'taptana-tryout';    // prueba del estudio completo sin grabar (también ?tryout=1)

export type RecorderMessage =                     // recorder → panel (window.parent.postMessage)
  | { source: 'taptana'; type: 'ready'; screen: string; title: string }
  | { source: 'taptana'; type: 'screen'; screen: string; title: string; via: NavigationEvent['via'] }
  | { source: 'taptana'; type: 'tap'; screen: string; x: number; y: number; target: TargetInfo; selector: string }  // selector: el más corto y estable (#id, .clase, o la ruta)
  | { source: 'taptana'; type: 'need-study' }
  | { source: 'taptana'; type: 'tryout'; event: 'block' | 'finish'; blockId?: string };
export type PanelMessage =                        // panel → recorder (iframe.contentWindow.postMessage)
  | { source: 'taptana-panel'; type: 'study'; study: StudyRecord; startAt?: string };  // startAt: id de bloque
```

### 1.6 API (`api.ts`)

```ts
export const PANEL_PATH = '/panel';               // antes '/sessions'
export const LEGACY_PANEL_PATH = '/sessions';
export interface SessionPatch { manual?: ManualResults; label?: string; notes?: string; excluded?: boolean }
export interface ScreenInfo { id: string; label: string; title?: string; source: 'file' | 'seen' }
export interface PrototypeScreensResponse { screens: ScreenInfo[] }
export interface Prototype { /* lo actual */ root?: boolean; absoluteUrls?: boolean }  // root: servido también en "/"
export interface ServerInfo { /* lo actual */ panelKeyUrl?: string; exampleLoaded?: boolean; mode?: 'local' | 'demo' }
export interface ExampleResponse { prototypeId: string; studyId: string }
```

Rutas nuevas o cambiadas (bajo `/api/v1`):

| Ruta | Qué hace |
|---|---|
| `PATCH /sessions/:id` | acepta `label`, `notes`, `excluded` además de `manual` |
| `POST /sessions/import` | 409 si la sesión ya existe, salvo `?replace=1` |
| `GET /studies/:id/report?variant=&device=` | reporte con filtro; deja fuera las excluidas |
| `GET /studies/:id/export.csv` | `studyCsv` como descarga |
| `POST /studies/:id/duplicate` | copia el estudio ("Copia de …") con ids de bloque nuevos |
| `GET /prototypes/:id/screens` | pantallas conocidas: archivos HTML + ScreenIds vistos en sesiones |
| `PATCH /prototypes/:id` | acepta `root: boolean` además de `name` |
| `POST /example` | carga el ejemplo (prototipo + estudio + sesiones); idempotente |
| `GET /studies/:id` | pública; incluye `closed` |

`GET /prototypes/:id/pages` queda como alias.

## 2. Servidor (`packages/server`)

- **Store**: columnas nuevas en `sessions`: `label`, `participant`, `notes`, `excluded`; en
  `prototypes`: `root`. Tabla `batches (session_id, page_id, seq, PRIMARY KEY (…))`: un lote
  repetido se ignora (`{ ok: true, received: 0 }`). Las claves de `pages` dejan de chocar entre
  sesiones. Los estudios se normalizan a v2 al leer. `listSessions`/`getSession` rellenan
  `answers` y `screenCount`. **Los índices sobre columnas migradas se crean después de migrar**
  (hoy una base de v0.1 no abre).
- **Guardia del panel** (`panel-guard.ts`) para `/panel*` y toda la API salvo `POST /events`,
  `GET /studies/:id` y `GET /info` reducido:
  1. Entre sitios: si viene `Origin` y su host ≠ `Host`, o `Sec-Fetch-Site: cross-site` → 403.
     CORS `*` queda solo en las rutas públicas.
  2. Acceso: pasa si la conexión es local (127.0.0.1, ::1), si trae la llave (`?key=` → cookie
     `taptana_key` HttpOnly, redirige sin el parámetro) o si el modo es abierto (`--open-panel`,
     `TAPTANA_PANEL=open`). Si no, 401 con una página amable ("El panel solo se abre desde la
     computadora donde corre Taptana. Si eres participante, abre el link del estudio que te
     compartieron."). La llave vive en `<dataDir>/panel.key`; la terminal imprime
     "Panel desde otro dispositivo: http://<ip>:<puerto>/panel?key=…".
  Sin socket (pruebas con `app.request`) cuenta como local; la dirección es inyectable.
- **Archivos**: nunca servir segmentos que empiecen con `.` ni enlaces simbólicos que salgan de
  la carpeta (`realpath`). Subidas: revisar tamaños declarados **antes** de descomprimir (bomba
  zip), rechazar enlaces y rutas absolutas, tolerar archivo y carpeta con el mismo nombre.
- **Prototipos subidos**: en `/p/:id/*`, una ruta sin extensión que no existe y pide HTML
  devuelve la página de entrada (apps de una sola página). En el comodín `/*`, si no hay archivo
  y el `Referer` es de `/p/<id>/…`, redirige (307) a `/p/<id><ruta>` (rutas absolutas como
  `/css/app.css`). **Abrir en la raíz**: un prototipo con `root: true` se sirve también en `/`
  (uno a la vez; para apps con rutas absolutas o router de History). Al subir, detecta rutas
  absolutas en el HTML de entrada (`absoluteUrls`) para que el panel lo sugiera. En modo
  carpeta, la misma regla de app de una sola página con `index.html`.
- **Ejemplo**: `scripts/copy-assets.mjs` copia `examples/tienda` a `packages/server/example/tienda`.
  `POST /example` crea el prototipo `pr_ejemplo` ("Tienda de ejemplo"), el estudio
  `st_demo_compra` apuntando a él y las sesiones de `seed/` reescritas a ese prototipo.
- **Errores**: datos inválidos → 400 con mensaje (nunca 500); límites de cuerpo en toda ruta
  que recibe datos (eventos: 16 MB); JSON roto → 400.
- **CLI**: `taptana start [carpeta]` = `dev` + abre el navegador en el panel (`--no-open`).
  Puerto ocupado: prueba los siguientes y lo dice, sin volcar la pila. Node < 22.5: mensaje claro.
  Avisa si la carpeta trae `.env` o `.git` (no se sirven).
- **Rendimiento**: `listSessions` y el reporte no leen eventos de rrweb; caché simple de
  resultados por sesión, invalidada al cambiar la sesión o el estudio.
- La raíz `/` sin carpeta ni prototipo en raíz muestra una página amable (participante perdido:
  "Abre el link que te compartieron"; con enlace al panel solo si la conexión es local).

## 3. Recorder (`packages/recorder`)

### 3.1 Pantallas (`screens.ts`)

`ScreenTracker` emite `navigation` cuando cambia el `ScreenId` actual:

1. URL: al cargar (`via: 'load'`); `history.pushState/replaceState` envueltos + `popstate`
   (`'history'`); `hashchange` con hash de ruta (`'hash'`).
2. Misma URL (`'screen'`), revisado con un `MutationObserver` (hijos, `class`, `style`,
   `hidden`) con espera de 150 ms y después de cada toque. En orden:
   a. marcador explícito: el elemento visible más grande con `data-screen` o `data-taptana-screen`;
   b. contenedores hermanos donde solo uno está visible (patrón `.screen.active` / `hidden`) y
      cubre ≥ 50 % del viewport: nombre = `id`, `data-*`, encabezado o clase;
   c. cambió el primer encabezado visible (`h1`, si no `h2`, o `[role=heading]`) junto con un
      cambio grande del contenido: nombre = el encabezado en minúsculas con guiones.
   Sin señal clara no inventa pantallas (un contador, un carrusel o escribir no crean pantallas).
3. `title` = encabezado visible o `document.title`. Quita el prefijo `data-base` como hoy.
4. Con `data-base` y rutas absolutas, `pushState('/x')` se reescribe a `<base>/x` para que la
   URL no se salga del prototipo.

### 3.2 Flujo del participante (`study.ts`, por bloques)

- **Bienvenida**: nombre del estudio, bienvenida, "N pasos", casilla de consentimiento, campo
  "¿Cómo te llamas? (opcional)" si `askName`, **Empezar**, "Prefiero no participar".
- **Consentimiento sin huecos**: hasta aceptar, nada sale del celular. Si rechaza, no se graba
  ni se envía **nada** en ninguna página de esa pestaña. Si el estudio no carga o no existe:
  "No pudimos cargar el estudio" + **Reintentar**; no graba. Estudio cerrado: "Este estudio ya
  no recibe respuestas"; no graba.
- **Tarea**: si tiene `startPath` y no está en esa pantalla, primero va ahí (por hash si es
  ruta de hash; recargando si es otra URL). Luego hoja "Paso i de N" con la instrucción y
  **Empezar tarea** (primer clic: "Solo cuenta tu primer toque"). Al tocar emite `start` y la
  hoja se vuelve una **píldora** pequeña arriba al centro ("Tarea · ver"), que no tapa el
  encabezado ni las barras inferiores del prototipo y se puede arrastrar. Al tocarla se abre la
  instrucción con **Listo, terminé**, **No pude** y **Seguir**. No se abre sola en cada página.
- **Regla cumplida**: con cada navegación, toque y cambio del DOM evalúa `reached` / `tapped` /
  `visible`; al cumplirse emite `goal`. Con `advance: 'auto'` muestra "✓ ¡Listo!" 900 ms, emite
  `done` (`auto: true`) y pasa al siguiente bloque. Con `'manual'` espera "Listo".
- **Preguntas**: hoja inferior con la pregunta y su control (escala de botones con etiquetas en
  los extremos; opciones con radio o casillas; Sí / No grandes; área de texto). **Continuar**
  (deshabilitado si es obligatoria y está vacía) y "Saltar" si no lo es. Emite `answer`.
- **Contexto**: hoja con título, texto y **Continuar**.
- **Fin**: "¡Gracias!" con `thanks`; emite `study finish`, envía lo pendiente y **deja de
  grabar** (también en las siguientes páginas de esa pestaña).
- **Reentradas**: recargar o navegar continúa. Abrir de nuevo el link del estudio cuando ya
  terminó o rechazó empieza una **sesión nueva** con bienvenida. Otra pestaña es otra sesión.
- Los botones no disparan dos veces (doble toque). Tras un toque que cierra un bloque, lo
  siguiente se dibuja ~350 ms después para que el clic llegue al prototipo.
- Hojas con desplazamiento interno y pie fijo: a 320 × 568 y en horizontal siempre se ven la
  casilla y el botón principal. Teclado, `safe-area`, `prefers-reduced-motion`. Todo en un
  shadow root con `rr-block`.

### 3.3 Modos

`window.name` o query: `PREVIEW_WINDOW` no hace nada. `DEMO_WINDOW` no graba; sigue pantallas y
toques y los manda al panel (`RecorderMessage`). `TRYOUT_WINDOW` corre el estudio completo sin
grabar ni enviar: pide el estudio al panel (`need-study`, espera 600 ms) y si no hay respuesta lo
baja de la API; muestra la cinta "Vista previa · no se graba".

### 3.4 Privacidad y datos

- **Texto escrito que el prototipo repite**: el recorder recuerda en memoria lo que se escribe
  en campos (≥ 3 caracteres) y enmascara esas cadenas en todo texto que grabe: nodos de texto de
  rrweb (`maskTextSelector: '*'` + `maskTextFn` que solo tapa las coincidencias), `target.text`
  y títulos de pantalla. `contenteditable` se enmascara siempre.
- `maskUrl` en rutas, referrer y Meta de rrweb (ver 1.2).
- `target.text` de un campo = su etiqueta, nunca su valor.
- `interactive` con ventana de efecto de 350 ms (ver 1.2): el toque se emite al cerrar la
  ventana, o de inmediato si la página se va.
- Toque = dedo que casi no se mueve (≤ 10 px) hasta 800 ms; el clic posterior se descarta solo
  si coincide en lugar y tiempo con ese toque. `tap.fixed` + `vh`.
- **Cola**: parte los lotes por tamaño (≤ 500 kB) y avanza `seq` por cada trozo; un evento más
  grande viaja solo y, si el servidor lo rechaza (413/400), se descarta ese evento y sigue;
  reintenta con espera creciente y tiempo límite por petición (15 s); no reenvía por beacon lo
  que ya entregó; mientras espera el consentimiento conserva Meta y la foto completa (o pide
  una nueva con `takeFullSnapshot` al aceptar).

## 4. Panel (`packages/web`)

Todo dato pasa por `api/client.ts`; cada método existe en `http.ts` y en `static.ts`.

- **Rutas** (bajo la base: `/panel` en local, `/taptana/` en la demo): `''` Inicio,
  `prototypes`, `studies`, `studies/new`, `studies/:id`, `studies/:id/report`, `recordings`
  (sesiones), `recordings/:id` (reproductor, acepta `?t=<ms>`). Lo viejo redirige. El
  reproductor y el reporte se cargan aparte (`React.lazy`).
- **Inicio** (`pages/Home.tsx`): "Prueba tu prototipo con personas reales"; 4 pasos con su
  estado y su botón (Subir prototipo → Crear estudio → Compartir link → Ver resultados);
  **Ver un ejemplo** (lo carga y lleva a su reporte). En la demo explica qué es y sus límites.
- **Constructor** (`pages/StudyEditor.tsx` + `components/builder/*`), a tres columnas como Maze:
  izquierda, bloques (Bienvenida, bloques, Gracias) con **+ Agregar bloque** (menú por tipo con
  una línea de explicación), reordenar, duplicar y borrar; centro, editor del bloque; derecha,
  **teléfono** con el prototipo (`DEMO_WINDOW`).
  - **Grabar el camino correcto**: el diseñador hace la tarea en el teléfono; "Usar este
    camino" llena pantalla de inicio, camino esperado y regla (llegar a la última pantalla, o
    tocar el último elemento).
  - **Elegir en el prototipo**: para "Toca un elemento", el siguiente toque en el teléfono
    fija el selector; muestra "Coincide con 1 elemento". El campo de selector queda en "Avanzado".
  - Reglas en lenguaje claro: "Llega a una pantalla", "Toca un elemento", "Aparece un texto o
    elemento", "Lo decide el moderador". Sin valores por defecto engañosos (nada preseleccionado).
  - **Probar estudio** / **Probar esta tarea** (`TRYOUT_WINDOW`, con el borrador).
  - Guardado automático con indicador; aviso al salir con cambios; errores junto al campo;
    aviso si el estudio ya tiene sesiones + **Duplicar**; "Recibe respuestas"; **Compartir**
    (link, QR, "Copiar invitación"; nota de la red Wi-Fi). Sin prototipo válido no hay link ni QR.
  - Importar: archivo **o pegar el JSON**; si el prototipo no existe aquí, se elige cuál.
- **Resultados** (`pages/Report.tsx` + `components/report/*`): puntaje con "Cómo se calcula";
  **Lo más importante** (`insights`); filtros; índice de bloques fijo; una sección por bloque
  (tareas: barra de resultados con "por revisar", puntaje, tiempo, misclicks, embudo con caída
  explicada, pantallas con mapa de calor sobre la foto real `SnapshotView`, "más tocado sin
  efecto", caminos con "usar como camino esperado", participantes con salto a la grabación;
  preguntas: promedio, barras, respuestas abiertas). **Exportar CSV**, **Imprimir / PDF**.
- **Sesiones** y **reproductor**: etiqueta editable, notas, "Excluir del reporte", respuestas
  en la lista de pasos, salto a un instante, marcar resultado sin reiniciar la reproducción,
  botones con texto ("Lo logró" / "No lo logró"). En celular, tarjetas en vez de tabla.
- **Prototipos**: lo actual + pantallas detectadas + "Abrir en la raíz" + conteos correctos.
- Menú lateral: Inicio, Prototipos, Estudios, Sesiones (en celular no se corta).
- Términos: "Primer clic", "Misclicks (toques sin efecto)". Plurales correctos. Sin
  `window.confirm`. Mensajes de error siempre en español y útiles.

## 5. Plataforma y documentación

- `pnpm start`: compila si hace falta, arranca y abre el navegador. `Dockerfile` +
  `docker-compose.yml` (volumen `/data`).
- `scripts/record-seed.mjs`: regenera las sesiones de ejemplo con Playwright (con preguntas).
- `tests/e2e/*.test.mjs` (`node --test` + Playwright) y `pnpm e2e`, también en CI.
- README con capturas, `docs/guia.md` (para diseñadores), `docs/prototipos.md` (qué HTML
  funciona), `skills/taptana-study` y el prompt para IA en formato de bloques, `CLAUDE.md` al día.
- Demo de Pages: entra por Inicio, con el estudio de ejemplo y su reporte.

## 6. Fuera de alcance por ahora

Cuentas y equipos, servidor hospedado público, HTTPS propio, reclutamiento de participantes,
card sorting y tree testing, test de 5 segundos, clips de video, comparar versiones de un
prototipo, MCP, detección de participantes repetidos.

## 7. Hallazgos de las pruebas, por responsable

Verificados por los probadores. Lo que ya está cubierto arriba se repite aquí como lista de
control. Cada responsable resuelve los suyos.

### shared

- Tareas manuales sin revisar cuentan como 0 % de éxito y hunden el promedio → `review`.
- El tiempo mediano mezcla éxitos con fallos y abandonos → solo éxitos.
- La tasa de misclick promedio cuenta como 0 las tareas sin toques.
- Primer clic con regla `reached` nunca acierta (la navegación cae después del toque).
- `tapped` con solo una etiqueta (`a`) acredita cualquier elemento de esa etiqueta: se permite,
  pero `validateStudy` lo marca como aviso (`issues` con `level: 'warn'`).
- Reiniciar una tarea conserva el primer inicio y suma el tiempo de recarga.
- "Participantes" incluye sesiones que no empezaron ninguna tarea: definir por consentimiento y
  contar cada tarea por quienes la empezaron.
- La comparación A/B mezcla tipos de tarea: comparar por tarea.
- Mensajes de validación en inglés ("name is required").
- `pageCount` se infla con navegaciones repetidas → `screenCount`.
- Texto de un formulario GET queda en la URL grabada → `maskUrl`.

### server

- API sin autenticación y con CORS `*` en rutas destructivas → guardia del panel.
- Modo carpeta sirve `.env`, `.git` y enlaces simbólicos que salen de la carpeta.
- Una base de v0.1 no abre (`no such column: study_id`): índices antes de migrar. Prueba con una
  base antigua.
- Lotes reintentados duplican eventos → tabla `batches`.
- Un lote inválido da 500 y se pierde → validar y responder 400.
- Importar una sesión reemplaza en silencio la existente y acepta prototipos inventados → 409
  salvo `replace=1`; un prototipo desconocido se crea visible como "Importado".
- Bomba zip: descomprime todo antes de revisar el tamaño.
- Límites de tamaño que se pueden saltar; zip con archivo y carpeta del mismo nombre da 500.
- El CLI vuelca la pila cuando el puerto está ocupado.
- La lista y el reporte cargan eventos de rrweb de todos (N+1).
- Rutas absolutas (`/css/app.css`, `/checkout/`) se salen de `/p/<id>/`; `pushState` absoluto
  rompe al recargar → redirección por `Referer`, respaldo de app de una página, "Abrir en la raíz".
- `/?study=<id>` sin prototipo en la raíz manda al participante al panel → página amable, o
  redirigir al prototipo del estudio.
- Prototipos subidos comparten origen con el panel: riesgo aceptado en local, documentado.

### recorder

- Quien rechaza igual queda grabado (eventos de navegación en una sesión libre).
- Si el estudio no carga o el id no existe, graba sin pantalla de consentimiento.
- Sigue grabando después de "¡Gracias!".
- Texto escrito se filtra por `contenteditable` y por elementos que lo repiten ("Hola Ana").
- Doble toque en "Listo" o "No pude" salta una tarea.
- Eventos duplicados cuando `startPath` redirige justo después del consentimiento.
- Volver a abrir el link de un estudio terminado en la misma pestaña se mezcla con la sesión vieja.
- Toques sostenidos más de 300 ms se pierden (ni toque ni clic).
- La cola en espera de consentimiento descarta Meta y la foto completa al pasar de 5000 eventos.
- Un lote de más de 5 MB se rechaza y la sesión entera se pierde (imágenes grandes en línea).
- El transporte HTTP no tiene tiempo límite.
- Las apps de una sola página no generan eventos de navegación; `reached` no se cumple.
- Toques en `div` con `addEventListener` cuentan como misclick aunque sean el objetivo.
- `startPath` no puede apuntar a una pantalla por hash; al empezar una tarea recarga y pierde
  el estado aunque ya esté en la pantalla.
- La barra de tarea tapa el encabezado y el carrito, se reabre en cada página y a 320 px la
  instrucción larga o la bienvenida dejan el botón fuera de la pantalla.
- No hay señal de que la meta se cumplió; "Listo" queda escondido con la barra cerrada.
- El scroll solo se mide en la ventana, no en contenedores internos (apps con `overflow`).
- "Tocó input" sin contexto → etiqueta del campo.
- Puede perderse el último lote de navegación si el navegador se cierra enseguida.

### web-core

- Al entrar se ve una tabla de sesiones sin explicación → Inicio.
- El estado vacío manda a un QR de terminal que no aplica al subir prototipos.
- Marcar un resultado en el reproductor reinicia la reproducción a 00:00.
- Botones de solo ícono (pulgares, borrar, descargar) sin texto ni ayuda.
- A 390 px: menú cortado sin pista de scroll, tabla de sesiones apretada, desbordes.
- Un solo archivo JS de 646 kB en cada página → cargar reproductor y reporte aparte.
- Modo demo: conexiones de IndexedDB abiertas en cada llamada y nunca cerradas.
- Modo demo: subir falla con un error crudo en inglés si no hay service worker o IndexedDB →
  detectar antes y explicar en español.
- Modo demo: Prototipos dice "0 sesiones" para el ejemplo que tiene participantes.
- Sesiones importadas muestran la ruta base en las etiquetas de eventos.
- El archivo exportado tiene un nombre opaco → nombre con etiqueta y fecha.
- El service worker no atiende peticiones `Range` (video/audio) y lee archivos enteros.
- Sin límite de errores de la interfaz: un fallo deja la pantalla en blanco → `ErrorBoundary`.
- Términos en inglés mezclados ("first click", "misclicks" sin explicar), "1 tareas".

### web-builder

- El `study.json` de ejemplo se importa con prototipo "no disponible" y un QR que lleva al panel.
- Error en inglés lejos del campo; botón "Crear estudio" deshabilitado sin explicación.
- Cambiar la regla a "Llega a la página" elige en silencio la primera página.
- "Toca el elemento" exige escribir un selector CSS.
- El flujo de "Copiar prompt para IA" termina en un selector de archivo: falta pegar el JSON.
- Los cambios sin guardar se pierden al navegar dentro del panel.
- Editar un estudio reutiliza ids de tareas borradas y acredita resultados viejos a la nueva.
- El camino esperado que omite una pantalla que todos visitan deja "Directo 0 %" sin aviso →
  avisar y ofrecer "Usar el camino más común".
- En primer clic, la pantalla de inicio por defecto puede no tener el objetivo.
- Etiquetas con jerga (tipos de tarea y reglas) sin explicación.
- El editor se desborda a 390 px y cuesta recorrerlo con muchas tareas.
- La tarjeta del estudio tiene etiquetas ambiguas y botones de solo ícono.
- Solo se pueden elegir archivos HTML como pantallas: una app de una página no se puede describir.

### web-report

- El "Éxito promedio" no se explica y se lee mal.
- El mapa de calor dibuja el estado inicial de la pantalla, y todos los toques de una app de una
  página caen sobre la pantalla de inicio.
- Se mezclan tamaños de pantalla en un mismo mapa, escalando solo en X.
- Sin filtros, sin exportación, sin puntaje, sin resumen de qué arreglar.
- El reporte es un scroll largo; la lista de sesiones queda al fondo → índice de bloques.
- El embudo muestra un "−1" sin leyenda.
- El primer toque de una tarea no es el toque que cumple la regla: mostrar ambos con claridad.
- Desborde horizontal y barra superior cortada a 390 px.

### platform

- El README dice "v0.1" y lista como faltante lo que la demo ya tiene.
- `examples/tienda/study.json` trae `prototypeId: "local"` y no sirve al subir un zip.
- Faltan pruebas de los fallos más importantes (consentimiento, duplicados, base antigua,
  fugas de texto, guardia del panel).
- En Pages los enlaces profundos responden 404 (se ve bien, pero queda en consola): documentado.
- La demo debería ofrecer "Probar como participante" el estudio de ejemplo.
