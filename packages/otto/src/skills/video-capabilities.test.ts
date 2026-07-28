import { describe, it, expect } from "vitest";
import { VIDEO_CAPABILITIES, type CapabilityRequirement, type VideoCapability } from "./video-capabilities.js";
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
  it("the timestamp hint promises only what the schema checks (no total-duration claim — there is no duration field)", () => {
    const hint = VIDEO_CAPABILITIES.find((c) => c.id === "timestampedShots")!.hintZh;
    expect(hint).toContain("升序");
    expect(hint).toContain("段段连续无缝隙");
    expect(hint).not.toContain("总长等于系统时长参数");
  });
  it("every capability carries a Chinese one-line hint", () => {
    for (const cap of VIDEO_CAPABILITIES) {
      expect(cap.labelZh.length, cap.id).toBeGreaterThan(0);
      expect(/[一-鿿]/.test(cap.hintZh), cap.id).toBe(true);
    }
  });
});

/**
 * R5：箭头反向。旧测试拿手写清单去核对数据表（表→手写），于是「表里有、守卫没扫」
 * 这类洞永远照不出来。这里改成走表核对真实执法：表里每条 requires 都必须真的被
 * 机检，每个承载字段都必须真的被守卫扫到 —— 往表里加一条而守卫没跟上，这里就红。
 */
describe("VIDEO_CAPABILITIES drives the schema guard (walk the table, verify the enforcement)", () => {
  const parse = (input: unknown) => seedancePromptInput.safeParse(input);
  const capabilityOf = (id: string) => VIDEO_CAPABILITIES.find((c) => c.id === id)!;
  type Input = Record<string, unknown>;

  /** 占位值须同时满足「数值拍长」与「时间戳前缀」两条守卫，正向控制才有意义。 */
  const PLACEHOLDER = "0-2s: 占位";
  const CANDIDATES: unknown[] = [PLACEHOLDER, true, [{ role: "product", name: "占位" }]];
  const BASES: Input[] = [
    { mode: "i2v", shots: [{ subject: "主体", action: "动作" }] },
    { mode: "edit", editInstruction: "占位指令", shots: [] }, // 这个基底连 shot 都没有 → 能证伪 shots.* 类要求
  ];

  /** 让一条要求成立的最小补丁；值的类型靠 schema 试出来，不按字段名写死。 */
  const satisfy = (input: Input, req: CapabilityRequirement): Input => {
    const [root = "", sub] = req.path.split(".");
    const set = (value: unknown): Input => {
      if (!sub) return { ...input, [root]: value };
      const shots = input.shots as Input[];
      const target = shots.length > 0 ? shots : [{ subject: "主体", action: "动作" }];
      return { ...input, shots: target.map((s) => ({ ...s, [sub]: value })) };
    };
    if (req.equals !== undefined) return set(req.equals);
    for (const candidate of CANDIDATES) {
      const patched = set(candidate);
      if (parse(patched).success) return patched;
    }
    throw new Error(`no placeholder value fits ${req.path} — extend CANDIDATES`);
  };

  /** 该能力的全部要求（可跳过一条）都满足的输入；值要求最后应用（它同时是形状信号）。 */
  const build = (base: Input, cap: VideoCapability, skip?: CapabilityRequirement): Input => {
    const reqs = cap.requires.filter((r) => r !== skip);
    let input = base;
    for (const r of reqs.filter((r) => r.equals === undefined)) input = satisfy(input, r);
    for (const r of reqs.filter((r) => r.equals !== undefined)) input = satisfy(input, r);
    return input;
  };

  it("no capability id is accepted by the enum and then bound to nothing", () => {
    for (const cap of VIDEO_CAPABILITIES) expect(cap.requires.length, cap.id).toBeGreaterThan(0);
  });

  it("every declared requirement is really enforced (satisfied → accepted; only that one missing → rejected)", () => {
    for (const cap of VIDEO_CAPABILITIES) {
      for (const req of cap.requires) {
        const enforced = BASES.some((base) =>
          parse({ ...build(base, cap), capabilities: [cap.id] }).success
          && !parse({ ...build(base, cap, req), capabilities: [cap.id] }).success);
        expect(enforced, `${cap.id} requires ${req.path}`).toBe(true);
      }
    }
  });

  /** 形状信号：自证词注进该能力声明的每一个文本承载字段，守卫都必须够得着（申报与否都拦）。 */
  const SIX_NEGATIVES = "画面中不出现：多余手指、路人、杂物、反光、阴影、水印";
  const CONTRADICTIONS: ReadonlyArray<{ id: string; inject: string; base: Input; why: string }> = [
    { id: "singleTake", inject: "一镜到底", base: { shots: [{ subject: "主体", action: "动作" }, { subject: "配角", action: "走开" }] }, why: "一镜到底 + 两个 shot" },
    { id: "singleTake", inject: "one-take", base: { shots: [{ subject: "主体", action: "动作" }, { subject: "配角", action: "走开" }] }, why: "连字符写法同样算自证" },
    { id: "beatSync", inject: "卡点", base: { shots: [{ subject: "主体", action: "动作" }] }, why: "谈卡点却没有数值拍长" },
    { id: "timestampedShots", inject: "0-2s: 起手", base: { shots: [{ subject: "主体", action: "动作" }, { subject: "配角", action: "走开" }] }, why: "两段同区间 = 不连续" },
    { id: "negativeExclusion", inject: SIX_NEGATIVES, base: { shots: [{ subject: "主体", action: "动作" }] }, why: "负向项数超过 5" },
  ];

  /** 该字段路径是否收字符串（由 schema 判定，不按名字猜）—— 布尔/数组类承载字段不参与文本注入。 */
  const takesText = (path: string): boolean => {
    const [root = "", sub] = path.split(".");
    const shape = seedancePromptInput.shape as Record<string, { safeParse: (v: unknown) => { success: boolean } }>;
    const shotShape = seedanceShot.shape as Record<string, { safeParse: (v: unknown) => { success: boolean } }>;
    const field = sub ? shotShape[sub] : shape[root];
    return !!field && field.safeParse("占位").success;
  };

  it("the guard reaches EVERY text carrier field each capability declares", () => {
    for (const { id, inject, base, why } of CONTRADICTIONS) {
      expect(parse(base).success, `${id} control base`).toBe(true); // 控制组：不注入时基底合法
      const carriers = capabilityOf(id).fields.filter(takesText);
      expect(carriers.length, `${id} has no text carrier`).toBeGreaterThan(0);
      for (const path of carriers) {
        const [root = "", sub] = path.split(".");
        const injected = sub
          ? { ...base, shots: (base.shots as Input[]).map((s) => ({ ...s, [sub]: inject })) }
          : { ...base, [root]: inject };
        expect(parse(injected).success, `${id} via ${path} (${why})`).toBe(false);
      }
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
