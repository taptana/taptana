/**
 * Estudio: nombre, prototipo, tareas y criterio de éxito de cada una.
 *
 * Definido desde v0.1 para que el formato exista; se usa a partir de v0.3.
 * Ver docs/estudios-con-ia.md.
 */

export type SuccessRule =
  /** Llegó a esta página. Se verifica con los eventos `navigation`. */
  | { type: 'reached'; path: string }
  /** Tocó este elemento. Se verifica con los eventos `tap` y su `selector`. */
  | { type: 'tapped'; selector: string }
  /** Lo marca el moderador a mano. */
  | { type: 'manual' };

export interface Task {
  id: string;
  /** "Comprar el producto rojo" */
  title: string;
  /** Lo que lee el participante, en sus palabras. */
  instruction: string;
  /** "/index.html". Si falta, empieza donde esté. */
  startPath?: string;
  success: SuccessRule;
}

export interface Study {
  v: 1;
  name: string;
  description?: string;
  prototypeId: string;
  /** Texto que ve el participante al empezar. */
  welcome?: string;
  tasks: Task[];
}
