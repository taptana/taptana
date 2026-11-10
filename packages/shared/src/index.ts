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
  AnswerValue,
  AnswerEvent,
  StudyEvent,
  TaptanaOwnEvent,
  TaptanaEvent,
  TaptanaOwnEventType,
} from './events.js';
export { GESTURE_THRESHOLDS, OWN_EVENT_TYPES } from './events.js';

export type { DeviceInfo, PageInfo, Prototype, SessionSummary, SessionPage } from './session.js';
export { LOCAL_PROTOTYPE_ID, SESSION_LIMITS } from './session.js';

export type {
  EventBatch,
  EventBatchResponse,
  SessionListResponse,
  SessionEventsResponse,
  SessionExport,
  StudyListResponse,
  PrototypePagesResponse,
  PrototypeListResponse,
  ScreenInfo,
  PrototypeScreensResponse,
  ServerInfo,
  SessionPatch,
  ExampleResponse,
  ApiError,
} from './api.js';
export {
  API_PREFIX,
  RECORDER_PATH,
  PANEL_PATH,
  LEGACY_PANEL_PATH,
  UPLOADED_PATH,
  DEFAULT_PORT,
  DEFAULT_HOST,
  BATCH_INTERVAL_MS,
  BATCH_MAX_EVENTS,
  BATCH_MAX_BYTES,
  BEACON_MAX_BYTES,
  REQUEST_TIMEOUT_MS,
  EVENTS_BODY_MAX_BYTES,
  EXAMPLE_PROTOTYPE_ID,
  EXAMPLE_PROTOTYPE_NAME,
  EXAMPLE_STUDY_ID,
} from './api.js';

export type {
  SuccessRule,
  TaskKind,
  QuestionKind,
  BlockKind,
  TaskBlock,
  ScaleBlock,
  ChoiceBlock,
  YesNoBlock,
  TextBlock,
  ContextBlock,
  QuestionBlock,
  Block,
  Task,
  StudyVariant,
  StudySettings,
  Study,
  StudyRecord,
  StudyV1,
  TaskOutcome,
  TapSummary,
  TaskResult,
  AnswerResult,
  ManualResults,
} from './study.js';
export {
  DEFAULT_CONSENT_TEXT,
  DEFAULT_THANKS_TEXT,
  STUDY_LIMITS,
  BLOCK_KIND_LABELS,
  TASK_KINDS,
  QUESTION_KINDS,
  BLOCK_KINDS,
  SCALE_SIZES,
  blockKind,
  blockTitle,
  isTaskBlock,
  isQuestionBlock,
  isContextBlock,
  studyBlocks,
  taskBlocks,
  questionBlocks,
  newBlockId,
  duplicateStudy,
} from './study.js';

export { deviceLabel } from './device.js';

export type { ValidationResult, StudyIssue, StudyValidation } from './validate.js';
export {
  isTaptanaEvent,
  sanitizeEvents,
  validateEventBatch,
  validateSessionPatch,
  validateSessionExport,
  validateStudy,
  normalizeStudy,
} from './validate.js';

export type { ScreenParts } from './screen.js';
export {
  screenId,
  sameScreen,
  screenLabel,
  screenParts,
  screenUrl,
  screenSlug,
  virtualScreenId,
  isRouteHash,
  maskUrl,
  countScreens,
  knownScreens,
  screenPath,
  samePath,
} from './screen.js';

export {
  FIRST_CLICK_REACH_MS,
  computeTaskResults,
  computeAnswers,
  needsReview,
  manualMarks,
  participantName,
  tapMatches,
} from './results.js';

export { batchesToExport } from './batches.js';

export type {
  ReportSession,
  HeatPoint,
  ScreenReport,
  PathReport,
  TaskOutcomeCounts,
  TaskReportRow,
  TaskVariantReport,
  TaskReport,
  QuestionReport,
  Insight,
  ReportFilter,
  VariantReport,
  StudyReport,
} from './report.js';
export { OUTCOME_LABELS, SIMILAR_WIDTH_RATIO, similarWidth, computeStudyReport, studyCsv } from './report.js';

export type { RecorderMessage, PanelMessage } from './preview.js';
export {
  PREVIEW_WINDOW,
  DEMO_WINDOW,
  TRYOUT_WINDOW,
  PREVIEW_PARAM,
  TRYOUT_PARAM,
  STUDY_PARAM,
  NEED_STUDY_TIMEOUT_MS,
  isRecorderMessage,
  isPanelMessage,
} from './preview.js';
