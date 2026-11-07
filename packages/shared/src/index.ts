export type {
  RrwebEvent,
  TargetInfo,
  TapEvent,
  SwipeDirection,
  SwipeEvent,
  ScrollEvent,
  Orientation,
  ViewportEvent,
  NavigationEvent,
  TaskEvent,
  StudyEvent,
  TaptanaOwnEvent,
  TaptanaEvent,
  TaptanaOwnEventType,
} from './events.js';
export { GESTURE_THRESHOLDS } from './events.js';

export type {
  DeviceInfo,
  PageInfo,
  Prototype,
  SessionSummary,
  SessionPage,
} from './session.js';
export { LOCAL_PROTOTYPE_ID } from './session.js';

export type {
  EventBatch,
  EventBatchResponse,
  SessionListResponse,
  SessionEventsResponse,
  SessionExport,
  StudyListResponse,
  PrototypePagesResponse,
  PrototypeListResponse,
  ServerInfo,
  SessionPatch,
  ApiError,
} from './api.js';
export {
  API_PREFIX,
  RECORDER_PATH,
  PANEL_PATH,
  UPLOADED_PATH,
  DEFAULT_PORT,
  DEFAULT_HOST,
  BATCH_INTERVAL_MS,
  BATCH_MAX_EVENTS,
  BEACON_MAX_BYTES,
} from './api.js';

export type {
  SuccessRule,
  TaskKind,
  Task,
  StudyVariant,
  Study,
  StudyRecord,
  TaskOutcome,
  TaskResult,
  ManualResults,
} from './study.js';
export { DEFAULT_CONSENT_TEXT } from './study.js';
export { validateStudy } from './validate.js';

export { deviceLabel } from './device.js';

export type { ValidationResult } from './validate.js';
export { isTaptanaEvent, validateEventBatch } from './validate.js';

export { computeTaskResults, samePath, tapMatches } from './results.js';
export { batchesToExport } from './batches.js';
