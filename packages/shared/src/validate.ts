/**
 * Validación mínima de lo que llega por la red. Sin dependencias.
 * No valida cada evento a fondo: solo que el lote tenga la forma esperada.
 */

import type { EventBatch } from './api.js';
import type { TaptanaEvent } from './events.js';
import type { Study, SuccessRule } from './study.js';

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

function isSuccessRule(value: unknown): value is SuccessRule {
  if (!isRecord(value)) return false;
  if (value['type'] === 'manual') return true;
  if (value['type'] === 'reached') return isNonEmptyString(value['path']);
  if (value['type'] === 'tapped') return isNonEmptyString(value['selector']);
  return false;
}

/** Valida un archivo de estudio (lo que escribe una IA o una persona). */
export function validateStudy(value: unknown): ValidationResult<Study> {
  if (!isRecord(value)) return { ok: false, error: 'study must be an object' };
  if (value['v'] !== 1) return { ok: false, error: 'unsupported study version (expected v: 1)' };
  if (!isNonEmptyString(value['name'])) return { ok: false, error: 'name is required' };
  if (!isNonEmptyString(value['prototypeId'])) return { ok: false, error: 'prototypeId is required' };
  for (const key of ['description', 'welcome', 'consent'] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'string') return { ok: false, error: `${key} must be a string` };
  }
  const tasks = value['tasks'];
  if (!Array.isArray(tasks) || tasks.length === 0) return { ok: false, error: 'tasks must be a non-empty array' };
  const ids = new Set<string>();
  for (let i = 0; i < tasks.length; i++) {
    const t: unknown = tasks[i];
    if (!isRecord(t)) return { ok: false, error: `tasks[${i}] must be an object` };
    if (!isNonEmptyString(t['id'])) return { ok: false, error: `tasks[${i}].id is required` };
    if (ids.has(t['id'])) return { ok: false, error: `tasks[${i}].id "${t['id']}" is duplicated` };
    ids.add(t['id']);
    if (!isNonEmptyString(t['title'])) return { ok: false, error: `tasks[${i}].title is required` };
    if (!isNonEmptyString(t['instruction'])) return { ok: false, error: `tasks[${i}].instruction is required` };
    if (t['kind'] !== undefined && t['kind'] !== 'task' && t['kind'] !== 'first-click') {
      return { ok: false, error: `tasks[${i}].kind must be "task" or "first-click"` };
    }
    if (t['startPath'] !== undefined && typeof t['startPath'] !== 'string') return { ok: false, error: `tasks[${i}].startPath must be a string` };
    if (!isSuccessRule(t['success'])) return { ok: false, error: `tasks[${i}].success must be {type:"reached",path} | {type:"tapped",selector} | {type:"manual"}` };
  }
  const variants = value['variants'];
  if (variants !== undefined) {
    if (!Array.isArray(variants)) return { ok: false, error: 'variants must be an array' };
    const vids = new Set<string>();
    for (let i = 0; i < variants.length; i++) {
      const v: unknown = variants[i];
      if (!isRecord(v) || !isNonEmptyString(v['id']) || !isNonEmptyString(v['name'])) {
        return { ok: false, error: `variants[${i}] needs id and name` };
      }
      if (vids.has(v['id'])) return { ok: false, error: `variants[${i}].id is duplicated` };
      vids.add(v['id']);
    }
  }
  return { ok: true, value: value as unknown as Study };
}
