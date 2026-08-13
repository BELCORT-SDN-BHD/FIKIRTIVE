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
    expect(out).toContain("Feature the AeroBottle exactly as in the reference");
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

  // ── #774 U2 r2 参考图身份 ─────────────────────────────────────────────────
  // 编号(<Image_N>)不在这一端产出 —— 写提示词时既不知道谁有几张活参考照，也不知道
  // 商家挂没挂底图，编出来就是碰运气，而这条错指令会一路走到付费调用。
  // 编号由真正装 `inputImageUrls` 的那段代码顺手产出，对表在
  // `apps/worker/src/jobs/gen-reference-budget.test.ts`（跑真的 handleGen）。
  // 这一端只负责名字这一层锁定，且**一个数字都不许写**。
  describe("#774 U2 — identity is locked by name here; numbers come from the sender", () => {
    const threeRefs = [
      { role: "character" as const, name: "Mia" },
      { role: "product" as const, name: "the AeroBottle" },
      { role: "brandmark" as const, name: "AeroCo" },
    ];
    it("every reference gets its own naming sentence", () => {
      const out = assembleSeedream(seedreamPromptInput.parse({ subject: "a hero shot", references: threeRefs }));
      expect(out).toContain("Keep Mia identical to the reference, same face, hairstyle, and build.");
      expect(out).toContain("Feature the AeroBottle exactly as in the reference, same shape, color, and label.");
      expect(out).toContain("Reproduce the AeroCo logo exactly as in the reference, unaltered.");
    });
    it("lock:false asks only for style, not identity", () => {
      const out = assembleSeedream(seedreamPromptInput.parse({
        subject: "a hero shot",
        references: [{ role: "location", name: "the loft", lock: false }],
      }));
      expect(out).toContain("Draw stylistic inspiration from the loft.");
    });
    it("NEVER writes an image number — not in t2i, not in i2i, not with many references", () => {
      for (const input of [
        { subject: "a hero shot", references: threeRefs },
        { subject: "a red apple" },
        { mode: "i2i", subject: "s", editVerb: "Add", editTarget: "the bottle to the table", references: threeRefs },
      ]) {
        const out = assembleSeedream(seedreamPromptInput.parse(input));
        expect(out).not.toMatch(/Image_\d/);
        expect(out).not.toMatch(/Subject_\d/);
      }
    });
  });

  // ── #774 r2 P2 —— 商家要求印在画面上的字，逐字保留 ──────────────────────────
  // U1 的成句归一(`sentence()` 会把内部空白压成一个空格)改的必须只是**我们的措辞**。
  // 商家写 `BUY\nNOW`，画面上就该是他写的那两行，不是我们替他改成的 `BUY NOW`。
  describe("#774 r2 — the merchant's literal on-image text is never rewritten", () => {
    it("keeps a line break inside the requested text", () => {
      const out = assembleSeedream(seedreamPromptInput.parse({ subject: "a poster", textContent: "BUY\nNOW" }));
      expect(out).toContain('Render the text "BUY\nNOW"');
      expect(out).not.toContain('Render the text "BUY NOW"');
    });
    it("keeps double spaces, tabs and unusual casing exactly as given", () => {
      for (const literal of ["50%  OFF", "OPEN\tDAILY", "nasi lemak  •  RM5"]) {
        const out = assembleSeedream(seedreamPromptInput.parse({ subject: "a poster", textContent: literal }));
        expect(out).toContain(`Render the text "${literal}"`);
      }
    });
    it("whitespace-only text is dropped, and then the vertical caption ban still applies", () => {
      const out = assembleSeedream(seedreamPromptInput.parse({ subject: "a poster", aspect: "9:16", textContent: "   " }));
      expect(out).not.toContain("Render the text");
      expect(out).toContain("Keep the frame free of subtitles");
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

    // 判官 r2 P2 —— 竖版 i2i 从 `return` 提前离场，拿不到这道防线，而描述承诺的是
    // 「竖版都加」。竖版长鬼字幕跟这张图是新造的还是改出来的无关，所以两条分支同一条规则。
    describe("i2i is vertical too — the edit branch gets the same guard", () => {
      const edit = (extra: Record<string, unknown> = {}) =>
        assembleSeedream(seedreamPromptInput.parse({
          mode: "i2i", subject: "the source image",
          editVerb: "Replace", editTarget: "the background with a beach sunset",
          ...extra,
        }));
      it("9:16 i2i adds it", () => {
        expect(edit({ aspect: "9:16" })).toContain("Keep the frame free of subtitles, captions, and watermarks.");
      });
      it("'portrait' / 'vertical' / '9x16' i2i are the same shape", () => {
        for (const a of ["portrait", "vertical", "9x16", "9 : 16"]) {
          expect(edit({ aspect: a })).toContain("Keep the frame free of subtitles");
        }
      });
      it("16:9 / 1:1 / no aspect i2i do not", () => {
        for (const a of ["16:9", "1:1", undefined]) {
          expect(edit(a ? { aspect: a } : {})).not.toContain("Keep the frame free of subtitles");
        }
      });
      it("the guard lands last, after what to preserve", () => {
        const out = edit({ aspect: "9:16" });
        expect(out.trim().endsWith("Keep the frame free of subtitles, captions, and watermarks.")).toBe(true);
        expect(out.indexOf("keep everything else unchanged"))
          .toBeLessThan(out.indexOf("Keep the frame free"));
      });
      it("the user asked for on-image text → no ban here either", () => {
        expect(edit({ aspect: "9:16", textContent: "50% OFF" })).not.toContain("Keep the frame free of subtitles");
      });
      it("the edit instruction itself is untouched", () => {
        expect(edit({ aspect: "9:16" }).startsWith("Replace the background with a beach sunset.")).toBe(true);
      });
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
  // #774 r2 —— mode 的口径按实际行为统一：仓库总指令明确「商家挂的那张图就是引擎要改的
  // 底图」，旧描述却说只有 @实体供图才算 i2i，两句互相打架，Otto 照前者选 t2i 就绕过了
  // 整条编辑装配分支。现在只按一件事分流：这段提示词是在改一张已有的图，还是从零造一张。
  it("description picks i2i by what the prompt DOES, not by where the image came from", () => {
    const d = seedreamPromptSkill.description;
    expect(d).toContain("Use mode:'i2i' whenever this prompt CHANGES an image that already exists");
    expect(d).toContain("the image the user attached, the one they are viewing and editing");
    expect(d).toContain("use t2i only when the picture is made from nothing");
    expect(d).not.toContain("ONLY when an @-referenced entity supplies the source image");
  });
  // #774 r2 —— 编号不再是 Otto 的活，描述面必须把这件事说死。
  it("description tells Otto never to number images itself", () => {
    const d = seedreamPromptSkill.description;
    expect(d).toContain("their identity is locked BY NAME");
    expect(d).toContain("the system numbers them for the engine at send time — never write image numbers yourself");
    expect(d).not.toContain("baseImage");
    // #802 地图硬规则：`>` 是导航路径分隔符族的一员，教学文案里写尖括号会被判成一条不存在的路。
    expect(d).not.toContain("<Image_");
  });
  // #774 U4 —— 同一个形状要同时传给 propose 和这里，否则竖版防线不会被触发。
  it("description ties `aspect` to propose's desiredAspect", () => {
    expect(seedreamPromptSkill.description).toContain("SAME shape you will pass to propose's desiredAspect");
  });
  // 判官 r2 P2 —— 描述说的必须是行为真做的：两条分支都加，唯一例外是商家自己要了字。
  it("description states the guard covers both branches, and names its one exception", () => {
    const d = seedreamPromptSkill.description;
    expect(d).toContain("extra caption-free instruction in BOTH t2i and i2i");
    expect(d).toContain("the only exception is when you asked for on-image text yourself via textContent");
  });
  // #774 U8 —— 官方素材建议只提醒不强收（商家的 data 商家的权利）。
  it("advisory notes are returned, never enforced", async () => {
    const invoke = seedreamPromptSkill.tool as unknown as { invoke: (rc: unknown, a: string) => Promise<{ prompt: string; notes?: string[] }> };
    const many = Array.from({ length: 6 }, (_, n) => ({ role: "character", name: `P${n}` }));
    const out = await invoke.invoke({ context: {} }, JSON.stringify({ subject: "a group photo", references: many }));
    expect(out.notes?.length).toBeGreaterThan(0);
    // 提醒归提醒：六个参考一个不少地进了 prompt。
    for (let n = 0; n < 6; n++) expect(out.prompt).toContain(`P${n}`);
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
