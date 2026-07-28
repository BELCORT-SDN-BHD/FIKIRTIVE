import { describe, it, expect } from "vitest";
import { assembleSeedance, seedancePromptInput, EDIT_PRESERVE_DEFAULT } from "./seedance-prompt.helpers.js";
import { seedancePromptSkill } from "./seedance-prompt.js";

const CJK = /[一-鿿]/;

describe("assembleSeedance", () => {
  const oneShot = (over = {}) => seedancePromptInput.parse({
    shots: [{ subject: "画面里的男人", action: "在门口停下，深吸一口气", camera: "slow dolly in", ...over }],
  });

  it("i2v single shot opens with the Chinese first-frame phrase and has no Shot label", () => {
    const out = assembleSeedance(oneShot());
    expect(out).toContain("从给定的首帧画面开始");
    expect(out).not.toContain("Shot 1:");
  });
  it("emits NO technical flags", () => {
    const out = assembleSeedance(oneShot());
    expect(out).not.toContain("--resolution");
    expect(out).not.toContain("--duration");
    expect(out).not.toContain("--ratio");
  });
  it("scaffold is Chinese (语言规则：视频 prompt 正文中文), user's English camera term kept", () => {
    const out = assembleSeedance(oneShot());
    expect(CJK.test(out)).toBe(true); // Chinese body
    expect(out).toContain("slow dolly in"); // industry term stays English
    // none of the old English scaffold survives
    expect(out).not.toContain("starting from the given first frame");
    expect(out).not.toContain("keep the subject consistent with the source frame");
    expect(out).not.toContain("no on-screen text, watermark, or logo");
  });
  it("i2v adds a subject-neutral Chinese consistency line", () => {
    const out = assembleSeedance(oneShot());
    expect(out).toContain("主体与首帧画面保持一致");
  });
  it("a character reference yields the Chinese identity lock (同脸/同发型/同体型)", () => {
    const out = assembleSeedance(seedancePromptInput.parse({
      shots: [{ subject: "画面里的男人", action: "转身面向镜头" }],
      references: [{ role: "character", name: "Mia", lock: true }],
    }));
    expect(out).toContain("同脸、同发型、同体型");
    expect(out).toContain("Mia");
  });
  it("cleanFootage (default) appends the Chinese no-text/watermark/logo line", () => {
    expect(assembleSeedance(oneShot())).toContain("画面中不出现文字、水印或 logo");
  });
  it("cleanFootage:false drops the negative line", () => {
    const out = assembleSeedance(seedancePromptInput.parse({
      cleanFootage: false, shots: [{ subject: "一段 logo 动画", action: "logo 动画入场" }],
    }));
    expect(out).not.toContain("画面中不出现文字");
  });
  it("audio closes the shot clause with the 声音 prefix (专业语序收尾)", () => {
    const out = assembleSeedance(oneShot({ audio: "安静的室内底噪" }));
    expect(out).toContain(", 声音: 安静的室内底噪");
  });
  it("shot grammar: fixed professional clause order 景别→主体→动作→运镜→光线→氛围→声音", () => {
    const out = assembleSeedance(oneShot({
      shotFraming: "close-up", sceneLight: "golden hour", mood: "温暖的氛围", audio: "海浪声",
    }));
    const order = ["close-up", "画面里的男人", "在门口停下", "slow dolly in", "golden hour", "温暖的氛围", "声音: 海浪声"];
    const idx = order.map((t) => out.indexOf(t));
    expect(idx.every((n) => n >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx); // strictly in declared order
  });
  it("shot grammar: missing optional fields omit cleanly — no dangling commas, order stable", () => {
    const out = assembleSeedance(seedancePromptInput.parse({
      shots: [{ subject: "一只猫", action: "跃起" }],
    }));
    expect(out).not.toMatch(/,\s*,/);
    expect(out).not.toMatch(/,\s*$/m);
    expect(out.indexOf("一只猫")).toBeLessThan(out.indexOf("跃起"));
  });
  it("multi-shot labels each beat", () => {
    const out = assembleSeedance(seedancePromptInput.parse({
      shots: [
        { subject: "赛车", action: "漂移过弯" },
        { subject: "车手", action: "露出微笑" },
      ],
    }));
    expect(out).toContain("Shot 1:");
    expect(out).toContain("Shot 2:");
  });
  it("continuesFromPrev opens with the Chinese handoff phrase (视频延长：不重述场景)", () => {
    const out = assembleSeedance(seedancePromptInput.parse({
      continuesFromPrev: true, shots: [{ subject: "剑客", action: "举起长剑" }],
    }));
    expect(out).toContain("承接上一段画面");
    expect(out).not.toContain("从给定的首帧画面开始");
  });
  it("references append an identity-lock clause; absent refs add none", () => {
    const out = assembleSeedance(oneShot({}));
    const withRef = assembleSeedance(seedancePromptInput.parse({
      shots: [{ subject: "吉祥物", action: "挥手" }],
      references: [{ role: "character", name: "Otto 小狐狸" }],
    }));
    expect(withRef).toContain("Otto 小狐狸 与参考图保持同一人");
    expect(out).not.toContain("Otto 小狐狸");
  });
  it("appends constraints when present (负向排除放最后)", () => {
    const out = assembleSeedance(seedancePromptInput.parse({
      shots: [{ subject: "一只猫", action: "跃起" }], constraints: "画面中不出现：多余手指、路人",
    }));
    expect(out.endsWith("画面中不出现：多余手指、路人")).toBe(true);
  });
  it("t2v (no source frame) references no first frame", () => {
    const out = assembleSeedance(seedancePromptInput.parse({
      mode: "t2v",
      shots: [{ subject: "海浪", action: "涌上沙滩" }],
    }));
    expect(out).not.toContain("从给定的首帧画面开始");
    expect(out).not.toContain("主体与首帧画面保持一致");
  });
  it("a locked brandmark reference suppresses the clean-footage logo ban", () => {
    const out = assembleSeedance(seedancePromptInput.parse({
      shots: [{ subject: "瓶身", action: "缓缓旋转" }],
      references: [{ role: "brandmark", name: "AeroCo", lock: true }],
    }));
    expect(out).not.toContain("画面中不出现文字、水印或 logo");
    expect(out).toContain("按参考图原样呈现");
  });
  it("a brandmark reference with lock:false still gets the clean-footage logo ban", () => {
    const out = assembleSeedance(seedancePromptInput.parse({
      shots: [{ subject: "瓶身", action: "缓缓旋转" }],
      references: [{ role: "brandmark", name: "AeroCo", lock: false }],
    }));
    expect(out).toContain("画面中不出现文字、水印或 logo");
  });
});

describe("assembleSeedance — mode:'edit' (视频编辑，#437 追加)", () => {
  it("edit emits instruction + default三保 preserve, no shots/first-frame scaffold", () => {
    const out = assembleSeedance(seedancePromptInput.parse({
      mode: "edit",
      editInstruction: "将模特身上的 T 恤由白色改为鹅黄色",
    }));
    expect(out).toContain("将模特身上的 T 恤由白色改为鹅黄色");
    expect(out).toContain(EDIT_PRESERVE_DEFAULT);
    expect(out).not.toContain("从给定的首帧画面开始");
    expect(out).not.toContain("Shot 1:");
  });
  it("edit honors a custom preserve and appends constraints", () => {
    const out = assembleSeedance(seedancePromptInput.parse({
      mode: "edit",
      editInstruction: "移除画面右后方背包的路人",
      preserve: "其余画面、海浪运动与运镜保持不变",
      constraints: "画面中不出现：新的路人",
    }));
    expect(out).toContain("其余画面、海浪运动与运镜保持不变");
    expect(out).not.toContain(EDIT_PRESERVE_DEFAULT);
    expect(out).toContain("画面中不出现：新的路人");
  });
  it("edit carries identity locks when references are present", () => {
    const out = assembleSeedance(seedancePromptInput.parse({
      mode: "edit",
      editInstruction: "把背景替换为海滩日落",
      references: [{ role: "product", name: "AeroBottle", lock: true }],
    }));
    expect(out).toContain("AeroBottle 与参考图完全一致");
  });
  it("schema: edit without editInstruction is rejected", () => {
    expect(seedancePromptInput.safeParse({ mode: "edit" }).success).toBe(false);
  });
  it("schema: i2v/t2v without shots stays rejected (backward-compatible tightening)", () => {
    expect(seedancePromptInput.safeParse({}).success).toBe(false);
    expect(seedancePromptInput.safeParse({ mode: "t2v", shots: [] }).success).toBe(false);
  });
  it("schema: legacy call shape (shots only) still parses with i2v default", () => {
    const parsed = seedancePromptInput.parse({ shots: [{ subject: "一只猫", action: "跃起" }] });
    expect(parsed.mode).toBe("i2v");
    expect(parsed.cleanFootage).toBe(true);
  });
});

describe("assembleSeedance — capability shapes flow through fields", () => {
  it("timestamped shots: half-width '0-2s:' action prefixes land in the shot clause (时间戳分镜)", () => {
    const out = assembleSeedance(seedancePromptInput.parse({
      mode: "t2v",
      shots: [
        { subject: "茶师", action: "0-2s: 双手持杯高举过头", camera: "fixed" },
        { subject: "茶汤", action: "2-4s: 拉出一条长弧线", camera: "slow-motion" },
      ],
    }));
    expect(out).toContain("Shot 1: 茶师, 0-2s: 双手持杯高举过头");
    expect(out).toContain("Shot 2: 茶汤, 2-4s: 拉出一条长弧线");
  });
  it("beat-sync: numeric beat length rides pacing (音乐卡点——引擎听不到歌)", () => {
    const out = assembleSeedance(seedancePromptInput.parse({
      mode: "t2v",
      pacing: "快节奏卡点剪辑, hard cut, 每拍约 0.5s 一个动作定格",
      shots: [{ subject: "球鞋", action: "砸进画面中央定格" }],
    }));
    expect(out).toContain("每拍约 0.5s");
  });
  it("single take: one continuous take in camera + no-cut constraint (一镜到底)", () => {
    const out = assembleSeedance(seedancePromptInput.parse({
      mode: "i2v",
      shots: [{ subject: "镜头", action: "从民宿木门推入，途经餐桌与茶壶，停在落地窗前", camera: "one continuous take" }],
      constraints: "全程一镜到底，无剪辑无转场",
    }));
    expect(out).toContain("one continuous take");
    expect(out).toContain("全程一镜到底，无剪辑无转场");
  });
});

describe("seedancePromptSkill gate", () => {
  it("free/read/internal → not gated, no requires", () => {
    expect(seedancePromptSkill.cost).toBe("free");
    expect(seedancePromptSkill.effect).toBe("read");
    expect(seedancePromptSkill.needsApproval).toBe(false);
    expect(seedancePromptSkill.requires).toEqual([]);
  });
  it("built tool returns { prompt } from assembly", async () => {
    const invoke = seedancePromptSkill.tool as unknown as { invoke: (rc: unknown, a: string) => Promise<unknown> };
    const out = await invoke.invoke({ context: {} }, JSON.stringify({ shots: [{ subject: "一只猫", action: "跃起" }] })) as { prompt: string };
    expect(typeof out.prompt).toBe("string");
    expect(out.prompt).toContain("一只猫");
  });
  it("description carries concrete camera/shot/lighting vocabulary without Chinese glosses", () => {
    expect(seedancePromptSkill.description).toContain("dolly in");
    expect(seedancePromptSkill.description).toContain("golden hour");
    expect(seedancePromptSkill.description).not.toContain("推镜头");
  });
  it("description encodes the Chinese-body language rule and the edit mode", () => {
    expect(seedancePromptSkill.description).toContain("CHINESE");
    expect(seedancePromptSkill.description).toContain("mode:'edit'");
  });
});

describe("seedancePromptInput — language enforcement (复审 P1-B：声明变执法)", () => {
  it("REJECTS an English-subject/action prompt (judge counterexample now fails closed)", () => {
    const r = seedancePromptInput.safeParse({
      shots: [{ subject: "a young man", action: "walks through the door and pauses" }],
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(JSON.stringify(r.error.issues)).toMatch(/CHINESE/);
  });
  it("accepts Chinese free text with embedded English camera vocabulary (majority-script rule)", () => {
    const r = seedancePromptInput.safeParse({
      shots: [{ subject: "档口的老板娘", action: "掀开蒸笼，镜头随蒸气 dolly in 推进", camera: "dolly in" }],
    });
    expect(r.success).toBe(true);
  });
  it("technical/dialogue fields stay exempt: English camera/framing/light/pacing and Malay dialogue pass", () => {
    const r = seedancePromptInput.safeParse({
      pacing: "hard cut",
      shots: [{
        subject: "两位街坊", action: "相视大笑",
        camera: "fixed", shotFraming: "medium close-up", sceneLight: "golden hour",
        audio: "Makcik berkata: 'Sedapnya!'",
      }],
    });
    expect(r.success).toBe(true);
  });
  it("REJECTS an English editInstruction in edit mode", () => {
    const r = seedancePromptInput.safeParse({ mode: "edit", editInstruction: "change the shirt to yellow" });
    expect(r.success).toBe(false);
  });
});

describe("seedancePromptInput — capability constraints machine-checked (复审 craft 2)", () => {
  const shot = { subject: "一只猫", action: "跃起" };
  it("singleTake: more than one shot is rejected; exactly one passes", () => {
    expect(seedancePromptInput.safeParse({
      capabilities: ["singleTake"], shots: [shot, { subject: "一只狗", action: "追逐" }],
    }).success).toBe(false);
    expect(seedancePromptInput.safeParse({
      capabilities: ["singleTake"], shots: [{ ...shot, camera: "one continuous take" }],
    }).success).toBe(true);
  });
  it("timestampedShots: missing prefix rejected; overlapping rejected; descending rejected; clean ascending passes", () => {
    expect(seedancePromptInput.safeParse({
      capabilities: ["timestampedShots"], shots: [shot],
    }).success).toBe(false);
    expect(seedancePromptInput.safeParse({
      capabilities: ["timestampedShots"],
      shots: [{ subject: "茶师", action: "0-3s: 持杯高举" }, { subject: "茶汤", action: "2-4s: 拉出长弧线" }],
    }).success).toBe(false); // overlap: 2 < 3
    expect(seedancePromptInput.safeParse({
      capabilities: ["timestampedShots"],
      shots: [{ subject: "茶师", action: "2-4s: 持杯高举" }, { subject: "茶汤", action: "0-2s: 拉出长弧线" }],
    }).success).toBe(false); // descending
    expect(seedancePromptInput.safeParse({
      capabilities: ["timestampedShots"],
      shots: [{ subject: "茶师", action: "0-2s: 持杯高举" }, { subject: "茶汤", action: "2-4s: 拉出长弧线" }],
    }).success).toBe(true);
  });
  it("timestampedShots: start must be before end", () => {
    expect(seedancePromptInput.safeParse({
      capabilities: ["timestampedShots"], shots: [{ subject: "茶师", action: "3-3s: 持杯高举" }],
    }).success).toBe(false);
  });
  it("beatSync: pacing without a numeric beat length rejected; numeric passes", () => {
    expect(seedancePromptInput.safeParse({
      capabilities: ["beatSync"], shots: [shot], pacing: "快节奏卡点",
    }).success).toBe(false);
    expect(seedancePromptInput.safeParse({
      capabilities: ["beatSync"], shots: [shot], pacing: "每拍约 0.5s, hard cut",
    }).success).toBe(true);
  });
  it("negativeExclusion: >5 terms rejected; ≤5 passes; missing constraints rejected", () => {
    expect(seedancePromptInput.safeParse({
      capabilities: ["negativeExclusion"], shots: [shot],
      constraints: "画面中不出现：多余手指、路人、杂物、反光、阴影、水印",
    }).success).toBe(false);
    expect(seedancePromptInput.safeParse({
      capabilities: ["negativeExclusion"], shots: [shot],
      constraints: "画面中不出现：多余手指、路人",
    }).success).toBe(true);
    expect(seedancePromptInput.safeParse({
      capabilities: ["negativeExclusion"], shots: [shot],
    }).success).toBe(false);
  });
  it("multiSegmentContinuation: missing style rejected; style present passes", () => {
    expect(seedancePromptInput.safeParse({
      capabilities: ["multiSegmentContinuation"], shots: [shot], continuesFromPrev: true,
    }).success).toBe(false);
    expect(seedancePromptInput.safeParse({
      capabilities: ["multiSegmentContinuation"], shots: [shot], continuesFromPrev: true, style: "纪实风，暖色调",
    }).success).toBe(true);
  });
  it("no capabilities declared → none of the extra constraints fire (旧调用方兼容)", () => {
    expect(seedancePromptInput.safeParse({ shots: [shot, { subject: "一只狗", action: "追逐" }] }).success).toBe(true);
  });
});

describe("seedancePrompt SKILL wiring (复审 P1-A：策略/变体/清单随 skill 执行返回)", () => {
  const invoke = seedancePromptSkill.tool as unknown as { invoke: (rc: unknown, a: string) => Promise<any> };
  const realistic = {
    userIntent: "帮我的辣椒酱新品拍一条带货视频",
    shots: [{
      subject: "辣椒酱瓶身", action: "在木桌上缓缓旋转", camera: "dolly in",
      shotFraming: "medium", sceneLight: "natural window light", mood: "温暖诱人",
    }],
    references: [{ role: "product", name: "辣椒酱经典装", lock: true }],
  };

  it("a realistic request yields 2-3 meaningfully-different variants that PASS checkVariantSet", async () => {
    const out = await invoke.invoke({ context: {} }, JSON.stringify(realistic));
    expect(out.variants.length).toBeGreaterThanOrEqual(2);
    expect(out.variants.length).toBeLessThanOrEqual(3);
    const axes = out.variants.map((v: { axis: string }) => v.axis);
    expect(new Set(axes).size).toBe(axes.length); // distinct leading axes
    expect(out.variantCheck).toEqual({ ok: true, problems: [] }); // machine-verified: no synonym rewrites
    for (const v of out.variants) {
      expect(typeof v.prompt).toBe("string");
      expect(v.prompt).toContain("辣椒酱瓶身"); // user content untouched
      expect(v.prompt).toContain("辣椒酱经典装 与参考图完全一致"); // identity lock kept across variants
    }
  });
  it("routes the strategy from userIntent + reference roles (decideStrategy runs inside the skill)", async () => {
    const out = await invoke.invoke({ context: {} }, JSON.stringify(realistic));
    expect(out.strategy).toEqual({ kind: "route", family: "ecommerce", matched: expect.arrayContaining(["带货", "@product"]) });
  });
  it("attaches the asset checklist; a family-required missing asset appears not-ready with how-to-supply", async () => {
    const withRef = await invoke.invoke({ context: {} }, JSON.stringify(realistic));
    expect(withRef.assetChecklist).toEqual([
      expect.objectContaining({ role: "product", name: "辣椒酱经典装", ready: true, lock: true }),
    ]);
    const noRef = await invoke.invoke({ context: {} }, JSON.stringify({ ...realistic, references: [] }));
    expect(noRef.assetChecklist[0]).toMatchObject({ role: "product", ready: false });
    expect(noRef.assetChecklist[0].howToSupply).toBeTruthy();
  });
  it("directionPinned → exactly 2 variants", async () => {
    const out = await invoke.invoke({ context: {} }, JSON.stringify({ ...realistic, directionPinned: true }));
    expect(out.variants.length).toBe(2);
  });
  it("mode:'edit' returns a single prompt (one change per call) with strategy + checklist, no variants", async () => {
    const out = await invoke.invoke({ context: {} }, JSON.stringify({
      mode: "edit", editInstruction: "将T恤由白色改为黄色", userIntent: "把视频里的T恤换个颜色",
    }));
    expect(out.variants).toBeUndefined();
    expect(typeof out.prompt).toBe("string");
    expect(out.assetChecklist).toEqual([]);
  });
});
