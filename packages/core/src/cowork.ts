/**
 * Fikirtive cowork — the agent (the product's differentiator). v1 skill: draft a
 * storyboard from an idea. cowork manipulates the project through the SAME server
 * actions a user would, so anything it does, the user could undo.
 */
import { z } from "zod";
import { MAX_GEN_PROMPT, MAX_GEN_ENTITIES, MAX_GEN_COUNT } from "./gen.js";
import { GOAL_KEYS } from "./goals.js";
import { MAX_TURN_REFERENCES } from "./reference-ref.js";
import { clampVisionInts } from "./runtime-config.js";

export const MAX_COWORK_IDEA = 4000;
export const MAX_COWORK_TURN_REFERENCES = 8;

/** One propose-only cowork turn: the user's NL text (+ optional @-mention refs and
 *  per-entity variant selections), against an existing thread or a fresh one. */
export const coworkTurnRequest = z.object({
  threadId: z.string().min(1).max(64).optional(), // absent → create a new thread
  projectId: z.string().min(1).max(64),
  text: z.string().trim().min(1).max(MAX_COWORK_IDEA),
  entityIds: z.array(z.string().min(1).max(64)).max(MAX_GEN_ENTITIES).default([]),
  variantSel: z.record(z.string().min(1).max(64), z.string().min(1).max(64)).default({}),
  // "Animate this result" — a finished result frame to use as the i2v source. A
  // server-TRUSTED reference: coworkTurn re-validates it (owned + in this project +
  // live) before forcing a video proposal, and startGen's checkCast re-validates at
  // spend. Drop/ignore if invalid; never errors the turn.
  sourceGenerationId: z.string().min(1).max(64).optional(),
  // Multiple canvas-selected image references for the current Otto turn. The first
  // valid image remains the primary i2v source for backwards-compatible generation
  // cards; all valid images are passed to Otto vision for this turn.
  sourceGenerationIds: z.array(z.string().min(1).max(64)).max(MAX_COWORK_TURN_REFERENCES).optional(),
  // whole-clip reference video (整段视频参考). Server-TRUSTED: re-validated owned +
  // in-project + video-ext before use; invalid/foreign/deleted id silently ignored.
  referenceVideoGenerationId: z.string().min(1).max(64).optional(),
  // Multiple whole-clip reference videos selected on the canvas. Generation remains
  // single-primary today; the array makes the full reference set visible to Otto.
  referenceVideoGenerationIds: z.array(z.string().min(1).max(64)).max(MAX_COWORK_TURN_REFERENCES).optional(),
  // "Reply to message" — a prior message in the same thread to quote in context.
  // Server-TRUSTED: coworkTurn re-validates ownership + thread + live before
  // injecting the quote; invalid/foreign/deleted id is silently ignored.
  replyToMessageId: z.string().min(1).max(64).optional(),
  // Goal tile selection — optional; absent on plain turns + legacy callers (additive, safe).
  // On a NEW thread, ottoTurn seeds the opening with the preset's plain-language framing.
  // 键从 GOAL_PRESETS 生成(W2-8):这里原来手抄了一份四个键的清单,加一个目标就要记得同时
  // 改两处,而漏改的那一天服务端会静默拒收一个界面上真的画着的 chip。
  goalKey: z.enum(GOAL_KEYS).optional(),
  // Simple mode — inject plain-language voice block (Task 6). Absent → legacy/pro behavior.
  simple: z.boolean().optional(),
  // #879 step 1: optional page-context pins for the Otto foundation schema (semantics land in
  // #879 step 2). POSITION-ONLY — the client may declare where it is, never who it is. Identity
  // columns (actorId, visibility) have no client-facing field and can only ever be filled
  // server-side from the authenticated principal; `.strict()` above already rejects any attempt
  // to send them.
  surface: z.string().min(1).max(64).optional(),
  subjectRef: z.string().min(1).max(64).optional(),
  outletId: z.string().min(1).max(64).optional(),
  // FRONT-A10(规格 docs/specs/frontend-baseline.md §7.3③ 第③刀):这一轮 `@` 到的对象,
  // 线形是类型化 ID `"<type>:<id>"`(`reference-ref.ts` 的 formatReferenceRef)。
  // 与 `entityIds` 并存而不是取代它:`entityIds` 是**生成条件**(worker 按它取参考图),
  // 这一格是**这条消息提到了谁**(落进 ChatMessage.referenceRefs,供回链)。两件事,两条路。
  // 服务端不信任这里的任何一个 id:落库前逐个按当前 principal 的 ownerId 解析
  // (`apps/web/lib/reference-refs.ts`),解不出来的那一轮整轮不发。
  references: z.array(z.string().min(1).max(96)).max(MAX_TURN_REFERENCES).optional(),
}).strict();
export type CoworkTurnRequest = z.infer<typeof coworkTurnRequest>;

