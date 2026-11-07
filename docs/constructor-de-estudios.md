# Constructor de estudios (v0.3)

Propuesta para revisar antes de escribir código. Parte del formato `Study` que ya existe en
`shared` (ver `docs/estudios-con-ia.md`).

## Qué es un estudio, en una frase

Una lista de tareas que el participante hace sobre el prototipo, con un texto de bienvenida y
consentimiento al inicio, y con un criterio para saber si cada tarea salió bien.

## Cómo se ve para cada persona

### El diseñador (en el panel)

1. Entra a **Estudios** y crea uno: nombre, bienvenida, y tareas. Cada tarea tiene un título,
   la instrucción en palabras del participante, la página de inicio y el criterio de éxito.
2. O lo **importa** de un `study.json` hecho por una IA. Un botón **"Copiar prompt para IA"**
   arma un texto con la lista de páginas del prototipo y el formato esperado; se pega en
   Claude, ChatGPT o lo que sea, y devuelve el JSON listo para importar. Así el servidor nunca
   llama a un modelo y funciona con cualquiera.
3. Obtiene el **link del estudio** con QR. Es la misma URL del prototipo más `?study=<id>`.
4. Las sesiones de ese estudio aparecen en la lista con el resultado de cada tarea. En el
   reproductor, la línea de tiempo se divide por tarea.

### El participante (en el celular)

1. Abre el link. Ve una tarjeta con la bienvenida y una casilla: "Acepto que esta sesión se
   grabe". Hasta que acepta, no se envía nada al servidor.
2. Toca "Empezar". La tarjeta se vuelve una barra chica arriba: **"Tarea 1 de 3: Compra una
   planta grande"**. Puede expandirla para releer la instrucción.
3. Hace la tarea en el prototipo. Cuando cree que terminó, toca **"Listo"**. Si se trabó, toca
   **"No pude"**. Pasa a la siguiente.
4. Al final, "Gracias". La grabación termina.

Si el criterio de éxito es automático (llegó a tal página, tocó tal cosa), Taptana lo marca
solo, aunque el participante no haya tocado "Listo". Guardamos las dos cosas: lo que la regla
dice y lo que el participante dijo.

## Qué cambia en el código

| Pieza | Cambio |
|---|---|
| `shared` | Evento nuevo `task` con `action: 'start' \| 'done' \| 'skip' \| 'success'` y `taskId`. `Study` gana `consent` (texto de la casilla). Resultado por tarea: `TaskResult` (estado, tiempo, cómo se decidió). |
| `server` | Tabla `studies` (id, prototype_id, name, data JSON, created_at, updated_at). Columna `sessions.study_id`. Rutas `GET/POST/PUT/DELETE /api/v1/studies`, `GET /api/v1/prototypes/local/pages` (lista los HTML de la carpeta, para los desplegables del constructor), `GET /api/v1/qr.svg?text=`. Cálculo de resultados por tarea al leer una sesión. |
| `recorder` | Lee `?study=` en la primera página y lo guarda en sessionStorage. Pide el estudio a la API y muestra la tarjeta y la barra (DOM plano en shadow root, como el botón del modo local). Emite los eventos `task`. Retiene los lotes hasta el consentimiento. |
| `web` | Sección **Estudios**: lista, constructor (formulario con tareas ordenables), importar/exportar, copiar prompt, link con QR. Lista de sesiones con columna de estudio y tareas logradas. Reproductor con segmentos por tarea. |
| `skills/` | `taptana-study/SKILL.md`: instrucciones para que una IA arme el `study.json` leyendo el prototipo. |

## Criterios de éxito, en concreto

- `reached`: la sesión tiene un evento `navigation` a esa página **después** de empezar la tarea
  y antes de terminarla.
- `tapped`: hay un `tap` cuyo `selector` o `id` coincide, en ese mismo rango.
- `manual`: el moderador lo marca en el reproductor (botón "Logró" / "No logró"). Se guarda en
  la sesión.

Estado final de una tarea: `logró` (regla o moderador), `dijo que terminó` (tocó Listo pero la
regla no se cumplió), `no pudo` (tocó No pude), `sin terminar` (cerró antes). Más el tiempo que
tardó.

## Orden de construcción (cada paso se puede probar solo)

1. **Modelo y API.** Tabla, rutas, evento `task`, resultados por tarea. Con pruebas.
2. **Constructor en el panel.** Crear, editar, importar, exportar, copiar prompt, link y QR.
3. **Participante.** Tarjeta de bienvenida y consentimiento, barra de tarea, Listo / No pude,
   gracias.
4. **Resultados.** Columna en la lista, segmentos y marcas en el reproductor, marcado manual.
5. **Skill** para la IA, y actualizar el prototipo de ejemplo con un estudio de muestra en
   `packages/server/seed/`.

## Decisiones abiertas

1. **Link del estudio.** `?study=<id>` en la URL del prototipo (propuesto, simple, sobrevive a
   la navegación gracias a sessionStorage) o una ruta propia tipo `/s/<id>/`. Propongo `?study=`.
2. **Consentimiento obligatorio.** Si no hay estudio (uso libre como hasta ahora), ¿pedimos
   consentimiento igual? Propongo: solo con estudio en v0.3. En uso libre el moderador está al
   lado y lo pide de palabra. Se reconsidera para el hospedado.
3. **Pregunta después de cada tarea** ("¿Qué tan difícil fue?", 1 a 5). Es barata de agregar en
   la barra. Propongo dejarla fuera de este paso y meterla en v0.4 con las métricas, para no
   mezclar.
4. **Dónde vive el estudio en modo local y en Pages.** Sin servidor no hay API de estudios. El
   constructor en modo demo guarda en el navegador y el link del estudio no funciona. Propongo
   aceptarlo: el constructor se ve y se prueba en Pages, pero correr un estudio requiere
   servidor (local o Codespaces).
