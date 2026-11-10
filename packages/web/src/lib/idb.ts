/**
 * IndexedDB con una sola conexión por base (modo demo). Abrir una conexión por llamada y no
 * cerrarla las acumula y puede bloquear las actualizaciones de esquema del recorder.
 */

const connections = new Map<string, Promise<IDBDatabase>>();

export function idbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

export function openDb(name: string, version: number, upgrade: (db: IDBDatabase) => void): Promise<IDBDatabase> {
  const cached = connections.get(name);
  if (cached) return cached;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(name, version);
    } catch (e) {
      reject(e);
      return;
    }
    req.onupgradeneeded = () => upgrade(req.result);
    req.onsuccess = () => {
      const db = req.result;
      const forget = (): void => {
        if (connections.get(name) === opening) connections.delete(name);
      };
      // Otra pestaña (o el recorder) quiere cambiar el esquema: soltamos la conexión.
      db.onversionchange = () => {
        db.close();
        forget();
      };
      db.onclose = forget;
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(req.error ?? new DOMException('blocked', 'InvalidStateError'));
  });
  connections.set(name, opening);
  opening.catch(() => {
    if (connections.get(name) === opening) connections.delete(name);
  });
  return opening;
}

/** Una petición sobre un almacén. */
export function idbRequest<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      const req = fn(db.transaction(store, mode).objectStore(store));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) {
      reject(e);
    }
  });
}

/** Varias escrituras en una sola transacción. */
export function idbBatch(db: IDBDatabase, store: string, fn: (s: IDBObjectStore) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(store, 'readwrite');
      fn(tx.objectStore(store));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    } catch (e) {
      reject(e);
    }
  });
}
