import { describe, it, expect } from "vitest";
import { composePrompt, COMPOSE_SEP } from "./cowork-compose.js";
import { MAX_GEN_PROMPT } from "./gen.js";

const DIR = "Lead with MOTION and CAMERA.";

describe("composePrompt", () => {
  it("appends the directive exactly once after the separator", () => {
    const out = composePrompt({ prompt: "a calm sea", directive: DIR, maxLen: MAX_GEN_PROMPT });
    expect(out).toBe(`a calm sea${COMPOSE_SEP}${DIR}`);
    expect(out.split(DIR)).toHaveLength(2); // directive appears once
  });
  it("is idempotent — composing an already-composed prompt does NOT double-append", () => {
    const once = composePrompt({ prompt: "a calm sea", directive: DIR, maxLen: MAX_GEN_PROMPT });
    const twice = composePrompt({ prompt: once, directive: DIR, maxLen: MAX_GEN_PROMPT });
    expect(twice).toBe(once); // the directive is already present at the tail → no-op
  });
  it("no directive (undefined/empty) → returns the prompt unchanged (no-op for unseeded families)", () => {
    expect(composePrompt({ prompt: "a calm sea", directive: undefined, maxLen: MAX_GEN_PROMPT })).toBe("a calm sea");
    expect(composePrompt({ prompt: "a calm sea", directive: "", maxLen: MAX_GEN_PROMPT })).toBe("a calm sea");
    expect(composePrompt({ prompt: "a calm sea", directive: "   ", maxLen: MAX_GEN_PROMPT })).toBe("a calm sea");
  });
  it("clamps the composed result to maxLen (never exceeds the typed prompt cap)", () => {
    const longPrompt = "x".repeat(MAX_GEN_PROMPT);
    const out = composePrompt({ prompt: longPrompt, directive: DIR, maxLen: MAX_GEN_PROMPT });
    expect(out.length).toBeLessThanOrEqual(MAX_GEN_PROMPT);
  });
  it("is byte-stable (no LLM, no randomness) — same inputs → same output", () => {
    const a = composePrompt({ prompt: "hi", directive: DIR, maxLen: MAX_GEN_PROMPT });
    const b = composePrompt({ prompt: "hi", directive: DIR, maxLen: MAX_GEN_PROMPT });
    expect(a).toBe(b);
  });
});
