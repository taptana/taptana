/**
 * Estado del estudio en esta pestaña. Vive en sessionStorage: sobrevive a recargar y a navegar
 * entre páginas del prototipo, y se borra al cerrar la pestaña.
 */

import { PREVIEW_WINDOW, STUDY_PARAM, normalizeStudy, type StudyRecord } from '@taptana/shared';
import { queryParam } from './config.js';
import { resetSession, storageGet, storageRemove, storageSet } from './session.js';

export interface StudyState {
  studyId: string;
  /**
   * - new: todavía no acepta ni rechaza. Nada se graba.
   * - active: aceptó. Se graba.
   * - declined: prefirió no participar. Nada se graba en ninguna página de esta pestaña.
   * - finished: terminó. Ya no se graba.
   */
  status: 'new' | 'active' | 'declined' | 'finished';
  variantId?: string;
  /** Alias que escribió en la bienvenida. */
  participant?: string;
  /** El evento `study start` ya se emitió. */
  announced?: boolean;
  /** Bloque actual. */
  index: number;
  /**
   * Paso dentro del bloque: `intro` (leyendo la instrucción o la pregunta), `run` (haciendo la
   * tarea) o `closing` (la tarea ya terminó y se espera un momento antes del siguiente bloque).
   */
  phase: 'intro' | 'run' | 'closing';
  /** Cuándo tocó "Empezar tarea". */
  startedAt?: number;
  /** Cuándo se cumplió la regla. */
  goalAt?: number;
  /** Primer clic: cuándo tocó. */
  tapAt?: number;
  /** `closing`: cuándo pasar al siguiente bloque. */
  closeAt?: number;
  /** Pregunta: cuándo se mostró (para medir cuánto tardó en responder). */
  shownAt?: number;
  /** Regla `visible`: ya se vio la pantalla sin cumplirla, así que si aparece es por la tarea. */
  armed?: boolean;
  /** Ya se llevó al participante a la pantalla de inicio de este bloque (para no hacerlo en bucle). */
  movedFor?: string;
  /** Dónde dejó la píldora de la tarea, como fracción del viewport. */
  pill?: [number, number];
  /** Ya vio la pista de la píldora. */
  hinted?: boolean;
}

export function freshState(studyId: string): StudyState {
  return { studyId, status: 'new', index: 0, phase: 'intro' };
}

/** Deja el estado listo para el bloque `index`, sin rastro del anterior. */
export function resetBlock(state: StudyState, index: number): void {
  state.index = index;
  state.phase = 'intro';
  delete state.startedAt;
  delete state.goalAt;
  delete state.tapAt;
  delete state.closeAt;
  delete state.shownAt;
  delete state.armed;
}

/** Dónde se guarda el estado. La prueba sin grabar usa otras llaves para no mezclarse con una sesión real. */
export class StudyStore {
  private readonly stateKey: string;
  private readonly dataKey: string;

  constructor(tryout: boolean) {
    this.stateKey = tryout ? 'taptana:tryout' : 'taptana:study';
    this.dataKey = tryout ? 'taptana:tryoutData' : 'taptana:studyData';
  }

  read(): StudyState | null {
    try {
      const raw = storageGet(this.stateKey);
      const state = raw ? (JSON.parse(raw) as Partial<StudyState>) : null;
      if (!state || typeof state.studyId !== 'string' || typeof state.index !== 'number' || !state.status) return null;
      return state as StudyState;
    } catch {
      return null;
    }
  }

  /** Devuelve false si no se pudo guardar. */
  write(state: StudyState): boolean {
    return storageSet(this.stateKey, JSON.stringify(state));
  }

  clear(): void {
    storageRemove(this.stateKey);
    storageRemove(this.dataKey);
  }

  /** El estudio tal como se bajó la primera vez: toda la sesión usa la misma versión. */
  readStudy(id: string): StudyRecord | null {
    try {
      const raw = storageGet(this.dataKey);
      if (!raw) return null;
      const study = normalizeStudy(JSON.parse(raw) as StudyRecord);
      return study.id === id ? study : null;
    } catch {
      return null;
    }
  }

  writeStudy(study: StudyRecord): void {
    storageSet(this.dataKey, JSON.stringify(study));
  }
}

/** ¿Esta página se cargó recargando o con atrás/adelante (y no abriendo un link)? */
function isReturn(): boolean {
  try {
    const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    return entry?.type === 'reload' || entry?.type === 'back_forward';
  } catch {
    return false;
  }
}

/**
 * Decide si esta página forma parte de un estudio (modo grabación).
 *
 * - `?study=<id>` con otro estudio, o sin estado: empieza de cero, con una sesión nueva.
 * - `?study=<id>` del mismo estudio ya terminado o rechazado: abrir el link de nuevo empieza
 *   una sesión nueva con bienvenida; recargar esa página no.
 * - Sin el parámetro: sigue lo que haya guardado (recargas y navegación continúan).
 */
export function openStudy(store: StudyStore): StudyState | null {
  const fromUrl = queryParam(STUDY_PARAM);
  const saved = store.read();
  if (fromUrl) {
    const over = saved?.status === 'finished' || saved?.status === 'declined';
    if (!saved || saved.studyId !== fromUrl || (over && !isReturn())) return startOver(store, fromUrl);
  }
  return saved;
}

/** Estado nuevo para el estudio, con una sesión nueva: nada de lo anterior se mezcla. */
export function startOver(store: StudyStore, studyId: string): StudyState {
  resetSession();
  store.clear();
  const state = freshState(studyId);
  store.write(state);
  return state;
}

/**
 * Guarda un estado que apaga la grabación (rechazó o terminó). Si el navegador no deja usar
 * sessionStorage, se marca la pestaña con el nombre de "solo mostrar": así las siguientes
 * páginas tampoco graban.
 */
export function persistSilence(store: StudyStore, state: StudyState): void {
  if (store.write(state)) return;
  try {
    if (window.top === window.self && !window.name) window.name = PREVIEW_WINDOW;
  } catch {
    /* no hay más que hacer */
  }
}