/** One part of a multimodal message content (OpenAI shape). */
export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

/** A model-neutral chat turn. `content` is a plain string for the common (text-only)
 *  case, or an array of parts for image-bearing turns (vision). Skills assemble these;
 *  the transport ships them. All current callers pass a string and are unaffected. */
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string | ChatContentPart[] };

export const MAX_PLAN_STEPS = 8;

/** Cowork vision (Phase C) config — read from env now; the future admin dashboard will
 *  make these DB-backed runtime toggles (so keep them read from THIS one place). */
export function coworkVisionConfig(): { enabled: boolean; policy: "C"; maxImages: number; maxBytes: number } {
  // DEFAULT ON: vision is on unless explicitly disabled. The flag stays as an emergency
  // off-switch (set COWORK_VISION_ENABLED=false / 0 to turn it off without a redeploy) and
  // the future dashboard knob — but the operator gets it out of the box, no env var needed.
  const enabled = process.env.COWORK_VISION_ENABLED !== "false" && process.env.COWORK_VISION_ENABLED !== "0";
  // fail-closed: a finite positive int clamped to a hard ceiling, else the default —
  // Infinity/0/garbage must never UN-bound the safety caps (esp. once dashboard-tunable).
  const { maxImages, maxBytes } = clampVisionInts({
    maxImages: process.env.COWORK_VISION_MAX_IMAGES,
    maxBytes: process.env.COWORK_VISION_MAX_BYTES,
  });
  return { enabled, policy: "C", maxImages, maxBytes };
}

export const coworkProposalSchema = z.object({
  kind: z.enum(["image", "video"]),
  desiredAspect: z.string().max(12).optional(),
  desiredDuration: z.number().int().min(1).max(60).optional(),
  desiredAudio: z.boolean().optional(),
  structuredPrompt: z.string().trim().min(1).transform((s) => s.slice(0, MAX_GEN_PROMPT)),
  entityIds: z.array(z.string().min(1).max(64)).max(MAX_GEN_ENTITIES).default([]),
  variantSel: z.record(z.string().min(1).max(64), z.string().min(1).max(64)).default({}),
}).strict();

export const coworkGenerateRequest = z.object({
  cardId: z.string().min(1).max(64),
  prompt: z.string().trim().min(1).max(MAX_GEN_PROMPT),
  entityIds: z.array(z.string().min(1).max(64)).max(MAX_GEN_ENTITIES).default([]),
  variantSel: z.record(z.string().min(1).max(64), z.string().min(1).max(64)).default({}),
  // OPTIONAL user overrides (editable card — model picker + param pills). Each absent →
  // coworkGenerate uses the persisted card's value. These only WIDEN what reaches startGen;
  // they are NOT trusted — startGen's safeParse + superRefine + checkCast remain the sole,
  // complete gate (model∈the card-kind's menu, every param∈the chosen model's option set,
  // count≤maxCount). `kind` and `sourceGenerationId` are NOT here — they stay card-trusted so
  // an edit can't flip image↔video (dodging pricing/validation) or swap the i2v frame.
  model: z.string().min(1).max(40).optional(),
  count: z.number().int().min(1).max(MAX_GEN_COUNT).optional(),
  aspectRatio: z.string().max(12).optional(),
  resolution: z.string().max(12).optional(),
  durationSeconds: z.number().int().min(1).max(60).optional(),
  audio: z.boolean().optional(),
}).strict();
export type CoworkGenerateRequest = z.infer<typeof coworkGenerateRequest>;

