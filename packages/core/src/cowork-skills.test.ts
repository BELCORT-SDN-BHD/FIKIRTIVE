import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { draftStoryboardSkill, enhancePromptSkill, runSkill } from "./cowork-skills.js";
import type { ChatMessage, CoworkTransport } from "./cowork.js";

// A $0 stand-in for MockTransport so these skill tests stay independent of the
// transport module — it does exactly what MockTransport does: return the skill's
// own canned reply. (The real MockTransport is pinned in cowork-transport.test.)
const fakeMock: CoworkTransport = {
  name: "mock",
  async chat(_skillId: string, _messages: ChatMessage[], opts?: { mockReply?: () => string }) {
    if (!opts?.mockReply) throw new Error("test fakeMock: missing mockReply");
    return { text: opts.mockReply() };
  },
};

const STORYBOARD_SYSTEM =
  `You are a film director's assistant. Break the user's idea into a concise storyboard. ` +
  `Respond with ONLY a JSON object, no prose: {"scenes":[{"title":"string","shots":[{"prompt":"string"}]}]}. ` +
  `Each shot "prompt" is a vivid, self-contained visual description (subject, framing, camera, lighting, mood) for an image generator — not dialogue. ` +
  `At most 6 scenes and 8 shots per scene. Keep it tight and shootable.`;

const ENHANCE_SYSTEM =
  `You rewrite a short shot description into ONE vivid, detailed prompt for an image/video generator. ` +
  `Add subject specificity, framing, camera, lighting, and mood. Keep every named subject/entity EXACTLY as written (verbatim). ` +
  `Return ONLY the rewritten prompt — no quotes, no preamble, no options, no markdown.`;

describe("draftStoryboardSkill", () => {
  it("buildMessages: exact system prompt (6 scenes / 8 shots) + user idea", () => {
    const msgs = draftStoryboardSkill.buildMessages("a lone dog");
    expect(msgs).toEqual([
      { role: "system", content: STORYBOARD_SYSTEM },
      { role: "user", content: "a lone dog" },
    ]);
  });

  it("parse: strips prose around the JSON object (first { … last })", () => {
    const text = 'Sure!\n```json\n{"scenes":[{"title":"S","shots":[{"prompt":"a wide shot"}]}]}\n```';
    expect(draftStoryboardSkill.parse(text)).toEqual({
      scenes: [{ title: "S", shots: [{ prompt: "a wide shot" }] }],
    });
  });

  it("parse: no JSON object → throws the exact error", () => {
    expect(() => draftStoryboardSkill.parse("just prose, no braces")).toThrow(
      "cowork: no JSON object in the LLM output",
    );
  });

  it("parse: over-cap plan (7 scenes) → ZodError", () => {
    const scenes = Array.from({ length: 7 }, (_, i) => ({ title: `S${i}`, shots: [{ prompt: "x" }] }));
    expect(() => draftStoryboardSkill.parse(JSON.stringify({ scenes }))).toThrow(ZodError);
  });

  it("mock round-trip via runSkill: byte-for-byte the legacy MockCoworkProvider plan", async () => {
    const beats = [
      "establishing wide shot",
      "medium shot introducing the subject",
      "close-up on a telling detail",
      "an emotional beat / reaction",
      "closing wide shot",
    ];
    const golden = {
      scenes: [{ title: "Scene 1", shots: beats.map((b) => ({ prompt: `${b} — a lone dog, cinematic lighting` })) }],
    };
    expect(await runSkill(draftStoryboardSkill, "a lone dog", fakeMock)).toEqual(golden);
  });

  it("mock: collapses whitespace and caps subject at 140 chars (legacy behavior)", async () => {
    const plan = await runSkill(draftStoryboardSkill, "  a   spaced    idea  ", fakeMock);
    expect(plan.scenes[0]?.shots[0]?.prompt).toBe("establishing wide shot — a spaced idea, cinematic lighting");
  });
});

describe("enhancePromptSkill", () => {
  it("buildMessages: exact system prompt + user text", () => {
    const msgs = enhancePromptSkill.buildMessages("a cat");
    expect(msgs).toEqual([
      { role: "system", content: ENHANCE_SYSTEM },
      { role: "user", content: "a cat" },
    ]);
  });

  it("parse: trims; empty → throws; clamps to 2000 (skill owns the cap, fal-path exact)", () => {
    expect(enhancePromptSkill.parse("  hi  ")).toBe("hi");
    expect(() => enhancePromptSkill.parse("   ")).toThrow("cowork: empty enhancement from the LLM");
    // intentional: the 2000-cap (old FAL provider) now lives in parse for EVERY
    // transport. Prod (fal) is byte-exact; old mock relied on the action's clamp,
    // so a >2000 dev-mock output can differ by ≤1 trailing-ws char — immaterial.
    expect(enhancePromptSkill.parse("x".repeat(2100))).toHaveLength(2000);
  });

  it("mock round-trip via runSkill: legacy MockCoworkProvider suffix, whitespace collapsed", async () => {
    expect(await runSkill(enhancePromptSkill, "  a  cat  ", fakeMock)).toBe(
      "a cat, cinematic lighting, shallow depth of field, rich detail, dynamic composition",
    );
  });

  it("buildMessages: a directive (Phase 1) is appended to the system prompt", () => {
    const msgs = enhancePromptSkill.buildMessages("a cat", { directive: "Use natural language, not tag soup." });
    expect(msgs[0]).toEqual({
      role: "system",
      content: `${ENHANCE_SYSTEM}\n\nModel-specific guidance for this generation: Use natural language, not tag soup.`,
    });
    expect(msgs[1]).toEqual({ role: "user", content: "a cat" });
  });

  it("buildMessages: no/blank directive → byte-identical base prompt (parity)", () => {
    expect(enhancePromptSkill.buildMessages("a cat")[0]?.content).toBe(ENHANCE_SYSTEM);
    expect(enhancePromptSkill.buildMessages("a cat", {})[0]?.content).toBe(ENHANCE_SYSTEM);
    expect(enhancePromptSkill.buildMessages("a cat", { directive: "   " })[0]?.content).toBe(ENHANCE_SYSTEM);
  });

  it("mock path ignores the directive (mock doesn't read messages)", async () => {
    expect(await runSkill(enhancePromptSkill, "a cat", fakeMock, { directive: "anything" })).toBe(
      "a cat, cinematic lighting, shallow depth of field, rich detail, dynamic composition",
    );
  });
});

describe("draftStoryboardSkill ctx", () => {
  it("buildMessages ignores ctx (storyboard has no per-model knowledge)", () => {
    const a = draftStoryboardSkill.buildMessages("an idea");
    const b = draftStoryboardSkill.buildMessages("an idea", { directive: "X" });
    expect(a).toEqual(b);
  });
});
