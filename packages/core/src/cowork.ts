/**
 * Artlio cowork — the agent (the product's differentiator). v1 skill: draft a
 * storyboard from an idea. The provider port mirrors the generation provider:
 * a mock for dev ($0, deterministic) and a real LLM for prod (fal, reusing
 * FAL_KEY). cowork manipulates the project through the SAME server actions a
 * user would, so anything it does, the user could undo.
 */
import { z } from "zod";
import { GEN_KINDS } from "./gen.js";

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
export type ChatMessage = { role: "system" | "user"; content: string };

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
  chat(skillId: string, messages: ChatMessage[], opts?: { mockReply?: () => string }): Promise<{ text: string }>;
}
