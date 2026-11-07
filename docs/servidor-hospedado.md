# El servidor hospedado: probar Taptana en vivo sin instalar

Este documento no describe trabajo de v0.1. Describe a dónde vamos, para que las decisiones de
hoy no lo estorben. Se revisa y ajusta en cada versión.

## La meta

Como Penpot: entras a `taptana.app` (o el dominio que sea), subes tu prototipo, obtienes un link
y un QR, se lo mandas a alguien, y ves la grabación. Sin cuenta, sin instalar, en dos minutos.
Es una demo funcional, no un producto con planes. Las cuentas y el pago llegan en v0.5.

## Cómo se ve para quien lo usa

1. Entra a la página principal. Un botón: "Subir prototipo" (zip o carpeta arrastrada).
2. Recibe dos links:
   - **Link del participante**: `https://p.taptana.app/pr_9xKq2mN/` con QR. Se comparte.
   - **Link del diseñador**: `https://taptana.app/p/pr_9xKq2mN?key=AbC123...`. Es secreto.
     Con él se ven las sesiones. Sin cuenta: el link *es* la llave.
3. Las sesiones y el prototipo se borran solos a los 7 días.

El patrón "link secreto como llave" es el que usan Excalidraw y el modo demo de Penpot. Da el 80%
del valor sin construir login. Y cuando lleguen las cuentas, el link secreto se convierte en
"compartir con un colega", que de todos modos íbamos a necesitar.

## Qué cambia respecto al modo local

| Aspecto | `taptana dev` (v0.1) | `taptana serve` (v0.2+) |
|---|---|---|
| De dónde sale el prototipo | Carpeta en la laptop | Zip subido, guardado en `TAPTANA_DATA_DIR/prototypes/<id>/` |
| Cuántos prototipos | Uno (`local`) | Muchos, cada uno con su id |
| Quién ve las sesiones | Cualquiera en la red Wi-Fi | Quien tenga el link secreto |
| HTTPS | No | Sí, lo pone un proxy adelante (Caddy, nginx, el del hosting) |
| QR | En la terminal | En la web, como SVG |
| Limpieza | Manual | Automática por antigüedad |

Es el mismo binario. `serve` solo agrega: subida de zips, rutas por prototipo, llaves secretas y
limpieza. Todo lo demás (recorder, eventos, Store, reproductor) es idéntico.

## Decisiones que ya afectan a v0.1

Estas son las razones concretas de los seis puntos de arquitectura en `CLAUDE.md`:

- **Tabla `prototypes`**: en hospedado hay muchos. Mejor que v0.1 ya guarde las sesiones por
  prototipo aunque haya uno solo.
- **Recorder con `data-endpoint` y `data-prototype`**: el prototipo subido se sirve desde un
  dominio distinto al del panel (ver seguridad). El recorder tiene que saber a dónde mandar.
- **CORS en `/api/v1/`**: por lo mismo.
- **`Store` como interfaz**: SQLite aguanta perfectamente una demo pública con un volumen
  persistente. Si crece, Postgres, sin reescribir rutas.
- **Configuración por entorno**: un contenedor Docker se configura así. Nada de archivos.
- **QR como función pura**: `network.ts` genera el QR como texto para la terminal hoy. La misma
  librería o una hermana debe poder darlo como SVG para la web. Elegir con eso en mente.

## Seguridad mínima del hospedado (pensar desde ya, construir en v0.2)

El riesgo principal: **servimos HTML que subió un desconocido.** Si ese HTML corre en el mismo
dominio que el panel de sesiones, un prototipo malicioso puede leer las sesiones de otros.
La solución estándar es dos orígenes:

- `taptana.app` → panel, API, subida de prototipos.
- `p.taptana.app` → solo sirve prototipos, sin cookies, sin nada que robar.

En modo `dev` local esto no importa (es tu laptop, tu prototipo). Pero el server debe poder
servir prototipos y panel desde hosts distintos con un cambio de configuración, no de código.
En v0.1 lo único que hacemos es no mezclar: las rutas de prototipo y las de panel viven en
módulos separados (`static.ts` vs `routes/sessions.ts`).

Otras cosas simples que hacen la demo viable:

- Límite de tamaño del zip (20 MB) y de archivos dentro (solo HTML, CSS, JS, imágenes, fuentes).
- Límite de lotes por sesión y de sesiones por prototipo por día. Evita que alguien llene el
  disco.
- Borrado automático a los 7 días. Es demo, no archivo.
- Aviso al participante al cargar el prototipo ("esta sesión se graba"). En v0.3 esto es el
  consentimiento real; en la demo pública hace falta desde el día uno por respeto y por ley.

## Dónde correrlo

Cualquier sitio que corra un contenedor Docker con un volumen persistente:
Azure Container Apps, Fly.io, Railway, Hetzner con Docker Compose. Uno solo, chico.
La imagen es `node:22-alpine` + el paquete `@taptana/server`. HTTPS lo pone el hosting o Caddy.
No usamos nada específico del proveedor, así que la demo pública y una instalación propia en
una empresa son exactamente la misma imagen.

### Lo que no sirve, y por qué

- **Hosting compartido (cPanel, PHP).** No puede mantener un proceso Node corriendo de forma
  continua ni correr Docker. Algunos ofrecen "Node.js app" vía Passenger, pero es frágil y no
  es lo que la gente instala en su empresa. Mínimo: un VPS o una plataforma de contenedores.
- **GitHub Pages.** Solo archivos estáticos. No recibe eventos ni guarda nada. Sí sirve para
  la página de presentación, la documentación y una demo estática del reproductor con sesiones
  grabadas de antemano.
- **Front en Pages + base en Firestore (como en Guaguas).** Funciona para apps donde el
  navegador escribe documentos chicos. Aquí no: una foto inicial del DOM de rrweb supera con
  facilidad el límite de 1 MB por documento, los lotes cada 3 segundos agotan el nivel gratuito
  en pocas sesiones, y haría que la demo fuera un producto distinto al que la gente instala.
  Además acopla a Google, que es justo lo que decidimos no hacer.

### Opción sin servidor que sí respeta la arquitectura

Cloudflare Workers + D1 (que es SQLite) + R2 (archivos). Hono corre en Workers sin cambios,
el esquema SQL es el mismo, y lo único específico de Cloudflare sería una implementación
`store/d1.ts` y un archivo de despliegue. El nivel gratuito aguanta una demo con holgura y no
hay máquina que administrar. Es la mejor opción si no queremos ni un VPS. Queda documentada
como alternativa; la decisión se toma en v0.2 cuando la imagen Docker ya exista.

## Qué no es

- No es multi-tenant con aislamiento fuerte. Para eso hay que esperar a cuentas (v0.5).
- No es para pruebas reales con datos sensibles. Para eso, instalación propia.
- No tiene plan de pago. Primero que lo use gente; después vemos qué quieren pagar.

## Orden sugerido

1. v0.1 funciona bien en local con celulares reales.
2. v0.2: `taptana serve`, subida de zip, link secreto, Docker, borrado automático.
3. Levantar la demo pública con v0.2 y un dominio. Pedir feedback.
4. v0.3 y v0.4 mejoran lo que se graba y lo que se ve.
5. v0.5 cuentas. Ahí recién hablamos de precio.
