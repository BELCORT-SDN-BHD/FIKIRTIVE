import { describe, it, expect } from "vitest";
import { assembleSeedream, seedreamPromptInput } from "./seedream-prompt.helpers.js";
import { seedreamPromptSkill } from "./seedream-prompt.js";

const CJK = /[一-鿿]/;

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
    expect(out).toContain("feature the AeroBottle exactly as in the reference");
  });
  it("i2i mode builds an edit instruction, not a fresh scene", () => {
    const out = assembleSeedream(seedreamPromptInput.parse({
      mode: "i2i", subject: "the source image", editVerb: "Replace", editTarget: "the background with a beach sunset",
      preserve: "preserve all foreground elements exactly",
    }));
    expect(out.startsWith("Replace the background with a beach sunset")).toBe(true);
    expect(out).toContain("preserve all foreground elements exactly");
  });
  it("language rule: image path scaffold stays English — no Chinese in assembled output (语言按引擎定)", () => {
    const t2i = assembleSeedream(seedreamPromptInput.parse({
      subject: "a frosted-glass serum bottle",
      style: "editorial photography",
      lighting: "morning window light from the right",
      references: [{ role: "product", name: "the SerumBottle" }, { role: "character", name: "Mia", lock: false }],
      forVideo: true,
    }));
    const i2i = assembleSeedream(seedreamPromptInput.parse({
      mode: "i2i", subject: "the source image", editVerb: "Change", editTarget: "the shirt color to sage green",
    }));
    expect(CJK.test(t2i)).toBe(false);
    expect(CJK.test(i2i)).toBe(false);
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
  it("description carries concrete lighting/style vocabulary, English only", () => {
    expect(seedreamPromptSkill.description).toContain("golden hour");
    expect(seedreamPromptSkill.description).toContain("cinematic");
    expect(seedreamPromptSkill.description).not.toContain("推镜头");
  });
  it("description gates i2i on an @-entity source (guards spend on bare priors)", () => {
    expect(seedreamPromptSkill.description).toContain(
      "Use mode:'i2i' ONLY when an @-referenced entity supplies the source image (pass its id via propose's entityIds); to change a prior generation with no entity, use t2i instead."
    );
  });
  it("description states the English-language rule for the image engine", () => {
    expect(seedreamPromptSkill.description).toContain("ENGLISH");
  });
});
