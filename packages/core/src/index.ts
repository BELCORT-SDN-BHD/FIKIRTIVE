export { newId } from "./ids.js";
export { storageKey, parseStorageKey, keyOwnerMatches, FOUNDER_OWNER_ID } from "./storage-key.js";
export {
  ORG_ROLES,
  ORG_CAPABILITIES,
  ORG_ROLE_CAPABILITIES,
  isOrgRole,
  isOrgCapability,
  effectiveOrgRoles,
  primaryOrgRole,
  orgRolesAllow,
  type OrgRole,
  type OrgCapability,
} from "./org-roles.js";
export { sha256Stream, sha256Bytes } from "./hash.js";
export {
  fikirtiveEdit,
  betweenClipTransition,
  captionCue,
  textOverlay,
  overlayStyle,
  renderJobData,
  editDuration,
  renderDuration,
  foreignEditSrcs,
  FOREIGN_MEDIA_MESSAGE,
  srcToStorageKey,
  storageKeyToSrc,
  TRANSITION_DEFAULT_SECONDS,
  TRANSITION_MAX_SECONDS,
  TRANSITION_TYPES,
  TRANSITION_DIRECTIONS,
  AUDIO_ROLES,
  EXT_BY_TYPE,
  MAX_CLIPS_PER_TRACK,
  MAX_TIMELINE_SECONDS,
  MAX_CAPTIONS,
  MAX_OVERLAYS,
  MAX_CAPTION_CHARS,
  MAX_OVERLAY_CHARS,
  MAX_FONT_PX,
  OVERLAY_POSITIONS,
  RENDER_QUEUE,
  INGEST_QUEUE,
  INGEST_DLQ,
  RENDER_DLQ,
  RENDER_RETRY_LIMIT,
  RENDER_QUEUE_POLICY,
  RENDER_STATUSES,
  captionJobData,
  CAPTION_QUEUE,
  CAPTION_DLQ,
  CAPTION_RETRY_LIMIT,
  CAPTION_QUEUE_POLICY,
  TRANSCRIPT_GENERATION,
  type FikirtiveEdit,
  type FikirtiveClip,
  type BetweenClipTransition,
  type CaptionCue,
  type TextOverlay,
  type OverlayPosition,
  type TransitionType,
  type TransitionDirection,
  type AudioRole,
  type RenderJobData,
  type RenderStatus,
  type CaptionJobData,
} from "./timeline.js";
export * from "./upload.js";
export * from "./media-sniff.js";
export * from "./refgen.js";
export * from "./reference-budget.js";
export * from "./ref-config.js";
export * from "./gen.js";
export * from "./spend.js";
export * from "./owner-settings.js";
export * from "./provider-secrecy.js";
export * from "./cowork.js";
export * from "./runtime-config.js";
export * from "./model-registry.js";
export * from "./roles.js";
export * from "./cowork-compose.js";
export * from "./cowork-directives.js";
export * from "./cowork-guardian.js";
export * from "./cowork-route.js";
export { COWORK_PLANNER_SYSTEM, buildPlannerMessages, parseCoworkTurn, mockPlannerReply } from "./cowork-planner.js";
export { buildGenRequestFromCard, type GenRequestInput } from "./gen-from-card.js";
export {
  VIDEO_CLIP_TOKEN,
  VIDEO_EDIT_OPENING,
  VIDEO_EXTEND_OPENING,
  anchoredVideoAction,
  isAnchoredVideoPrompt,
  // #922:beta 期间的下架名单 —— Otto 的能力表、商家手动入口、付费 schema 读的同一份。
  ANCHORED_ACTION_UNAVAILABLE,
  anchoredActionUnavailableReason,
  type AnchoredVideoAction,
} from "./video-actions.js";
export * from "./otto-budget.js";
export * from "./llm-prices.js";
export * from "./pricing-config.js";
export { GOAL_PRESETS, GOAL_KEYS, isGoalKey, type GoalKey } from "./goals.js";
export * from "./model-config.js";
export {
  RECORD_KINDS, productRecordData, segmentRecordData, offerRecordData,
  recordSchemaFor, recordName, normalizeNameKey, offerPhase,
  categoryKey, distinctCategories,
} from "./brand-records.js";
export type {
  RecordKind, ProductRecordData, SegmentRecordData, OfferRecordData, OfferPhase,
} from "./brand-records.js";
export { SECTIONS, FACT_SECTION_KEYS, sectionForCategory, diffRows } from "./memory-sections.js";
export { sectionsTouched } from "./memory-sections.js";
export type { SectionKey, RowDiff } from "./memory-sections.js";
export { tavilySearch, braveSearch, searchWithFallback } from "./websearch.js";
export type { WebSearchResult, WebSearchFn } from "./websearch.js";
// url-safety (node:dns) + fetch-extract are SERVER-ONLY — import from
// "@fikirtive/core/server" (see src/server.ts). Keeping them out of this barrel
// prevents node:dns from leaking into client bundles that import "@fikirtive/core".
// extractProductDraft and schedule draft/state helpers are PURE — safe to stay here.
export { extractProductDraft } from "./product-extract.js";
export type { ProductDraft } from "./product-extract.js";
export {
  SCHEDULED_POST_STATUSES,
  canTransition,
  type ScheduledPostStatus,
} from "./schedule-state.js";
export {
  ACCOUNTS_UNREADABLE_ERROR,
  CONNECTION_BLOCKER_COPY,
  classifyConnectionFailure,
  classifyPagesRead,
  SCHEDULE_CHANNELS,
  SCHEDULE_CHANNEL_CAPS,
  isScheduleChannel,
  isValidScheduleTimeZone,
  parseScheduleInstant,
  scheduleApproveBlockers,
  validateScheduleDraft,
  type ChannelReadState,
  type ConnectionBlocker,
  type PagesReadState,
  type ScheduleApproveInput,
  type ScheduleChannel,
  type ScheduleDraftInput,
  type NormalizedScheduleDraft,
} from "./schedule-draft.js";
export {
  PUBLISH_QUEUE,
  PUBLISH_DLQ,
  PUBLISH_RETRY_LIMIT,
  META_REQUEST_TIMEOUT_MS,
  PUBLISH_EXECUTION_DEADLINE_MS,
  PUBLISH_QUEUE_POLICY,
  publishJobData,
  type PublishJobData,
} from "./publish.js";
export * from "./segment-rules.js";
// The two credibility grades a stored contact identity can carry (#803). Pure and shared,
// because the database constraint, the CRM write path, the audience gate and the badge in the
// browser must all mean the same thing by "not verified".
export * from "./contact-identity-grade.js";
// Canvas board geometry — WHERE a card lands. Pure (no Prisma, no server-only), so the three
// runtimes that place cards can share ONE grid: the browser, the web server, and the worker
// that writes a finished job's whole batch (#601).
export * from "./canvas-layout.js";
// The single projection from a finished job's result to the cards that should exist for it (#601).
export * from "./canvas-settlement-plan.js";
// The two words for "this job stopped and delivered nothing" — shared by every non-canvas rule
// that used to say "failed" and mean both (#602).
export * from "./gen-job-state.js";
// 引擎「你发来的东西我不收」这一类失败:一句人话 + 一个只认实测机器形状的分类器。放在 core,
// 是因为读者有三个 —— 适配器(判断)、worker(落盘)、web 与 Otto(取回给商家看),文案抄成
// 三份就一定会有一份先烂掉(#765)。
export * from "./gen-failure.js";
// What a canvas CARD may say, and which of those words mean it is still being made. Pure, and in
// core so the web app and the Otto skill read ONE vocabulary rather than two copies (#602 r2).
export * from "./canvas-card-status.js";
// 执行层真会做什么 —— 卡面文案(otto)与现役适配器请求体断言(generation)钉在同一份声明上。
// 纯数据,无 node/network 依赖,可留在主 barrel。
export {
  EXECUTED_SPEC, imageAspectHonoured, imageCoherentSetHonoured, videoElementReferencesHonoured,
  videoStartFrameHonoured,
} from "./executed-spec.js";
// 付费卡上「这一趟真会做成什么样」的那几个词。与 EXECUTED_SPEC 同住 core,因为读者有两个:
// Otto 细节卡与战役确认卡(#709)—— 规格文案抄成两份,就一定会有一份先烂掉。
export {
  buildSpecChips, videoAspectChip, VIDEO_START_FRAME_CHIP,
  type SpecChipParams, type VideoReferenceChipInput,
} from "./spec-chips.js";
// 「这一条是扣款、进账,还是还没结算的占用」只判一次:/billing、账务设置页与 Otto 的
// readSpending 三个对客口径共用它,web 与 otto 不再各写一套(#684)。
export { creditDirection, type CreditDirection } from "./credit-direction.js";
// 商家主导航的唯一权威源(#801)。三个读者共用:左侧导轨画它、Otto 照它指路、围栏照它核对。
// 纯数据(无 React、无图标、无 node/network),所以主 barrel 装得下。
export * from "./navigation.js";
// 素材理解三件套(#784)的唯一配置源:token 上限、单价、开关、日额、队列与产物形状。
// 「成本 < 一条视频的 1%」由这个模块算出来并由它的测试钉住 —— 纯数据 + 纯函数,主 barrel 装得下。
export * from "./asset-understanding.js";
// 七条死信队列的单一名单 + 「有没有活被系统放弃掉」的纯判据(#793)。读者有两个:探针
// 路由(要不要叫人)与 runbook 校验测试(文档有没有跟上代码),名单抄成两份必烂一份。
export * from "./dead-letters.js";

// 消息渠道状态的唯一措辞(#792 r2)。导轨、预览页、Otto 指令与 listChannelScopes 技能描述
// 共读一份 —— 从前它们各说各话,其中两处还在劝商家去连一条连不了的渠道。
export * from "./messaging-status.js";

// 战役状态与它们之间的合法动作(#710 的那一张表,C7 从 apps/web 搬来)。读者现在有三个:
// 服务端动作、商家那一页,以及 Otto —— 词汇不再各抄一份,转移表也第一次对助手可见。
export * from "./campaign-lifecycle.js";
