# Qué prototipos funcionan con Taptana

Respuesta corta: casi cualquier prototipo HTML que funcione al abrirlo en un navegador, sin
necesitar un servidor propio. No hay que agregarle nada: Taptana le inserta su grabador al
servirlo.

## Lo que funciona

| Tipo de prototipo | ¿Funciona? | Notas |
|---|---|---|
| Varias páginas HTML enlazadas (`index.html`, `producto.html`…) | Sí | El caso más simple. Cada página es una pantalla. |
| Un solo archivo `.html` con todo adentro | Sí | Súbelo tal cual, sin comprimir. |
| App de una sola página con rutas por hash (`#/carrito`) | Sí | Cada ruta es una pantalla: `/index.html#/carrito`. |
| App de una sola página con History API (`/carrito` sin recargar) | Sí | Si usa direcciones que empiezan con `/`, activa **Abrir en la raíz**. |
| Un archivo que muestra y oculta secciones (misma dirección siempre) | Sí | Taptana detecta las pantallas; con `data-screen` no falla. |
| Exportado de un proyecto React, Vue o Svelte (`dist/` o `build/`) | Sí | Comprime **el contenido** de esa carpeta, con su `index.html`. |
| Proyecto sin compilar (`src/`, `package.json`, archivos `.jsx`) | No | Primero hay que compilarlo (`npm run build`) y subir el resultado. |
| Prototipo que necesita su propio servidor o base de datos | No | Taptana solo sirve archivos. Simula los datos dentro del prototipo. |

## Cómo subirlo

- **Un `.html`** o **un `.zip`** de hasta 50 MB (200 MB descomprimido, 2000 archivos).
- En el zip tiene que haber un `index.html` (o un único `.html`). Puede estar dentro de una
  carpeta: Taptana lo encuentra.
- Imágenes, fuentes, CSS y JavaScript van dentro del zip. Lo que el prototipo baje de internet
  (fuentes de Google, imágenes de un CDN) solo se verá si el celular del participante tiene
  internet.
- Mientras editas, también puedes servir una carpeta directamente: `pnpm start ./mi-prototipo`.

## Agregar por URL

Si tu prototipo ya vive en una dirección (lo publicaste con Lovable, v0, Bolt, Vercel, Netlify o
Figma Sites, o lo tienes corriendo en tu laptop con `npm run dev`), no hace falta exportarlo:
en **Prototipos → Agregar por URL** pegas la dirección, tocas **Revisar** y, si está bien,
**Agregar**.

Taptana no copia tu sitio ni lo modifica. Cada vez que un participante abre el link
(`/p/<id>/`), Taptana pide esa página a tu sitio en ese momento, le agrega la grabación y se la
entrega al celular. Para el participante y para el reporte es igual que un prototipo subido:
misma Wi-Fi, mismas grabaciones, toques, pantallas, mapas de calor y embudos.

**Qué revisa antes de agregarlo:** que responda, que sea una página web, que no pida iniciar
sesión y que no te mande a otro sitio (si redirige, te ofrece la dirección final). También te
avisa si la página se arma con JavaScript (está bien, solo es informativo), si parece una app
con rutas propias (conviene «Abrir en la raíz») o si usa cookies que solo funcionan con https.
El título de la página se sugiere como nombre.

**Lo que conviene saber:**

- **Muestra siempre lo publicado ahora.** Si cambias el sitio a mitad de un estudio, los
  participantes nuevos ven el cambio. Para probar otra versión, publícala en otra dirección y
  agrégala como otro prototipo. La dirección se puede cambiar después (menú ⋯ → «Cambiar
  dirección») sin perder el link, los estudios ni las sesiones.
- **Tiene que estar encendido** durante la prueba. Si no responde, el participante ve una página
  amable que dice que no se pudo abrir.
- **Servidor de desarrollo en tu laptop** (`http://localhost:5173`, `:3000`…): funciona, y los
  celulares no necesitan llegar a él (llegan a Taptana, que sí llega). La recarga en caliente
  no pasa por Taptana: si cambias el código, recarga la página. Ojo: cualquiera en la Wi-Fi con
  el link puede pedir, a través de Taptana, cualquier dirección de ese servidor (como si lo
  corrieras con `--host`).
- **Apps con rutas propias** (React Router, Vue Router, Next.js): si al navegar vuelven siempre
  al inicio o dicen «página no encontrada», activa **Abrir en la raíz** (ver abajo). Dentro de
  `/p/<id>/` funcionan mejor los sitios de varias páginas.

**Lo que no funciona:**

- **Sitios con inicio de sesión** (la página pide cuenta, o el sitio está protegido con
  contraseña o con «Vercel Authentication»). Publícalo como público.
- **Sitios que solo funcionan en su propio dominio**: inicio de sesión con Google u otro
  proveedor (OAuth), APIs de otro dominio que solo aceptan peticiones desde el dominio original
  (CORS estricto), pagos reales.
