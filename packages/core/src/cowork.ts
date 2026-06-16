/**
 * Artlio cowork — the agent (the product's differentiator). v1 skill: draft a
 * storyboard from an idea. The provider port mirrors the generation provider:
 * a mock for dev ($0, deterministic) and a real LLM for prod (fal, reusing
 * FAL_KEY). cowork manipulates the project through the SAME server actions a
 * user would, so anything it does, the user could undo.
 */
import { z } from "zod";
import { GEN_KINDS, MAX_GEN_PROMPT, MAX_GEN_ENTITIES } from "./gen.js";

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

/** A model-neutral chat turn. Skills assemble these; the transport ships them. */
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** Knowledge injected into a skill run by the runner — e.g. the per-(family×mode)
 *  enhance directive the server resolved (Phase 1). Optional: absent → the skill
 *  uses its family-neutral base prompt. */
export interface SkillCtx {
  directive?: string;
}

/** The cowork PORT: a model-neutral transport, one method. It knows nothing
 *  about storyboards or prompts — only how to turn messages into text. mock
 *  ($0 deterministic) / fal (OpenRouter→Claude) / self-hosted-later are classes.
 *  `skillId` is carried so the mock dispatches by identity, never by sniffing
 *  prompt text; `opts.mockReply` lets a skill supply its $0 canned reply. */
export interface CoworkTransport {
  readonly name: string;                                   // "mock" | "fal:llm"
  chat(
    skillId: string,
    messages: ChatMessage[],
    opts?: { mockReply?: () => string; responseFormat?: "json_object"; maxTokens?: number },
  ): Promise<{ text: string }>;
}

export const MAX_PLAN_STEPS = 8;
export const COWORK_MEMORY_TURNS = 8;

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

export const coworkTurnSchema = z.object({
  planSteps: z.array(z.string().trim().min(1).transform((s) => s.slice(0, 200))).transform((arr) => arr.slice(0, MAX_PLAN_STEPS)).default([]),
  reply: z.string().trim().min(1).transform((s) => s.slice(0, 2000)),
  // Optional LLM auto-title (≤6 words) summarizing the conversation, emitted in the
  // SAME planner JSON ($0). Truncating transform mirrors the schema's other coercing
  // fields; absent → coworkTurn falls back to the user's first message.
  title: z.string().trim().min(1).transform((s) => s.slice(0, 80)).optional(),
  proposal: coworkProposalSchema.nullable().default(null),
}).strict();
export type CoworkTurn = z.infer<typeof coworkTurnSchema>;
