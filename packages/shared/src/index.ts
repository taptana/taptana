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
  PrototypeUrlCheck,
  PrototypeUrlIssue,
  PrototypeUrlLevel,
  PrototypeUrlRequest,
} from './api.js';
export { normalizePrototypeUrl, isPrivateHost } from './prototype-url.js';
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
  BrandTone,
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
  ManualPatch,
} from './study.js';
export {
  DEFAULT_CONSENT_TEXT,
  DEFAULT_THANKS_TEXT,
  STUDY_LIMITS,
  BLOCK_KIND_LABELS,
  BLOCK_KIND_TONES,
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
  applyManualPatch,
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
  screenTitles,
  screenName,
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
  InsightTopic,
  ScoreTone,
  ReportFilter,
  VariantReport,
  StudyReport,
  ReportOptions,
  ParticipantReport,
  ParticipantTask,
  ParticipantAnswer,
} from './report.js';
export { NOT_STARTED_LABEL, OUTCOME_LABELS, OUTCOME_ORDER, REPORT_DEFINITIONS, scoreBand, taskOutcomeLabel, SIMILAR_WIDTH_RATIO, similarWidth, computeStudyReport, studyCsv, shortSessionId } from './report.js';

export { smallSampleText } from './insights.js';
export type { Deck, DeckBar, DeckEdits, DeckItem, DeckMetric, DeckOptions, DeckOutcome, Slide, SlideEdit, SlideKind } from './deck.js';
export { applyDeckEdits, buildDeck, deckFileName, visibleSlides } from './deck.js';

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
