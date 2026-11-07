/**
 * Validación mínima de lo que llega por la red. Sin dependencias.
 * No valida cada evento a fondo: solo que el lote tenga la forma esperada.
 */

import type { EventBatch } from './api.js';
import type { TaptanaEvent } from './events.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isTaptanaEvent(value: unknown): value is TaptanaEvent {
  if (!isRecord(value)) return false;
  if (!isFiniteNumber(value['t'])) return false;
  if (value['kind'] === 'rrweb') return 'data' in value;
  if (value['kind'] === 'taptana') return isNonEmptyString(value['type']);
  return false;
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function validateEventBatch(value: unknown): ValidationResult<EventBatch> {
  if (!isRecord(value)) return { ok: false, error: 'batch must be an object' };
  if (value['v'] !== 1) return { ok: false, error: 'unsupported batch version' };
  for (const key of ['prototypeId', 'sessionId', 'pageId'] as const) {
    if (!isNonEmptyString(value[key])) return { ok: false, error: `${key} is required` };
  }
  if (!isFiniteNumber(value['seq']) || value['seq'] < 0) {
    return { ok: false, error: 'seq must be a non-negative number' };
  }
  if (!isFiniteNumber(value['sentAt'])) return { ok: false, error: 'sentAt must be a number' };
  const events = value['events'];
  if (!Array.isArray(events)) return { ok: false, error: 'events must be an array' };
  for (let i = 0; i < events.length; i++) {
    if (!isTaptanaEvent(events[i])) return { ok: false, error: `events[${i}] is malformed` };
  }
  if (value['page'] !== undefined && !isRecord(value['page'])) {
    return { ok: false, error: 'page must be an object' };
  }
  if (value['device'] !== undefined && !isRecord(value['device'])) {
    return { ok: false, error: 'device must be an object' };
  }
  return { ok: true, value: value as unknown as EventBatch };
}
