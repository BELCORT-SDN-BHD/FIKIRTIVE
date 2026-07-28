import { describe, it, expect } from "vitest";
import { VIDEO_CAPABILITIES } from "./video-capabilities.js";
import { seedancePromptInput, seedanceShot, assembleSeedance } from "./seedance-prompt.helpers.js";

describe("VIDEO_CAPABILITIES table", () => {
  it("lists exactly the 13 ticket capabilities, ids unique", () => {
    const ids = VIDEO_CAPABILITIES.map((c) => c.id);
    expect(ids.length).toBe(13);
    expect(new Set(ids).size).toBe(13);
    expect(ids.sort()).toEqual(
      [
        "audioControl", "beatSync", "cameraReplication", "editInstruction", "extension",
        "multiSegmentContinuation", "negativeExclusion", "pureT2v", "referenceIdentity",
        "singleTake", "storyCompletion", "templateReplication", "timestampedShots",
      ].sort(),
    );
  });
  it("every capability's field paths exist in the real input schema (no phantom fields)", () => {
    const rootKeys = new Set(Object.keys(seedancePromptInput.shape));
    const shotKeys = new Set(Object.keys(seedanceShot.shape));
    for (const cap of VIDEO_CAPABILITIES) {
      expect(cap.fields.length, cap.id).toBeGreaterThan(0);
      for (const path of cap.fields) {
        const [root = "", sub] = path.split(".");
        expect(rootKeys.has(root), `${cap.id}: ${path}`).toBe(true);
        if (sub) {
          expect(root).toBe("shots");
          expect(shotKeys.has(sub), `${cap.id}: ${path}`).toBe(true);
        }
      }
    }
  });
  it("every capability carries a Chinese one-line hint", () => {
    for (const cap of VIDEO_CAPABILITIES) {
      expect(cap.labelZh.length, cap.id).toBeGreaterThan(0);
      expect(/[一-鿿]/.test(cap.hintZh), cap.id).toBe(true);
    }
  });
});

