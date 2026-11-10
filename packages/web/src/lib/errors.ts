/**
 * Errores que se le muestran a la persona. Regla del panel: solo los mensajes de `UserError`
 * (escritos en español por nosotros o por el servidor) llegan a la pantalla. Cualquier otro
 * fallo (del navegador, de una librería) se traduce a una explicación útil en español.
 */

export class UserError extends Error {
  /** Código HTTP, si vino del servidor. */
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'UserError';
    if (status !== undefined) this.status = status;
  }
}

/** La sesión que se quiso importar ya existe: el panel ofrece reemplazarla. */
export class SessionExistsError extends UserError {
  readonly sessionId: string;
  constructor(sessionId: string, message = 'Esta sesión ya está aquí.') {
    super(message, 409);
    this.name = 'SessionExistsError';
    this.sessionId = sessionId;
  }
}

const GENERIC = 'Algo salió mal. Intenta de nuevo; si sigue pasando, recarga la página.';

/** Mensaje en español para cualquier error. Nunca devuelve texto crudo del navegador. */
export function friendlyError(error: unknown, fallback: string = GENERIC): string {
  if (error instanceof UserError) return error.message;
  const name = typeof error === 'object' && error !== null ? String((error as { name?: unknown }).name ?? '') : '';
  const message = typeof error === 'object' && error !== null ? String((error as { message?: unknown }).message ?? '') : String(error ?? '');
  if (name === 'QuotaExceededError') return 'Este navegador se quedó sin espacio para guardar. Borra prototipos o sesiones que ya no uses e intenta de nuevo.';
  if (name === 'SecurityError' || name === 'InvalidStateError' || name === 'UnknownError' || name === 'NotFoundError' || name === 'VersionError') {
    return 'Este navegador no deja guardar datos aquí (suele pasar en ventanas privadas). Abre la página en una ventana normal.';
  }
  if (name === 'AbortError' || name === 'TimeoutError') return 'La operación tardó demasiado y se canceló. Intenta de nuevo.';
  if (name === 'SyntaxError') return 'El archivo no se puede leer: no es un JSON válido.';
  if (name === 'TypeError' && /fetch|network|load failed/i.test(message)) {
    return 'No pudimos conectar con Taptana. Revisa que siga abierta la terminal donde lo arrancaste y recarga la página.';
  }
  if (name === 'ChunkLoadError' || /dynamically imported module|importing a module script/i.test(message)) {
    return 'No se pudo cargar una parte del panel. Recarga la página.';
  }
  return fallback;
}

/** Mensaje para un código HTTP cuando el servidor no mandó uno propio. */
export function statusMessage(status: number): string {
  if (status === 401 || status === 403) {
    return 'El panel solo se abre desde la computadora donde corre Taptana, o con el link con llave que muestra la terminal.';
  }
  if (status === 404) return 'No encontramos lo que buscabas. Puede que se haya borrado.';
  if (status === 413) return 'El archivo es demasiado grande.';
  if (status >= 500) return 'Taptana tuvo un problema al responder. Intenta de nuevo; si sigue, mira la terminal donde lo arrancaste.';
  return `No se pudo completar la acción (código ${status}).`;
}
