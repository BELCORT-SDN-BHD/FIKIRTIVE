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
  it("built tool returns the assembled prompt (additive result: strategy/variants/checklist ride along)", async () => {
    const invoke = seedreamPromptSkill.tool as unknown as { invoke: (rc: unknown, a: string) => Promise<any> };
    const out = await invoke.invoke({ context: {} }, JSON.stringify({ subject: "a red apple" }));
    expect(out.prompt).toBe("a red apple"); // rendering contract kept: prompt is unchanged
    expect(out.strategy).toMatchObject({ kind: "route", family: "generalCreative" }); // open-ended fallback
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

describe("seedreamPromptInput — language enforcement (复审 P1-B 镜像：声明变执法)", () => {
  it("REJECTS a majority-Chinese image prompt (judge counterexample now fails closed)", () => {
    const r = seedreamPromptInput.safeParse({ subject: "一瓶磨砂玻璃精华液，摆在大理石台面上" });
    expect(r.success).toBe(false);
    if (!r.success) expect(JSON.stringify(r.error.issues)).toMatch(/ENGLISH/);
  });
  it("accepts English free text; a proper-noun CJK fragment inside majority-English text passes", () => {
    expect(seedreamPromptInput.safeParse({
      subject: "a frosted-glass serum bottle labelled 精华 on a marble counter",
      style: "editorial photography",
    }).success).toBe(true);
  });
  it("textContent stays exempt — in-image text may be any language", () => {
    expect(seedreamPromptInput.safeParse({
      subject: "a red festive poster", textContent: "新年快乐",
    }).success).toBe(true);
  });
  it("R3 class closure: wholly-Cyrillic subject REJECTED (was 'neither' → passed both engines)", () => {
    const r = seedreamPromptInput.safeParse({ subject: "матовая чёрная бутылка на мраморной столешнице" });
    expect(r.success).toBe(false);
    if (!r.success) expect(JSON.stringify(r.error.issues)).toMatch(/ENGLISH/);
  });
  it("purely numeric/ratio token fields are NOT punished (cameraLens '50mm', detail '16:9, 4K')", () => {
    expect(seedreamPromptInput.safeParse({
      subject: "a red apple", cameraLens: "50mm", detail: "16:9, 4K",
    }).success).toBe(true);
  });
  it("REJECTS a Chinese editTarget in i2i mode", () => {
    expect(seedreamPromptInput.safeParse({
      mode: "i2i", subject: "the source image", editVerb: "Replace", editTarget: "背景换成海滩日落",
    }).success).toBe(false);
  });
});

describe("seedreamPrompt SKILL wiring (复审 P1-A：策略/变体/清单随 skill 执行返回)", () => {
  const invoke = seedreamPromptSkill.tool as unknown as { invoke: (rc: unknown, a: string) => Promise<any> };
  const realistic = {
    userIntent: "product launch ad for my chili sauce",
    subject: "a jar of chili sauce on a rustic wooden table",
    style: "product photography",
    lighting: "natural window light from the left",
    cameraLens: "50mm",
    references: [{ role: "product", name: "the Classic Jar", lock: true }],
  };

  it("a realistic request yields 2-3 meaningfully-different variants that PASS checkVariantSet", async () => {
    const out = await invoke.invoke({ context: {} }, JSON.stringify(realistic));
    expect(out.variants.length).toBeGreaterThanOrEqual(2);
    expect(out.variants.length).toBeLessThanOrEqual(3);
    const axes = out.variants.map((v: { axis: string }) => v.axis);
    expect(new Set(axes).size).toBe(axes.length);
    expect(out.variantCheck).toEqual({ ok: true, problems: [] });
    for (const v of out.variants) {
      expect(v.prompt).toContain("a jar of chili sauce"); // user content untouched
      expect(v.prompt).toContain("feature the Classic Jar exactly as in the reference"); // identity kept
    }
  });
  it("routes strategy from userIntent + roles and attaches the asset checklist", async () => {
    const out = await invoke.invoke({ context: {} }, JSON.stringify(realistic));
    expect(out.strategy).toMatchObject({ kind: "route", family: "ecommerce" });
    expect(out.assetChecklist).toEqual([
      expect.objectContaining({ role: "product", name: "the Classic Jar", ready: true }),
    ]);
  });
  it("mode:'i2i' returns a single prompt (one change per call), no variants", async () => {
    const out = await invoke.invoke({ context: {} }, JSON.stringify({
      mode: "i2i", subject: "the source image", editVerb: "Replace",
      editTarget: "the background with a beach sunset", userIntent: "swap the backdrop",
    }));
    expect(out.variants).toBeUndefined();
    expect(typeof out.prompt).toBe("string");
  });
});