export const coworkRenameThreadRequest = z.object({
  threadId: z.string().min(1).max(64),
  title: z.string().trim().min(1).max(120),
}).strict();
export type CoworkRenameThreadRequest = z.infer<typeof coworkRenameThreadRequest>;

export const coworkDeleteThreadRequest = z.object({
  threadId: z.string().min(1).max(64),
}).strict();
export type CoworkDeleteThreadRequest = z.infer<typeof coworkDeleteThreadRequest>;

export const coworkVaryCardRequest = z.object({ cardId: z.string().min(1).max(64) }).strict();
export type CoworkVaryCardRequest = z.infer<typeof coworkVaryCardRequest>;

export const MAX_COWORK_BRIEF = 2000;
export const coworkBriefRequest = z.object({
  projectId: z.string().min(1).max(64),
  brief: z.string().max(MAX_COWORK_BRIEF), // empty string allowed = clear the brief
}).strict();
export type CoworkBriefRequest = z.infer<typeof coworkBriefRequest>;

/** Admin runtime-config write input (OPT-6 P1a). One discriminated key per setting;
 *  each value is .strict() so unknown fields are rejected. */
export const runtimeConfigInput = z.discriminatedUnion("key", [
  z.object({ key: z.literal("vision"), value: z.object({
    enabled: z.boolean().optional(),
    maxImages: z.number().int().min(1).max(8).optional(),
    maxBytes: z.number().int().min(1).max(16_000_000).optional(),
  }).strict() }),
  // OPT-6 P2 §⑥ knowledge keys — $0 planner text (not spend gates). Bounded length.
  z.object({ key: z.literal("planner_system"), value: z.object({ text: z.string().trim().max(8000) }).strict() }),
  z.object({ key: z.literal("brief_default"), value: z.object({ text: z.string().trim().max(2000) }).strict() }),
  z.object({ key: z.literal("description_template"), value: z.object({ text: z.string().trim().max(2000) }).strict() }),
]);
export type RuntimeConfigInput = z.infer<typeof runtimeConfigInput>;

export const coworkTurnSchema = z.object({
  planSteps: z.array(z.string().trim().min(1).transform((s) => s.slice(0, 200))).transform((arr) => arr.slice(0, MAX_PLAN_STEPS)).default([]),
  reply: z.string().trim().min(1).transform((s) => s.slice(0, 2000)),
  // Optional LLM auto-title (≤6 words) summarizing the conversation, emitted in the
  // SAME planner JSON ($0). Truncating transform mirrors the schema's other coercing
  // fields; absent → coworkTurn falls back to the user's first message.
  title: z.string().trim().min(1).transform((s) => s.slice(0, 80)).optional(),
  // The agent's auto-maintained per-project creative brief — emitted in the SAME planner
  // JSON ($0). The planner refines the CURRENT brief (which is injected into its context)
  // only when it learns durable project direction; absent → no change. ≤600 chars (concise).
  briefUpdate: z.string().trim().min(1).transform((s) => s.slice(0, 600)).optional(),
  // The planner's see-once descriptions of reference images shown to it THIS turn, keyed by
  // the ref's @name (as labeled in the image). Emitted in the SAME JSON ($0); persisted
  // once to Entity.descriptionJson and reused on later turns. Each value concise (≤600).
  refDescriptions: z.record(z.string(), z.string().trim().min(1).transform((s) => s.slice(0, 600))).optional(),
  proposal: coworkProposalSchema.nullable().default(null),
}).strict();
export type CoworkTurn = z.infer<typeof coworkTurnSchema>;
