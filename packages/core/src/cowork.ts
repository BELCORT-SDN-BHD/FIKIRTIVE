/**
 * Fikirtive cowork — the agent (the product's differentiator). v1 skill: draft a
 * storyboard from an idea. The provider port mirrors the generation provider:
 * a mock for dev ($0, deterministic) and a real LLM for prod (fal, reusing
 * FAL_KEY). cowork manipulates the project through the SAME server actions a
 * user would, so anything it does, the user could undo.
 */
import { z } from "zod";
import { GEN_KINDS, MAX_GEN_PROMPT, MAX_GEN_ENTITIES, MAX_GEN_COUNT } from "./gen.js";
import { clampVisionInts } from "./runtime-config.js";

export const MAX_COWORK_IDEA = 4000;
export const COWORK_MAX_SCENES = 6;
export const COWORK_MAX_SHOTS_PER_SCENE = 8;

export const coworkRequest = z
  .object({
    projectId: z.string().min(1).max(64),
    idea: z.string().trim().min(1).max(MAX_COWORK_IDEA),
  })
  .strict();
export type CoworkRequest = z.infer<typeof coworkRequest>;

export const MAX_ENHANCE_TEXT = 2000;
/** "✨ Enhance" — rewrite a rough shot prompt into a vivid, detailed one. */
export const enhanceRequest = z
  .object({
    projectId: z.string().min(1).max(64),
    text: z.string().trim().min(1).max(MAX_ENHANCE_TEXT),
    // optional gen-shape (Phase 1): lets the server derive (family, mode) for a
    // model-aware rewrite. R3 — the client sends SHAPE, the server derives the
    // mode (never a client mode string). All absent → a family-neutral rewrite
    // (byte-identical to the pre-Phase-1 behavior).
    model: z.string().min(1).max(40).optional(),
    kind: z.enum(GEN_KINDS).optional(),
    conditioned: z.boolean().optional(),
    hasSource: z.boolean().optional(),
    hasTail: z.boolean().optional(),
  })
  .strict();
export type EnhanceRequest = z.infer<typeof enhanceRequest>;

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
  // whole-clip reference video (整段视频参考). Server-TRUSTED: re-validated owned +
  // in-project + video-ext before use; invalid/foreign/deleted id silently ignored.
  referenceVideoGenerationId: z.string().min(1).max(64).optional(),
  // "Reply to message" — a prior message in the same thread to quote in context.
  // Server-TRUSTED: coworkTurn re-validates ownership + thread + live before
  // injecting the quote; invalid/foreign/deleted id is silently ignored.
  replyToMessageId: z.string().min(1).max(64).optional(),
  // Goal tile selection — optional; absent on plain turns + legacy callers (additive, safe).
  // On a NEW thread, ottoTurn seeds the opening with the preset's plain-language framing.
  goalKey: z.enum(["sell-product", "announce-sale", "get-followers", "make-video"]).optional(),
  // Simple mode — inject plain-language voice block (Task 6). Absent → legacy/pro behavior.
  simple: z.boolean().optional(),
}).strict();
export type CoworkTurnRequest = z.infer<typeof coworkTurnRequest>;

/** A drafted storyboard: scenes, each with ordered shots (a prompt per shot). */
export interface CoworkPlan {
  scenes: { title: string; shots: { prompt: string }[] }[];
}

/** Validate an LLM's (untrusted) JSON before acting on it — caps scenes/shots
 *  so a runaway plan can't create hundreds of shots, and trims/bounds prompts. */
export const coworkPlan = z.object({
  scenes: z
    .array(
      z.object({
        title: z.string().trim().max(120).default(""),
        shots: z
          .array(z.object({ prompt: z.string().trim().min(1).max(2000) }))
          .min(1)
          .max(COWORK_MAX_SHOTS_PER_SCENE),
      }),
    )
    .min(1)
    .max(COWORK_MAX_SCENES),
});

/** One part of a multimodal message content (OpenAI shape). */
export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

/** A model-neutral chat turn. `content` is a plain string for the common (text-only)
 *  case, or an array of parts for image-bearing turns (vision). Skills assemble these;
 *  the transport ships them. All current callers pass a string and are unaffected. */
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string | ChatContentPart[] };

/** Knowledge injected into a skill run by the runner — e.g. the per-(family×mode)
 *  enhance directive the server resolved (Phase 1). Optional: absent → the skill
 *  uses its family-neutral base prompt. */
export interface SkillCtx {
  directive?: string;
}

/** Token usage reported back from a real LLM call.
 *  `cachedInputTokens` is a SUBSET of `inputTokens` (the portion served from the
 *  provider's prompt cache at a cheaper rate). Optional — absent when the transport
 *  doesn't have usage data (e.g. MockTransport). */
export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

/** The cowork PORT: a model-neutral transport, one method. It knows nothing
 *  about storyboards or prompts — only how to turn messages into text. mock
 *  ($0 deterministic) / fal (OpenRouter→Claude) / self-hosted-later are classes.
 *  `skillId` is carried so the mock dispatches by identity, never by sniffing
 *  prompt text; `opts.mockReply` lets a skill supply its $0 canned reply.
 *
 *  The `usage` field in the return is OPTIONAL and absent for mock ($0) calls.
 *  Existing callers that only read `.text` are unaffected. */
export interface CoworkTransport {
  readonly name: string;                                   // "mock" | "fal:llm"
  chat(
    skillId: string,
    messages: ChatMessage[],
    opts?: { mockReply?: () => string; responseFormat?: "json_object"; maxTokens?: number },
  ): Promise<{ text: string; usage?: LlmUsage }>;
}

export const MAX_PLAN_STEPS = 8;
export const COWORK_MEMORY_TURNS = 8;

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
 *  each value is .strict() so unknown fields are rejected. NOTE: provider includes
 *  "modal" (P1b) — but the WRITE is super-admin-only + credential-checked in
 *  saveRuntimeConfig (the zod schema only bounds the shape, not the authority). */
export const runtimeConfigInput = z.discriminatedUnion("key", [
  z.object({ key: z.literal("vision"), value: z.object({
    enabled: z.boolean().optional(),
    maxImages: z.number().int().min(1).max(8).optional(),
    maxBytes: z.number().int().min(1).max(16_000_000).optional(),
  }).strict() }),
  z.object({ key: z.literal("cowork_provider"), value: z.object({
    provider: z.enum(["mock", "fal", "modal"]), // P1b unlocks modal — super-admin-gated + credential-checked in saveRuntimeConfig
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
