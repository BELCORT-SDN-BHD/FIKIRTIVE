/**
 * Cowork SKILLS — the per-skill runners (the de-tangle of the old provider).
 * A skill owns its knowledge (system prompt), how it assembles messages, how it
 * parses the (untrusted) LLM text, and its $0 deterministic mock reply. The
 * transport (cowork-transport.ts) ships the messages; the action stays the thin
 * money-safety boundary. Lightweight on purpose — no Skill<I,O>/registry yet
 * (deferred until a third skill needs a generic surface).
 */
import {
  coworkPlan,
  COWORK_MAX_SCENES,
  COWORK_MAX_SHOTS_PER_SCENE,
  MAX_ENHANCE_TEXT,
  type ChatMessage,
  type CoworkPlan,
  type CoworkTransport,
  type SkillCtx,
} from "./cowork.js";

/** A cowork skill: knowledge + message assembly + parse + $0 mock reply. Both
 *  current skills take a single string input (idea / text); output varies. The
 *  optional `ctx` carries runner-injected knowledge (the enhance directive). */
export interface CoworkSkill<O> {
  readonly id: string;
  buildMessages(input: string, ctx?: SkillCtx): ChatMessage[];
  parse(text: string): O;
  /** Deterministic, offline reply the MockTransport returns (parsed like a real
   *  one) — keeps the $0 dev contract while the transport stays skill-agnostic. */
  mockReply(input: string): string;
}

/** The generic spine: assemble → transport.chat → parse. The skill's mockReply
 *  is handed to the transport so the mock dispatches by identity, not by text.
 *  `ctx` (e.g. the resolved directive) flows into buildMessages. */
export async function runSkill<O>(skill: CoworkSkill<O>, input: string, transport: CoworkTransport, ctx?: SkillCtx): Promise<O> {
  const { text } = await transport.chat(skill.id, skill.buildMessages(input, ctx), { mockReply: () => skill.mockReply(input) });
  return skill.parse(text);
}

/** Pull the first `{` … last `}` out of an LLM reply (strips prose/markdown fences). */
function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("cowork: no JSON object in the LLM output");
  return JSON.parse(text.slice(start, end + 1));
}

const STORYBOARD_SYSTEM =
  `You are a film director's assistant. Break the user's idea into a concise storyboard. ` +
  `Respond with ONLY a JSON object, no prose: {"scenes":[{"title":"string","shots":[{"prompt":"string"}]}]}. ` +
  `Each shot "prompt" is a vivid, self-contained visual description (subject, framing, camera, lighting, mood) for an image generator — not dialogue. ` +
  `At most ${COWORK_MAX_SCENES} scenes and ${COWORK_MAX_SHOTS_PER_SCENE} shots per scene — treat that as a hard ceiling, not a target: use the FEWEST shots that tell the story; most ideas need far fewer. Do not pad. ` +
  `Every shot must earn its place — no two shots may repeat the same subject + framing + lighting beat; merge or cut redundant beats. ` +
  `Keep one consistent visual palette and style across all shots unless the idea explicitly calls for contrast; don't drop in a one-off look (e.g. a lone black-and-white shot in a colour film) without a narrative reason. ` +
  `Order shots so any setup or problem is established before its payoff, unless the idea calls for a cold open. ` +
  `Keep it tight and shootable.`;

/** Draft a storyboard from a free-text idea. No per-model knowledge. */
export const draftStoryboardSkill: CoworkSkill<CoworkPlan> = {
  id: "draftStoryboard",
  buildMessages(idea: string): ChatMessage[] {
    return [
      { role: "system", content: STORYBOARD_SYSTEM },
      { role: "user", content: idea },
    ];
  },
  parse(text: string): CoworkPlan {
    return coworkPlan.parse(extractJson(text)) as CoworkPlan;
  },
  mockReply(idea: string): string {
    const subject = idea.trim().replace(/\s+/g, " ").slice(0, 140);
    const beats = [
      "establishing wide shot",
      "medium shot introducing the subject",
      "close-up on a telling detail",
      "an emotional beat / reaction",
      "closing wide shot",
    ];
    return JSON.stringify({
      scenes: [{ title: "Scene 1", shots: beats.map((b) => ({ prompt: `${b} — ${subject}, cinematic lighting` })) }],
    });
  },
};

const ENHANCE_SYSTEM =
  `You rewrite a short shot description into ONE vivid, detailed prompt for an image/video generator. ` +
  `Add subject specificity, framing, camera, lighting, and mood. Keep every named subject/entity EXACTLY as written (verbatim). ` +
  `Elaborate only what the input implies — do NOT invent new physical objects, props, characters, or actions the user didn't mention or clearly imply; when the input is sparse, deepen the described elements (light, framing, texture, mood) rather than adding scene contents. ` +
  `Return ONLY the rewritten prompt — no quotes, no preamble, no options, no markdown.`;

/** Rewrite a rough prompt into a vivid one, keeping named entities verbatim. */
export const enhancePromptSkill: CoworkSkill<string> = {
  id: "enhancePrompt",
  buildMessages(text: string, ctx?: SkillCtx): ChatMessage[] {
    // Phase 1: the server-resolved per-(family×mode) directive is appended to the
    // base prompt. Absent/blank → the base prompt byte-for-byte (parity). The
    // i2v "describe motion not scene" rule rides in the directive text, not code.
    const directive = ctx?.directive?.trim();
    const system = directive ? `${ENHANCE_SYSTEM}\n\nModel-specific guidance for this generation: ${directive}` : ENHANCE_SYSTEM;
    return [
      { role: "system", content: system },
      { role: "user", content: text },
    ];
  },
  parse(text: string): string {
    const out = text.trim();
    if (!out) throw new Error("cowork: empty enhancement from the LLM");
    // The skill owns its output contract: ≤ MAX_ENHANCE_TEXT so the rewrite can't
    // overflow the downstream genRequest cap. The old FAL provider clamped here;
    // the old mock relied on the action's clamp. Unifying it on the skill makes
    // the prod (fal) path byte-exact and the action's re-clamp purely defensive.
    // (The only divergence vs old mock is a ≤1 trailing-whitespace char on a
    // pathological >~1950-char dev input — immaterial to a generator prompt.)
    return out.slice(0, MAX_ENHANCE_TEXT);
  },
  mockReply(text: string): string {
    // keeps the original text (and any @-named entities) verbatim, only appends
    // cinematic qualifiers — proves the scaffolding at $0
    const base = text.trim().replace(/\s+/g, " ");
    return `${base}, cinematic lighting, shallow depth of field, rich detail, dynamic composition`;
  },
};
