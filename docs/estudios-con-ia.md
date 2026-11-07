# Estudios creados con IA: formato, skill y MCP

Meta: que un diseñador pueda decirle a una IA "arma un estudio de usabilidad para este
prototipo" y que el resultado se importe en Taptana sin trabajo manual. Y, más adelante,
que la IA lea las sesiones grabadas y resuma qué pasó.

## La idea en una línea

Un MCP y una skill son dos puertas a lo mismo. Las dos necesitan que exista un **archivo de
estudio** con formato conocido que Taptana importe. Primero el formato, después las puertas.

## Las tres piezas y cuándo llegan

| Pieza | Qué es | Versión |
|---|---|---|
| Formato `Study` | JSON con nombre, prototipo, tareas y criterio de éxito de cada una | Tipos en `shared` desde v0.1 |
| Importación | `POST /api/v1/studies` y botón "Importar estudio" en el panel | v0.3 (con tareas) |
| Skill | Archivo markdown con instrucciones y el esquema. Cualquier IA lo lee | v0.3 |
| MCP | Paquete `packages/mcp`: expone la API de Taptana como herramientas | v0.3 o v0.4 |

### Por qué la skill primero

Es texto. Se le dice a Claude Code, Cursor o cualquier asistente "usa la skill de Taptana para
armar un estudio de este prototipo". La IA lee los HTML, entiende qué páginas y botones hay, y
escribe el `study.json` con tareas realistas y criterios de éxito verificables. Se importa y
listo. Sin código extra y sin depender de un modelo específico.

### Qué suma el MCP

- La IA crea el estudio directo en Taptana, sin pasar por un archivo.
- **Lee las sesiones grabadas.** "Resume las cinco pruebas de hoy", "dónde se trabaron en la
  tarea 2". Esta dirección es la más valiosa a mediano plazo.
- Es delgado: solo envuelve la API HTTP que el servidor ya expone. Herramientas iniciales:
  `list_prototypes`, `create_study`, `list_sessions`, `get_session_summary`.
- MCP es un estándar abierto. No nos ata a ningún proveedor, coherente con el resto del proyecto.

## Formato propuesto

```ts
interface Study {
  v: 1;
  name: string;                 // "Compra en la tienda móvil"
  description?: string;
  prototypeId: string;          // a qué prototipo pertenece
  welcome?: string;             // texto que ve el participante al empezar
  tasks: Task[];
}

interface Task {
  id: string;                   // "t1"
  title: string;                // "Comprar el producto rojo"
  instruction: string;          // lo que lee el participante, en sus palabras
  startPath?: string;           // "/index.html"; si falta, donde esté
  success: SuccessRule;         // cómo Taptana sabe que terminó bien
}

type SuccessRule =
  | { type: 'reached'; path: string }                 // llegó a esta página
  | { type: 'tapped'; selector: string }               // tocó este elemento
  | { type: 'manual' };                                // lo marca el moderador
```

Reglas de diseño del formato:

- **Los criterios de éxito solo usan cosas que ya grabamos.** `reached` se verifica con los
  eventos `navigation`; `tapped` con los `tap` y su `selector`. Nada nuevo que grabar.
- **`manual` existe desde el principio.** Muchas tareas no se pueden verificar sola la
  máquina ("encuentra el precio de envío"). El moderador marca éxito o fracaso.
- **Un estudio apunta a un prototipo.** Por eso `prototypeId` existe desde v0.1.
- **Versionado con `v`,** como los lotes de eventos. Las skills viejas siguen funcionando.

## Qué hace la skill

1. Lee los HTML del prototipo (páginas, enlaces, botones, formularios).
2. Propone entre 3 y 5 tareas que recorran los flujos principales, en lenguaje de participante
   (sin nombres de botones ni jerga de la interfaz).
3. Elige el criterio de éxito más verificable posible para cada una.
4. Escribe `study.json` siguiendo el esquema y lo valida.
5. Dice cómo importarlo: `taptana import study.json` o el botón del panel.

La skill vive en el repo (`skills/taptana-study/SKILL.md`) para que cualquiera la copie a su
herramienta. Formato de skill: markdown con frontmatter, compatible con Claude Code y adaptable
a otros asistentes.

## Lo que no hacemos

- No metemos una IA dentro de Taptana. El servidor no llama a ningún modelo. La IA la pone el
  usuario con su herramienta y su cuenta. Mantiene el servidor simple y sin llaves que cuidar.
- No generamos el prototipo. Eso ya lo hace la herramienta de vibe coding del diseñador.

## Decisiones abiertas

1. ¿El estudio se importa por CLI, por panel, o ambos? Propongo ambos: CLI para la IA, panel
   para la persona.
2. ¿Preguntas post-tarea (escala de dificultad, comentario)? Son útiles y simples. Propongo
   dejarlas fuera del formato v1 y agregarlas en v0.4 con las métricas.
