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
  ApiError,
} from './api.js';
export {
  API_PREFIX,
  RECORDER_PATH,
  PANEL_PATH,
  DEFAULT_PORT,
  DEFAULT_HOST,
  BATCH_INTERVAL_MS,
  BATCH_MAX_EVENTS,
  BEACON_MAX_BYTES,
} from './api.js';

export type { SuccessRule, Task, Study } from './study.js';

export type { ValidationResult } from './validate.js';
export { isTaptanaEvent, validateEventBatch } from './validate.js';
