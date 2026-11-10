/**
 * Lee el índice de un zip (su "directorio central") sin descomprimir nada, y después
 * descomprime una entrada a la vez.
 *
 * Así se puede revisar todo ANTES de gastar memoria o disco: cuántos archivos trae, cuánto
 * dicen pesar descomprimidos (una "bomba zip" declara gigas en pocos kB), si alguno es un
 * enlace simbólico o tiene contraseña. Y al descomprimir, cada archivo ocupa como mucho el
 * tamaño que declaró: si miente, sale cortado en vez de llenar la memoria.
 *
 * La descompresión en sí la hace fflate (JS puro).
 */

import { inflateSync } from 'fflate';

export class ZipError extends Error {}

export interface ZipEntry {
  /** Ruta dentro del zip, con "/" como separador. */
  name: string;
  /** Tamaño declarado al descomprimir. */
  size: number;
  compressedSize: number;
  /** 0 = sin comprimir, 8 = deflate. Lo demás no se soporta. */
  method: number;
  directory: boolean;
  /** Enlace simbólico (zips hechos en macOS o Linux). */
  symlink: boolean;
  /** Protegido con contraseña. */
  encrypted: boolean;
  /** Dónde empieza su cabecera local dentro del archivo. */
  offset: number;
}

const EOCD = 0x06054b50;
const EOCD64 = 0x06064b50;
const EOCD64_LOCATOR = 0x07064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
/** Un zip de 50 MB no puede traer más entradas útiles que esto; más es un archivo hecho para estorbar. */
const MAX_ENTRIES = 100_000;

const utf8Strict = new TextDecoder('utf-8', { fatal: true });
const latin1 = new TextDecoder('latin1');

/** Muchos zips traen nombres en UTF-8 sin avisarlo ("diseño.html"): se prueba UTF-8 primero. */
function decodeName(bytes: Uint8Array): string {
  try {
    return utf8Strict.decode(bytes);
  } catch {
    return latin1.decode(bytes);
  }
}

function view(data: Uint8Array): DataView {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

/** Entero de 64 bits como número. Los zips que aceptamos son pequeños: nunca pasa de 2^53. */
function u64(v: DataView, at: number): number {
  return v.getUint32(at, true) + v.getUint32(at + 4, true) * 2 ** 32;
}

/** Lista las entradas del zip. Lanza ZipError si el archivo no es un zip o está dañado. */
export function listZip(data: Uint8Array): ZipEntry[] {
  try {
    return readDirectory(data);
  } catch (err) {
    if (err instanceof ZipError) throw err;
    throw new ZipError('zip dañado'); // lecturas fuera del archivo (RangeError de DataView)
  }
}

function readDirectory(data: Uint8Array): ZipEntry[] {
  const v = view(data);
  // El registro final está al fondo del archivo, antes de un comentario de hasta 64 kB.
  let end = data.length - 22;
  if (end < 0) throw new ZipError('no es un zip');
  while (v.getUint32(end, true) !== EOCD) {
    if (end === 0 || data.length - end > 65_558) throw new ZipError('no es un zip');
    end--;
  }
  let count = v.getUint16(end + 10, true);
  let at = v.getUint32(end + 16, true);
  if (count === 0xffff || at === 0xffffffff) {
    // Formato zip64: los números reales están en otro registro.
    const locator = end - 20;
    if (locator >= 0 && v.getUint32(locator, true) === EOCD64_LOCATOR) {
      const end64 = u64(v, locator + 8);
      if (v.getUint32(end64, true) === EOCD64) {
        count = u64(v, end64 + 32);
        at = u64(v, end64 + 48);
      }
    }
  }
  if (count > MAX_ENTRIES) throw new ZipError('demasiadas entradas');

  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (v.getUint32(at, true) !== CENTRAL) throw new ZipError('zip dañado');
    const madeBy = v.getUint16(at + 4, true);
    const flags = v.getUint16(at + 8, true);
    const method = v.getUint16(at + 10, true);
    let compressedSize = v.getUint32(at + 20, true);
    let size = v.getUint32(at + 24, true);
    const nameLength = v.getUint16(at + 28, true);
    const extraLength = v.getUint16(at + 30, true);
    const commentLength = v.getUint16(at + 32, true);
    const attributes = v.getUint32(at + 38, true);
    let offset = v.getUint32(at + 42, true);
    const nameStart = at + 46;
    const extraStart = nameStart + nameLength;
    if (extraStart + extraLength > data.length) throw new ZipError('zip dañado');

    // Campo extra zip64: trae, en este orden, solo los valores que no cupieron en 32 bits.
    for (let x = extraStart; x + 4 <= extraStart + extraLength; ) {
      const id = v.getUint16(x, true);
      const length = v.getUint16(x + 2, true);
      if (id === 1) {
        let field = x + 4;
        if (size === 0xffffffff) {
          size = u64(v, field);
          field += 8;
        }
        if (compressedSize === 0xffffffff) {
          compressedSize = u64(v, field);
          field += 8;
        }
        if (offset === 0xffffffff) offset = u64(v, field);
        break;
      }
      x += 4 + length;
    }

    const name = decodeName(data.subarray(nameStart, extraStart)).replace(/\\/g, '/');
    const unixMode = madeBy >> 8 === 3 ? attributes >>> 16 : 0;
    entries.push({
      name,
      size,
      compressedSize,
      method,
      directory: name.endsWith('/') || (attributes & 0x10) !== 0 || (unixMode & 0o170000) === 0o040000,
      symlink: (unixMode & 0o170000) === 0o120000,
      encrypted: (flags & 1) !== 0,
      offset,
    });
    at = extraStart + extraLength + commentLength;
  }
  return entries;
}

/** Descomprime una entrada. Nunca devuelve más bytes de los que la entrada declaró. */
export function readZipEntry(data: Uint8Array, entry: ZipEntry): Uint8Array {
  try {
    const v = view(data);
    if (v.getUint32(entry.offset, true) !== LOCAL) throw new ZipError('zip dañado');
    const start = entry.offset + 30 + v.getUint16(entry.offset + 26, true) + v.getUint16(entry.offset + 28, true);
    const compressed = data.subarray(start, start + entry.compressedSize);
    if (entry.method === 0) return compressed.subarray(0, entry.size);
    if (entry.method === 8) return inflateSync(compressed, { out: new Uint8Array(entry.size) });
    throw new ZipError('compresión no soportada');
  } catch (err) {
    if (err instanceof ZipError) throw err;
    throw new ZipError('zip dañado');
  }
}
