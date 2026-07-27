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
  it("audio goes on its own 声音 line", () => {
    const out = assembleSeedance(oneShot({ audio: "安静的室内底噪" }));
    expect(out).toContain("\n声音: 安静的室内底噪");
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
