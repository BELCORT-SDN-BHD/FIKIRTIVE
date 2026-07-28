import { describe, it, expect } from "vitest";
import { assembleSeedream, seedreamPromptInput, seedreamLanguageAdvice } from "./seedream-prompt.helpers.js";
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

describe("seedreamPromptInput — language is NEVER a rejection (R4：硬语言门撤除)", () => {
  const advice = (input: unknown) => seedreamLanguageAdvice(seedreamPromptInput.parse(input));

  it("THE JUDGE'S COUNTEREXAMPLE: 'a product photo 辣椒酱' passes (a gate must not block good input)", () => {
    const input = { subject: "a product photo 辣椒酱" };
    expect(seedreamPromptInput.safeParse(input).success).toBe(true);
    expect(() => advice(input)).not.toThrow();
  });
  it("a majority-Chinese image prompt PASSES and yields an advisory instead of an error", () => {
    const input = { subject: "一瓶磨砂玻璃精华液，摆在大理石台面上" };
    expect(seedreamPromptInput.safeParse(input).success).toBe(true);
    expect(advice(input)).toMatch(/English/);
  });
  it("the advisory names the engine neutrally and proposes a rewrite, never a refusal", () => {
    const out = advice({ subject: "一瓶磨砂玻璃精华液" })!;
    expect(out).toContain("the image engine performs best with an English prompt body");
    expect(out).toMatch(/consider rewriting/);
    expect(out).not.toMatch(/reject|error|invalid/i);
  });
  it("English free text with a CJK proper-noun fragment → no advisory", () => {
    const input = {
      subject: "a frosted-glass serum bottle labelled 精华 on a marble counter",
      style: "editorial photography",
    };
    expect(seedreamPromptInput.safeParse(input).success).toBe(true);
    expect(advice(input)).toBeUndefined();
  });
  it("Japanese kana text and a Chinese editTarget both PASS (no script is refused any more)", () => {
    expect(seedreamPromptInput.safeParse({ subject: "大理石のカウンターに置かれた化粧水の瓶" }).success).toBe(true);
    expect(seedreamPromptInput.safeParse({
      mode: "i2i", subject: "the source image", editVerb: "Replace", editTarget: "背景换成海滩日落",
    }).success).toBe(true);
  });
  it("textContent never drives the advisory — in-image text may be any language", () => {
    const input = { subject: "a red festive poster on a wooden door", textContent: "新年快乐" };
    expect(seedreamPromptInput.safeParse(input).success).toBe(true);
    expect(advice(input)).toBeUndefined();
  });
  it("purely numeric/measure fields need no exemption rule — they simply produce no advisory", () => {
    const input = { subject: "a red apple", cameraLens: "50mm", detail: "16:9, 4K" };
    expect(seedreamPromptInput.safeParse(input).success).toBe(true);
    expect(advice(input)).toBeUndefined();
  });
  it("SKILL result: a Chinese body rides back with languageAdvice; an English body has none", async () => {
    const invoke = seedreamPromptSkill.tool as unknown as { invoke: (rc: unknown, a: string) => Promise<any> };
    const zh = await invoke.invoke({ context: {} }, JSON.stringify({ subject: "一瓶磨砂玻璃精华液" }));
    expect(zh.prompt).toContain("一瓶磨砂玻璃精华液"); // 不改写用户内容
    expect(zh.languageAdvice).toMatch(/English/);
    const en = await invoke.invoke({ context: {} }, JSON.stringify({ subject: "a red apple" }));
    expect(en.languageAdvice).toBeUndefined();
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
