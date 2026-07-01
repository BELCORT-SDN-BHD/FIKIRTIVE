import { describe, it, expect } from "vitest";
import { assembleSeedream, seedreamPromptInput } from "./seedream-prompt.helpers.js";
import { seedreamPromptSkill } from "./seedream-prompt.js";

describe("assembleSeedream", () => {
  it("t2i joins present fields in order, subject first", () => {
    const out = assembleSeedream(seedreamPromptInput.parse({
      subject: "a matte-black wireless headphone",
      environment: "cream gradient background",
      style: "premium product photography",
      lighting: "soft box from upper-left",
    }));
    expect(out.startsWith("a matte-black wireless headphone")).toBe(true);
    expect(out).toContain("premium product photography");
    // subject before style
    expect(out.indexOf("headphone")).toBeLessThan(out.indexOf("premium"));
  });
  it("forVideo appends the animatable-frame clause", () => {
    const out = assembleSeedream(seedreamPromptInput.parse({ subject: "a shoe", forVideo: true }));
    expect(out).toContain("clean uncluttered composition with headroom for motion");
  });
  it("textContent is quoted and placed last", () => {
    const out = assembleSeedream(seedreamPromptInput.parse({ subject: "a poster", textContent: "50% OFF" }));
    expect(out).toContain('with the text "50% OFF"');
    expect(out.trim().endsWith("placed prominently")).toBe(true);
  });
  it("references weave an identity-lock clause after 'featuring'", () => {
    const out = assembleSeedream(seedreamPromptInput.parse({
      subject: "a hero shot",
      references: [{ role: "product", name: "the AeroBottle" }],
    }));
    expect(out).toContain("featuring feature the AeroBottle exactly as in the reference");
  });
  it("i2i mode builds an edit instruction, not a fresh scene", () => {
    const out = assembleSeedream(seedreamPromptInput.parse({
      mode: "i2i", subject: "the source image", editVerb: "Replace", editTarget: "the background with a beach sunset",
      preserve: "preserve all foreground elements exactly",
    }));
    expect(out.startsWith("Replace the background with a beach sunset")).toBe(true);
    expect(out).toContain("preserve all foreground elements exactly");
  });
});

describe("seedreamPromptSkill gate", () => {
  it("free/read/internal → not gated, no requires", () => {
    expect(seedreamPromptSkill.cost).toBe("free");
    expect(seedreamPromptSkill.effect).toBe("read");
    expect(seedreamPromptSkill.needsApproval).toBe(false);
    expect(seedreamPromptSkill.requires).toEqual([]);
  });
  it("built tool returns { prompt } from assembly", async () => {
    const invoke = seedreamPromptSkill.tool as unknown as { invoke: (rc: unknown, a: string) => Promise<unknown> };
    const out = await invoke.invoke({ context: {} }, JSON.stringify({ subject: "a red apple" }));
    expect(out).toEqual({ prompt: "a red apple" });
  });
});
