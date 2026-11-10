/**
 * Sesión, página y dispositivo.
 *
 * - Sesión: una visita de una persona. Sobrevive al cambiar de página (sessionStorage).
 * - Página: cada carga de un HTML dentro de la sesión. rrweb toma una foto completa del DOM
 *   al empezar cada una.
 */

import type { AnswerResult, TaskResult } from './study.js';

export interface DeviceInfo {
  /** Texto del navegador. El server lo resume en `deviceLabel`. */
  userAgent: string;
  /** Pantalla física. */
  screen: { width: number; height: number };
  /** Área visible. */
  viewport: { width: number; height: number };
  /** Densidad de píxeles (2 o 3 en celulares). */
  dpr: number;
  /** ¿Tiene pantalla táctil? */
  touch: boolean;
  /** "es-PE". */
  language: string;
}

export interface PageInfo {
  /** "/producto.html?id=*": la ruta con los valores de la query enmascarados (`maskUrl`). */
  path: string;
  /** <title> de la página. */
  title: string;
  /** De dónde vino, enmascarado igual que `path`. Vacío si es la primera. */
  referrer: string;
  startedAt: number;
}

/** Un prototipo: la carpeta servida en modo dev, o un archivo subido desde el panel. */
export interface Prototype {
  id: string;
  name: string;
  createdAt: number;
  /** 'folder': la carpeta de `taptana dev`. 'upload': subido desde el panel. */
  source?: 'folder' | 'upload';
  /** Página de entrada, relativa al prototipo ("/index.html"). */
  entryPath?: string;
  /** Ruta donde se sirve ("/" o "/p/pr_abc/"). La pone el servidor al listar. */
  url?: string;
  /** Sesiones grabadas. La pone el servidor al listar. */
  sessionCount?: number;
  /** Servido también en "/" (uno a la vez): para apps con rutas absolutas o router de History. */
  root?: boolean;
  /** El HTML de entrada usa rutas absolutas ("/css/app.css"): conviene abrirlo en la raíz. */
  absoluteUrls?: boolean;
}

/** Resumen de sesión tal como lo muestra la lista del panel. */
export interface SessionSummary {
  id: string;
  prototypeId: string;
  startedAt: number;
  lastSeenAt: number;
  /** Duración en ms: lastSeenAt - startedAt. */
  durationMs: number;
  /** "iPhone · Safari 18", calculado del user agent. */
  deviceLabel: string;
  viewport: { width: number; height: number };
  touch: boolean;
  /** Primera página que abrió. */
  entryPath: string;
  /** Cargas de página (una recarga cuenta de nuevo). Para pantallas distintas, `screenCount`. */
  pageCount: number;
  tapCount: number;
  /** Estudio al que pertenece, si abrió un link de estudio y aceptó grabar. */
  studyId?: string;
  /** Variante A/B asignada, si el estudio tiene variantes. */
  variantId?: string;
  /** Resultado por tarea. Lo calcula el servidor cuando la sesión tiene estudio. */
  tasks?: TaskResult[];
  /** Etiqueta del moderador ("P3 · Ana"). */
  label?: string;
  /** Alias que escribió el participante en la bienvenida. */
  participant?: string;
  /** Notas del moderador. */
  notes?: string;
  /** true: no cuenta en el reporte (pruebas internas). */
  excluded?: boolean;
  /** Respuestas a los bloques de pregunta. Las calcula el servidor (`computeAnswers`). */
  answers?: AnswerResult[];
  /** Pantallas distintas que vio (`countScreens`). */
  screenCount?: number;
}

/** Página dentro de una sesión, como la guarda el server. */
export interface SessionPage extends PageInfo {
  id: string;
}

/** Id del único prototipo en modo `taptana dev <carpeta>`. */
export const LOCAL_PROTOTYPE_ID = 'local';

/** Topes de lo que el moderador o el participante escriben sobre una sesión. */
export const SESSION_LIMITS = {
  /** Etiqueta del moderador. */
  label: 80,
  /** Notas del moderador. */
  notes: 4000,
  /** Alias que escribe el participante en la bienvenida. */
  participant: 60,
} as const;
