import { describe, it, expect } from "vitest";
import { assembleSeedream, seedreamPromptInput } from "./seedream-prompt.helpers.js";
import { seedreamPromptSkill } from "./seedream-prompt.js";

describe("assembleSeedream", () => {
  it("t2i writes present fields as sentences, subject first", () => {
    const out = assembleSeedream(seedreamPromptInput.parse({
      subject: "a matte-black wireless headphone",
      environment: "cream gradient background",
      style: "premium product photography",
      lighting: "soft box from upper-left",
    }));
    expect(out.startsWith("A matte-black wireless headphone.")).toBe(true);
    expect(out).toContain("premium product photography");
    // subject before style
    expect(out.indexOf("headphone")).toBeLessThan(out.indexOf("premium"));
  });
  it("forVideo appends the animatable-frame clause", () => {
    const out = assembleSeedream(seedreamPromptInput.parse({ subject: "a shoe", forVideo: true }));
    expect(out).toContain("Leave clean, uncluttered space around the subject with headroom for motion");
  });
  it("textContent is quoted and placed last", () => {
    const out = assembleSeedream(seedreamPromptInput.parse({ subject: "a poster", textContent: "50% OFF" }));
    expect(out).toContain('Render the text "50% OFF"');
    expect(out.trim().endsWith("placed prominently.")).toBe(true);
  });
  it("references weave an identity-lock clause", () => {
    const out = assembleSeedream(seedreamPromptInput.parse({
      subject: "a hero shot",
      references: [{ role: "product", name: "the AeroBottle" }],
    }));
    expect(out).toContain("feature the AeroBottle exactly as in that reference");
  });
  it("i2i mode builds an edit instruction, not a fresh scene", () => {
    const out = assembleSeedream(seedreamPromptInput.parse({
      mode: "i2i", subject: "the source image", editVerb: "Replace", editTarget: "the background with a beach sunset",
      preserve: "preserve all foreground elements exactly",
    }));
    expect(out.startsWith("Replace the background with a beach sunset.")).toBe(true);
    expect(out).toContain("Preserve all foreground elements exactly.");
  });

  // ── #774 U1 成句装配 ─────────────────────────────────────────────────────
  // 官方指南把「逗号串关键词」列为 Avoid 反例。这两条钉住的是**说法**变了：
  // 每个要素自成一句，且再没有一处是靠逗号把两个不相干的要素粘在一起。
  describe("#774 U1 — coherent sentences, not a comma-joined tag list", () => {
    const full = () => assembleSeedream(seedreamPromptInput.parse({
      subject: "a ceramic mug",
      actionPose: "steaming on a linen cloth",
      environment: "a sunlit kitchen counter",
      style: "editorial photography",
      lighting: "natural window light from the left",
      colorPalette: "warm neutrals",
      cameraLens: "50mm at f/2",
      mood: "quiet and unhurried",
      detail: "visible steam curling off the surface",
    }));
    it("every element lands in its own sentence", () => {
      const out = full();
      for (const s of [
        "A ceramic mug, steaming on a linen cloth.",
        "The setting is a sunlit kitchen counter.",
        "The style is editorial photography, the light is natural window light from the left, the color palette is warm neutrals.",
        "Shot with 50mm at f/2.",
        "The mood is quiet and unhurried.",
        "Visible steam curling off the surface.",
      ]) expect(out).toContain(s);
    });
    it("no sentence-less tail: the whole prompt ends on a full stop", () => {
      expect(full().trim().endsWith(".")).toBe(true);
    });
    it("no bare field-to-field comma splice (the old join(', ') shape)", () => {
      // 旧装配把「主体, 场景, 风格, 光线」直接串起来 —— 反例串在这条里再也拼不出来。
      expect(full()).not.toContain("a sunlit kitchen counter, editorial photography");
    });
  });

  // ── #774 U2 参考图编号 ────────────────────────────────────────────────────
  // 编号必须与真实发送顺序一致；错位比不编号更糟，所以这里逐位钉死。
  describe("#774 U2 — <Image_N> numbering follows the real send order", () => {
    const threeRefs = [
      { role: "character" as const, name: "Mia" },
      { role: "product" as const, name: "the AeroBottle" },
      { role: "brandmark" as const, name: "AeroCo" },
    ];
    it("no base image → references start at <Image_1>, in array order", () => {
      const out = assembleSeedream(seedreamPromptInput.parse({ subject: "a hero shot", references: threeRefs }));
      expect(out).toContain("Define the person in <Image_1> as <Subject_1>: keep Mia identical to that reference");
      expect(out).toContain("Define the product in <Image_2> as <Subject_2>: feature the AeroBottle exactly");
      expect(out).toContain("Define the logo in <Image_3> as <Subject_3>: reproduce the AeroCo logo exactly");
      expect(out).not.toContain("<Image_4>");
    });
    it("baseImage:true → the edited image is <Image_1> and references shift to <Image_2>…", () => {
      const out = assembleSeedream(seedreamPromptInput.parse({
        subject: "a hero shot", baseImage: true, references: threeRefs,
      }));
      expect(out).toContain("<Image_1> is the image being edited.");
      expect(out).toContain("Define the person in <Image_2> as <Subject_2>: keep Mia identical");
      expect(out).toContain("Define the product in <Image_3> as <Subject_3>");
      expect(out).toContain("Define the logo in <Image_4> as <Subject_4>");
    });
    it("every numbered clause also names the entity — a misnumber degrades, it does not lie", () => {
      const out = assembleSeedream(seedreamPromptInput.parse({ subject: "x", references: threeRefs }));
      for (const name of ["Mia", "the AeroBottle", "AeroCo"]) expect(out).toContain(name);
    });
    it("lock:false numbers the slot but asks only for style, not identity", () => {
      const out = assembleSeedream(seedreamPromptInput.parse({
        subject: "a hero shot",
        references: [{ role: "location", name: "the loft", lock: false }],
      }));
      expect(out).toContain("Draw stylistic inspiration from <Image_1> (the loft); do not copy its subject.");
    });
    it("no references → no numbering at all", () => {
      expect(assembleSeedream(seedreamPromptInput.parse({ subject: "a red apple" }))).not.toContain("<Image_");
    });
    it("i2i numbers its references too", () => {
      const out = assembleSeedream(seedreamPromptInput.parse({
        mode: "i2i", subject: "s", editVerb: "Add", editTarget: "the bottle to the table",
        baseImage: true, references: [{ role: "product", name: "the AeroBottle" }],
      }));
      expect(out).toContain("<Image_1> is the image being edited.");
      expect(out).toContain("<Image_2>");
    });
  });

  // ── #774 U4 竖版防字幕（图片侧同样长鬼字幕）────────────────────────────────
  describe("#774 U4 — a vertical frame gets the caption-free guard", () => {
    it("9:16 adds it", () => {
      const out = assembleSeedream(seedreamPromptInput.parse({ subject: "a poster", aspect: "9:16" }));
      expect(out).toContain("Keep the frame free of subtitles, captions, and watermarks.");
    });
    it("'portrait' and '9x16' are the same shape", () => {
      for (const a of ["portrait", "vertical", "9x16", "9 : 16"]) {
        expect(assembleSeedream(seedreamPromptInput.parse({ subject: "a poster", aspect: a })))
          .toContain("Keep the frame free of subtitles");
      }
    });
    it("16:9 / 1:1 / no aspect do not", () => {
      for (const a of ["16:9", "1:1", undefined]) {
        expect(assembleSeedream(seedreamPromptInput.parse({ subject: "a poster", ...(a ? { aspect: a } : {}) })))
          .not.toContain("Keep the frame free of subtitles");
      }
    });
    it("an unrecognised shape is never guessed into vertical", () => {
      expect(assembleSeedream(seedreamPromptInput.parse({ subject: "a poster", aspect: "tallish" })))
        .not.toContain("Keep the frame free of subtitles");
    });
    it("the user asked for text on the image → no text ban", () => {
      const out = assembleSeedream(seedreamPromptInput.parse({
        subject: "a poster", aspect: "9:16", textContent: "50% OFF",
      }));
      expect(out).toContain('Render the text "50% OFF"');
      expect(out).not.toContain("Keep the frame free of subtitles");
    });
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
    expect(out).toEqual({ prompt: "A red apple." });
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
  // #774 U2 —— 编号的两条前提必须逐字写给 Otto，否则编号就是碰运气。
  it("description states the reference-order contract in words Otto can follow", () => {
    const d = seedreamPromptSkill.description;
    expect(d).toContain("SAME order as the ids you pass to propose's entityIds");
    expect(d).toContain("ONLY entities that actually have reference images");
    expect(d).toContain("a wrong order is worse");
    expect(d).toContain("than no numbering");
    expect(d).toContain("baseImage:true");
    // #802 地图硬规则：`>` 是导航路径分隔符族的一员，教学文案里写尖括号会被判成
    // 一条不存在的路。编号本身在装配结果里照写，描述面只用 `Image_1` 这种写法。
    expect(d).not.toContain("<Image_");
  });
  // #774 U4 —— 同一个形状要同时传给 propose 和这里，否则竖版防线不会被触发。
  it("description ties `aspect` to propose's desiredAspect", () => {
    expect(seedreamPromptSkill.description).toContain("SAME shape you will pass to propose's desiredAspect");
  });
  // #774 U8 —— 官方素材建议只提醒不强收（商家的 data 商家的权利）。
  it("advisory notes are returned, never enforced", async () => {
    const invoke = seedreamPromptSkill.tool as unknown as { invoke: (rc: unknown, a: string) => Promise<{ prompt: string; notes?: string[] }> };
    const many = Array.from({ length: 6 }, (_, n) => ({ role: "character", name: `P${n}` }));
    const out = await invoke.invoke({ context: {} }, JSON.stringify({ subject: "a group photo", references: many }));
    expect(out.notes?.length).toBeGreaterThan(0);
    // 提醒归提醒：六个参考一个不少地进了 prompt。
    for (let n = 0; n < 6; n++) expect(out.prompt).toContain(`P${n}`);
    expect(out.prompt).toContain("<Image_6>");
    expect(seedreamPromptSkill.description).toContain("they are advice, never a limit");
  });
  it("no advisory notes for an ordinary reference set", async () => {
    const invoke = seedreamPromptSkill.tool as unknown as { invoke: (rc: unknown, a: string) => Promise<Record<string, unknown>> };
    const out = await invoke.invoke({ context: {} }, JSON.stringify({
      subject: "a hero shot", references: [{ role: "product", name: "the AeroBottle" }],
    }));
    expect(out.notes).toBeUndefined();
  });
});