- **WebSockets** (chat en vivo, datos en tiempo real, recarga en caliente).
- **Service workers** del sitio: Taptana no deja que se instalen, para que ninguna página quede
  sin grabación. Un sitio que dependa de su service worker para funcionar sin conexión no lo
  hará.
- **Cookies `Secure`, `__Host-` o `__Secure-`**: Taptana va por http en tu red, así que el
  navegador no las guarda. Las cookies simples (un carrito, una preferencia) sí funcionan.
- Una ruta del sitio que empiece con `/api/v1/` o `/__taptana/` es de Taptana y no llega al sitio.

## Direcciones que empiezan con `/`

Un prototipo subido vive en una dirección como `/p/pr_abc123/`. Si tu HTML pide
`/css/app.css` o enlaza a `/checkout` (con la barra al inicio), esas direcciones apuntan fuera
de esa carpeta.

Taptana lo resuelve de dos formas:

1. **Solo**: cuando una página del prototipo pide un archivo con `/…`, lo redirige a su
   carpeta. Basta para estilos, imágenes y scripts.
2. **Abrir en la raíz** (en Prototipos): sirve ese prototipo también en `/`, como si fuera el
   único. Es lo indicado para apps con router de History o muchos enlaces absolutos. Solo un
   prototipo a la vez puede estar en la raíz. El panel te lo sugiere al subir si detecta
   direcciones así.

Si puedes elegir, lo más portable son direcciones relativas: `css/app.css`, `./carrito.html`.
A una IA se lo puedes pedir así: "usa rutas relativas, sin barra inicial".

## Pantallas en una sola página

Las reglas de las tareas ("llega a la pantalla de confirmación"), el embudo y los mapas de
calor necesitan saber en qué pantalla está la persona. Taptana lo deduce así, en este orden:

1. **La dirección**: otra página, otra ruta (`pushState`) u otro hash que empiece con `#/`.
2. **Un marcador explícito**: el elemento visible más grande con `data-screen`.
3. **Secciones hermanas donde solo una está visible** (el patrón `.screen.active` o `hidden`)
   y ocupa al menos media pantalla: toma el nombre de su `id`.
4. **Cambió el encabezado principal** junto con buena parte del contenido.

Un contador, un carrusel, un menú que se abre o escribir en un campo **no** crean pantallas.

Para no depender de la deducción, marca cada pantalla:

```html
<section data-screen="inicio">…</section>
<section data-screen="carrito" hidden>…</section>
<section data-screen="confirmacion" hidden>…</section>
```

En el panel esas pantallas aparecen como `/index.html~inicio`, `/index.html~carrito`,
`/index.html~confirmacion`. Si tu prototipo ya usa `data-screen` para otra cosa, usa
`data-taptana-screen`.

A una IA se lo puedes pedir así: "pon `data-screen="nombre"` en el contenedor de cada pantalla".

**Para comprobarlo**: en Prototipos mira las pantallas detectadas, o abre el constructor,
navega en el teléfono de la derecha y fíjate en "Pantalla:" arriba del teléfono.

## Formularios y privacidad

- Todo lo que el participante escribe en campos del prototipo se tapa **en su celular**, antes
  de enviarse. No hay forma de desactivarlo.
- También se tapa si el prototipo repite lo escrito ("Hola, Ana") o lo pone en la dirección
  (`/buscar?q=…` se guarda como `/buscar?q=*`).
- En la lista de pasos de una sesión, un campo aparece con su etiqueta ("Tocó «Nombre
  completo»"), nunca con su contenido. Por eso conviene que los campos tengan `<label>`.

## Límites conocidos

- **Mismo origen que el panel.** Un prototipo subido se sirve desde la misma dirección que el
  panel. En tu computadora no es problema (son tus archivos), pero no subas prototipos de
  gente en la que no confías.
- **Contenido dentro de `<iframe>` de otro sitio, `<canvas>` y video** se graba de forma
  limitada: en la reproducción pueden verse vacíos. Los toques sí se registran.
- **Mapas de calor en pantallas que cambian mucho** (carrito lleno o vacío): el fondo es lo
  que vio un participante; los toques de otros pueden caer sobre algo un poco distinto.
- **Pantallas muy parecidas sin marcador** (dos pasos de un formulario con el mismo título)
  pueden contarse como una sola. Usa `data-screen`.
- **Prototipos por URL**: ver «Agregar por URL» arriba (inicio de sesión, WebSockets, cookies
  `Secure`).
- **Service workers o lógica que dependa del dominio** (inicio de sesión con Google, pagos
  reales) no van a funcionar dentro de Taptana. Simúlalos.
- **Gestos**: se registran toques, deslizamientos y scroll. Pellizcar para ampliar no.