// 逐能力：schema + assembler 能表达出预期的子句形状（验收第 4 条）。
describe("each of the 13 capabilities is expressible through the assembler", () => {
  const shape = (input: unknown) => assembleSeedance(seedancePromptInput.parse(input));

  it("pureT2v — self-contained scene, no first-frame reference", () => {
    const out = shape({ mode: "t2v", style: "纪实风，自然暖色调", shots: [{ subject: "系花布围裙的档口老板娘", action: "舀起一勺参巴酱淋上椰浆饭", camera: "dolly in", sceneLight: "清晨侧向自然光，暖色温" }] });
    expect(out).toContain("纪实风，自然暖色调");
    expect(out).not.toContain("首帧");
  });
  it("referenceIdentity — @引用 locks identity via the Chinese lock clause", () => {
    const out = shape({ shots: [{ subject: "Boba仔", action: "在柜台后跳起接住珍珠" }], references: [{ role: "character", name: "Boba仔", lock: true }] });
    expect(out).toContain("Boba仔 与参考图保持同一人");
  });
  it("cameraReplication — trajectory (起点→路径→终点) rides the camera field", () => {
    const out = shape({ style: "复刻参考视频的运镜与节奏", shots: [{ subject: "老师傅", action: "颠锅，火苗窜起", camera: "handheld follow, 从锅沿低角度快速绕至侧面定住" }] });
    expect(out).toContain("复刻参考视频的运镜与节奏");
    expect(out).toContain("handheld follow, 从锅沿低角度快速绕至侧面定住");
  });
  it("templateReplication — beats + events + transition, no trademark name needed", () => {
    const out = shape({
      mode: "t2v",
      shots: [
        { subject: "油腻昏暗的厨房", action: "0-1.5s: 静置全景", camera: "fixed" },
        { subject: "同一机位同一厨房", action: "1.5-4s: 焕然一新，清洁人员比出大拇指", camera: "fixed" },
      ],
      constraints: "硬切转场，机位严格不变",
    });
    expect(out).toContain("Shot 2:");
    expect(out).toContain("硬切转场，机位严格不变");
  });
  it("storyCompletion — premise + causal chain + written ending", () => {
    const out = shape({ shots: [{ subject: "老板", action: "起点：正举刀对着榴莲。随后手起刀落劈开榴莲，最终抬头咧嘴一笑" }] });
    expect(out).toContain("起点：");
    expect(out).toContain("最终");
  });
  it("extension — continuation opener + carried lighting, no re-description (R3：续接必带 style 供逐字复用)", () => {
    const out = shape({ continuesFromPrev: true, style: "茶艺纪实风，暖色调", shots: [{ subject: "茶汤", action: "从高处拉出长弧线落入杯中", sceneLight: "延续上一段的光线与色调" }] });
    expect(out).toContain("承接上一段画面");
    expect(out).toContain("延续上一段的光线与色调");
  });
  it("audioControl — speaker + language + quoted line on the 声音 line", () => {
    const out = shape({ shots: [{ subject: "老板娘", action: "递出打包袋对镜头微笑", audio: '老板娘用马来语热情地说："Sedap tau, cuba lah!"' }] });
    expect(out).toContain('声音: 老板娘用马来语热情地说："Sedap tau, cuba lah!"');
  });
  it("singleTake — one continuous take + no-cut constraint in one shot", () => {
    const out = shape({ shots: [{ subject: "镜头", action: "从民宿木门推入，途经餐桌、茶壶，停在落地窗前", camera: "one continuous take" }], constraints: "全程一镜到底，无剪辑无转场" });
    expect(out).toContain("one continuous take");
    expect(out).toContain("全程一镜到底");
    expect(out).not.toContain("Shot 2:");
  });
  it("editInstruction — mode:'edit' emits directive + preserve, nothing else", () => {
    const out = shape({ mode: "edit", editInstruction: "将模特身上的 T 恤由白色改为鹅黄色" });
    expect(out).toBe("将模特身上的 T 恤由白色改为鹅黄色，其余画面、人物动作与运镜保持不变");
  });
  it("beatSync — numeric beat length in pacing + freeze actions", () => {
    const out = shape({
      mode: "t2v",
      pacing: "快节奏卡点剪辑, hard cut, 每拍约 0.5s 一个动作定格",
      shots: [
        { subject: "一只球鞋", action: "砸进画面中央定格", shotFraming: "close-up" },
        { subject: "店员", action: "双手抱胸抬下巴定格", shotFraming: "full" },
      ],
    });
    expect(out).toContain("每拍约 0.5s");
    expect(out).toContain("定格");
  });
  it("timestampedShots — half-width '0-2s:' prefixes survive in order", () => {
    const out = shape({
      mode: "t2v",
      shots: [
        { subject: "茶师", action: "0-2s: 双手持杯高举过头" },
        { subject: "茶汤", action: "2-4s: 拉出一条长弧线" },
      ],
    });
    expect(out.indexOf("0-2s:")).toBeLessThan(out.indexOf("2-4s:"));
  });
  it("multiSegmentContinuation — verbatim style + continuation + re-passed locks", () => {
    const seg2 = shape({
      style: "温情叙事风，暖金色调。",
      continuesFromPrev: true,
      shots: [{ subject: "门", action: "被推开，子女提着行李涌入" }],
      references: [{ role: "character", name: "母亲", lock: true }],
    });
    expect(seg2.startsWith("温情叙事风，暖金色调。")).toBe(true);
    expect(seg2).toContain("承接上一段画面");
    expect(seg2).toContain("母亲 与参考图保持同一人");
  });
  it("negativeExclusion — noun list rides constraints at the tail", () => {
    const out = shape({ shots: [{ subject: "珠宝", action: "缓缓转动" }], constraints: "画面中不出现：多余手指、皮肤过曝反光" });
    expect(out.endsWith("画面中不出现：多余手指、皮肤过曝反光")).toBe(true);
  });
});
