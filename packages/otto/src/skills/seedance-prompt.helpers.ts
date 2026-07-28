import { z } from "zod";
import { promptRef, identityLockClauseZh } from "./prompt-vocab.js";
import { languageAdvice, promptLanguageFor } from "../prompt-language.js";
import { VIDEO_CAPABILITIES, type CapabilityRequirement, type VideoCapability } from "./video-capabilities.js";
import { VIDEO_VARIANT_AXES, type PromptVariant } from "./variant-policy.js";

export const seedanceShot = z.object({
  subject: z.string().min(1),
  action: z.string().min(1),
  camera: z.string().optional(),
  shotFraming: z.string().optional(),
  sceneLight: z.string().optional(),
  mood: z.string().optional(),
  audio: z.string().optional(),
});

/** 能力 id 与 video-capabilities.ts 数据表同源（测试断言一致）。 */
const CAPABILITY_IDS = VIDEO_CAPABILITIES.map((c) => c.id) as [string, ...string[]];

/**
 * R5：守卫按构造从能力表读扫描集与要求集 —— 本文件不再手写任何字段清单。
 * id 写错不会静默变成「什么也不管」：模块加载即抛。
 */
const CAPABILITY_BY_ID = new Map(VIDEO_CAPABILITIES.map((c) => [c.id, c] as const));
function capability(id: string): VideoCapability {
  const cap = CAPABILITY_BY_ID.get(id);
  if (!cap) throw new Error(`unknown video capability id "${id}" — VIDEO_CAPABILITIES is the single source of truth`);
  return cap;
}
const SINGLE_TAKE = capability("singleTake");
const BEAT_SYNC = capability("beatSync");
const TIMESTAMPED = capability("timestampedShots");
const NEGATIVE_EXCLUSION = capability("negativeExclusion");

/**
 * R5：写法归一，不枚举写法。连字符类字符（半角 -、‐、‑、‒、–、—、−、－）一律折成半角 "-"，
 * 短语正则再把 "-" 与空白视作等价 —— "one take"/"one-take"/"one—take"、"hard cut"/"hard-cut"、
 * "0-1.2s"/"0–1.2s" 因此同源命中；少写一种写法就漏一类输入的老毛病由此关掉一整类。
 * 归一只作用于「用来匹配的副本」，用户原文一字不改。
 */
const DASH_CHARS = /[-‐‑‒–—−－]/gu;
export function normalizeSeparators(text: string): string {
  return text.replace(DASH_CHARS, "-");
}

/** 半角时间戳前缀（时间戳分镜能力）：如 "0-2s: …" / "2.5-4s: …"（归一后匹配，破折号写法一并覆盖）。 */
const TIMESTAMP_RE = /^\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*s\s*[:：]/;
/** 形状信号（R3 P1-C）：action 任意位置出现时间范围 → 该输入自证在用时间戳分镜。 */
const TIMESTAMP_ANY = /\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?\s*s/;
/** 形状信号：一镜到底（扫哪些字段由能力表的 fields 决定，本处只管词面）。 */
const SINGLE_TAKE_TEXT = /一镜到底|one[\s-]+(?:continuous[\s-]+)?take|single[\s-]+take/i;
/**
 * 形状信号：文本自证在做节拍剪辑 → 必须给数值拍长。
 * R4-P2 词面收紧到「真的在说拍子」：「upbeat」（beat 前无词界）与「跟拍」（运镜术语）
 * 不再命中 —— 误拒合法 pacing 本身就是缺陷。
 */
const BEAT_PACING_TEXT = /卡点|节拍|每拍|拍点|踩拍|\bbeat|\bbpm\b|hard[\s-]*cut/i;
/**
 * R4-c：「数值拍长」= 数字紧邻时间单位（s/sec/ms/BPM/秒/毫秒/拍），不是「文本里有个数字」。
 * 旧的 /\d/ 会被 "beat 4K"、"hard cut 16:9" 这类分辨率/比例数字冒充过关。
 */
const BEAT_NUMBER = /\d+(?:\.\d+)?\s*(?:s(?:ec(?:onds?)?)?\b|ms\b|bpm\b|秒|毫秒|拍)/i;

/**
 * 纯：负向排除名词清单的项数（去掉「画面中不出现：」类引导语后按分隔符切）。
 * 分隔符：半角/全角逗号、顿号、分号、换行、竖线、斜杠（R5 补 / 与全角／）——
 * 少一种就能把六项写成一项混过去。
 */
export function negativeTermCount(constraints: string): number {
  const text = normalizeSeparators(constraints);
  const list = text.includes("：") ? text.slice(text.indexOf("：") + 1)
    : text.includes(":") ? text.slice(text.indexOf(":") + 1)
    : text;
  return list.split(/[、,，;；\n|｜/／]/).map((t) => t.trim()).filter((t) => t.length > 0).length;
}

// 追加式扩展（#437）：mode 增加 'edit'（定向修改已有片段），editInstruction/preserve 仅 edit 用；
// shots 对 i2v/t2v 仍必填（superRefine 保底），对 edit 可空 —— 旧调用方形状全部兼容。
// 复审 R2 追加（全部 optional/default，旧形状兼容）：
//   userIntent —— 用户原话（任意语言），策略路由与变体派生的输入；
//   directionPinned —— 用户已钉死方向 → 变体出 2 个；
//   capabilities —— 声明用到的能力 id，schema 机检其约束；R3 P1-C 起声明只是附加
//   严格化信号，形状可导出的守卫（时间戳/负向项数/续接需 style/节拍数值/一镜到底文本）无条件执行。
// R4：语言不再是闸门 —— schema 永不因文字系统拒绝任何输入（详见 prompt-language.ts）。
// 这里剩下的每一条都是「输入自证的物理矛盾」，即正确性，不是风格偏好。
const seedanceInputObject = z.object({
  mode: z.enum(["i2v", "t2v", "edit"]).default("i2v"),
  style: z.string().optional(),
  pacing: z.string().optional(),
  shots: z.array(seedanceShot).max(4).default([]),
  continuesFromPrev: z.boolean().default(false),
  references: z.array(promptRef).max(8).default([]),
  cleanFootage: z.boolean().default(true),
  constraints: z.string().optional(),
  editInstruction: z.string().optional(),
  preserve: z.string().optional(),
  userIntent: z.string().optional(),
  directionPinned: z.boolean().default(false),
  capabilities: z.array(z.enum(CAPABILITY_IDS)).default([]),
});
type SeedanceInputShape = z.infer<typeof seedanceInputObject>;

/** 表驱动取值：根字段直接取；"shots.x" 跨所有 shot 收集（缺的位置留 undefined 以便判空）。 */
function readPath(v: SeedanceInputShape, path: string): unknown[] {
  const [root = "", sub] = path.split(".");
  const rootValue = (v as Record<string, unknown>)[root];
  if (!sub) return [rootValue];
  return Array.isArray(rootValue) ? rootValue.map((s) => (s as Record<string, unknown>)[sub]) : [];
}

/** 某能力全部承载字段上的文本（归一后拼接）—— 形状信号只扫这里，扫哪些字段由能力表说了算。 */
function carrierText(v: SeedanceInputShape, cap: VideoCapability): string {
  const parts = cap.fields.flatMap((p) => readPath(v, p)).filter((x): x is string => typeof x === "string");
  return normalizeSeparators(parts.join(" "));
}

/** 报错落在哪个字段上：该能力的第一个根级承载字段（同样从表读，不另写字面）。 */
function primaryPath(cap: VideoCapability): string {
  return cap.fields.find((f) => !f.includes(".")) ?? cap.fields[0]!.split(".")[0]!;
}

const carriesValue = (x: unknown): boolean =>
  typeof x === "string" ? x.trim().length > 0
    : Array.isArray(x) ? x.length > 0
      : typeof x === "boolean" ? x
        : x !== undefined && x !== null;

function requirementMet(v: SeedanceInputShape, req: CapabilityRequirement): boolean {
  const values = readPath(v, req.path);
  return req.equals === undefined ? values.some(carriesValue) : values.some((x) => x === req.equals);
}

function requirementMessage(cap: VideoCapability, req: CapabilityRequirement): string {
  const what = req.equals === undefined ? `requires ${req.path}` : `requires ${req.path} to be ${String(req.equals)}`;
  return `capability ${cap.id} ${what}${req.whyEn ? ` — ${req.whyEn}` : ""}`;
}

export const seedancePromptInput = seedanceInputObject
  .superRefine((v, ctx) => {
    if (v.mode === "edit" && !v.editInstruction?.trim()) {
      ctx.addIssue({ code: "custom", message: "mode:'edit' requires editInstruction", path: ["editInstruction"] });
    }
    if (v.mode !== "edit" && v.shots.length === 0) {
      ctx.addIssue({ code: "custom", message: "at least one shot is required for i2v/t2v", path: ["shots"] });
    }

    // ── 能力约束机检（复审 craft 2；R3 P1-C：凡能从输入形状导出的守卫无条件执行）。
    // capabilities 声明只是「附加的严格化信号」——它永远不是唯一闸门：
    // 输入形状自证的物理矛盾，不声明也一律拦下。
    // R5：扫描集与要求集全部来自 VIDEO_CAPABILITIES，本段没有一处手写字段清单。
    const caps = new Set(v.capabilities);

    // 表驱动的能力要求：申报某能力 → 它在表里声明的每条 requires 都被机检，
    // 所以不存在「进了 enum 却什么也不绑定」的能力 id。「值要求」（continuesFromPrev:true、
    // mode:'t2v'）同时是形状信号：输入自证成立时视同申报，其余要求照样执行 ——
    // 「continuesFromPrev 却没有 style」不申报也照拦。
    for (const cap of VIDEO_CAPABILITIES) {
      if (cap.requires.length === 0) continue;
      const signals = cap.requires.filter((r) => r.equals !== undefined);
      const selfEvident = signals.length > 0 && signals.every((r) => requirementMet(v, r));
      if (!caps.has(cap.id) && !selfEvident) continue;
      for (const req of cap.requires) {
        if (requirementMet(v, req)) continue;
        ctx.addIssue({ code: "custom", path: [req.path.split(".")[0]!], message: requirementMessage(cap, req) });
      }
    }

    // 一镜到底：申报之外，能力表列出的任一承载字段自证一镜到底也触发（单 shot 无剪辑）。
    // edit 模式按设计就没有 shots，这条不适用。
    if (v.mode !== "edit"
      && (caps.has(SINGLE_TAKE.id) || SINGLE_TAKE_TEXT.test(carrierText(v, SINGLE_TAKE)))
      && v.shots.length !== 1) {
      ctx.addIssue({ code: "custom", path: ["shots"],
        message: "a single continuous take requires exactly ONE shot (one continuous take has no cuts)" });
    }

    // 时间戳分镜：任一承载字段出现时间范围（或已声明）→ 无条件验：前缀齐全、start<end、
    // 升序不重叠、段段连续无缝隙（与能力表「段段连续无缝隙」同文）。
    const timedFields = TIMESTAMPED.fields.filter((f) => f.startsWith("shots.")).map((f) => f.slice("shots.".length));
    const shotText = (s: z.infer<typeof seedanceShot>, field: string) =>
      normalizeSeparators(String((s as Record<string, unknown>)[field] ?? ""));
    const timestampOf = (s: z.infer<typeof seedanceShot>) => {
      for (const field of timedFields) {
        const m = TIMESTAMP_RE.exec(shotText(s, field));
        if (m) return { field, m };
      }
      return undefined;
    };
    const selfTimed = v.shots.some((s) => timedFields.some((f) => TIMESTAMP_ANY.test(shotText(s, f))));
    if (caps.has(TIMESTAMPED.id) || selfTimed) {
      const reportField = timedFields[0] ?? "action";
      let prevEnd: number | null = null;
      v.shots.forEach((s, i) => {
        const hit = timestampOf(s);
        if (!hit) {
          ctx.addIssue({ code: "custom", path: ["shots", i, reportField],
            message: "timestamped shots require EVERY shot's action to start with a half-width time range like '0-2s:'" });
          return;
        }
        const start = Number(hit.m[1]);
        const end = Number(hit.m[2]);
        if (!(start < end)) {
          ctx.addIssue({ code: "custom", path: ["shots", i, hit.field],
            message: "timestamp range must have start < end" });
          return;
        }
        if (prevEnd !== null && start !== prevEnd) {
          ctx.addIssue({ code: "custom", path: ["shots", i, hit.field],
            message: start < prevEnd
              ? "timestamps must be ascending and non-overlapping across shots"
              : "timestamped shots must be continuous — each range starts exactly where the previous one ends (no gaps)" });
        }
        prevEnd = end;
      });
    }

    // 音乐卡点：能力表列出的任一承载字段谈到卡点/节拍/hard cut（或已声明）→ 要求数值拍长。
    // R4-c：数值必须紧邻时间单位，"4K"/"16:9" 这类裸数字不算。
    const beatText = carrierText(v, BEAT_SYNC);
    if ((caps.has(BEAT_SYNC.id) || BEAT_PACING_TEXT.test(beatText)) && !BEAT_NUMBER.test(beatText)) {
      ctx.addIssue({ code: "custom", path: [primaryPath(BEAT_SYNC)],
        message: "beat-synced pacing requires a NUMERIC beat length (e.g. 每拍约 0.5s, hard cut) — the engine cannot hear music" });
    }

    // 负向排除：项数上限从形状即可导出 —— 无条件 ≤5（constraints 必填由表里的 requires 管）。
    const negativeText = carrierText(v, NEGATIVE_EXCLUSION);
    if (negativeText.trim() && negativeTermCount(negativeText) > 5) {
      ctx.addIssue({ code: "custom", path: [primaryPath(NEGATIVE_EXCLUSION)],
        message: "constraints allows at most 5 negative terms — keep the strongest 5" });
    }
  });
export type SeedancePromptInput = z.infer<typeof seedancePromptInput>;

/**
 * 纯：语言只给建议，绝不拦（#437 R4）。叙事字段主体文字系与引擎偏好（PROMPT_LANGUAGES
 * 里 seedance = zh）不符 → 一句 languageAdvice 随装配结果返回；相符 → undefined。
 * 行业词字段（camera/shotFraming/sceneLight/style/pacing）与台词字段（audio）本就该夹英文，
 * 不参与判定。
 */
export function seedanceLanguageAdvice(i: SeedancePromptInput): string | undefined {
  const language = promptLanguageFor("seedance");
  if (!language) return undefined;
  return languageAdvice(language, [
    i.editInstruction, i.preserve, i.constraints,
    ...i.shots.flatMap((s) => [s.subject, s.action, s.mood]),
  ]);
}

/** edit 模式缺省保持句（三保：画面/动作/运镜）——缺保持句 = 整片重绘。 */
export const EDIT_PRESERVE_DEFAULT = "其余画面、人物动作与运镜保持不变";

/**
 * 纯：结构化意图 → 视频引擎创作 prompt（正文中文 —— 实测中文提示词语义还原更优；
 * 运镜/景别等行业词保留英文；无技术 flag —— provider 追加 --resolution/--duration/--ratio）。
 */
export function assembleSeedance(i: SeedancePromptInput, variantNote?: string): string {
  const locks = identityLockClauseZh(i.references);

  // edit：指令 + 身份锁 + 保持句 + 附加约束，一行输出（对已有片段的定向修改，不是重新生成）。
  if (i.mode === "edit") {
    return [(i.editInstruction ?? "").trim(), locks, i.preserve ?? EDIT_PRESERVE_DEFAULT, i.constraints]
      .filter(Boolean)
      .join("，");
  }

  const lines: string[] = [];
  if (i.style) lines.push(i.style);
  const single = i.shots.length === 1;
  i.shots.forEach((s, idx) => {
    // 固定专业语序（复审 craft 1）：景别 → 主体 → 动作 → 运镜 → 光线 → 氛围 → 声音。
    // 缺省字段整句省略（filter(Boolean) —— 无悬空逗号），子句顺序恒定，不代填内容。
    const seg = [
      idx === 0 && i.continuesFromPrev && "承接上一段画面",
      idx === 0 && !i.continuesFromPrev && i.mode === "i2v" && "从给定的首帧画面开始",
      s.shotFraming, // 景别
      s.subject, // 主体
      s.action, // 动作
      s.camera, // 运镜
      s.sceneLight, // 光线
      s.mood, // 氛围
      s.audio && `声音: ${s.audio}`, // 声音收尾
    ].filter(Boolean).join(", ");
    lines.push(single ? seg : `Shot ${idx + 1}: ${seg}`);
  });
  if (i.mode === "i2v") lines.push("主体与首帧画面保持一致");
  if (locks) lines.push(locks);
  if (i.pacing) lines.push(i.pacing);
  if (variantNote) lines.push(variantNote); // 变体处理说明（R3 P2）：必须在负向清单之前 —— 负向清单永远收尾
  const hasLockedBrandmark = i.references.some((r) => r.role === "brandmark" && r.lock);
  if (i.cleanFootage && !hasLockedBrandmark) lines.push("画面中不出现文字、水印或 logo");
  if (i.constraints) lines.push(i.constraints);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// 变体派生（复审 P1-A 接线）：同一意图 → 2-3 条由不同主导轴驱动的 prompt。
// 每个轴的处理 = 替换该轴字段 + 追加一行三子句的专业处理说明（确定性数据表，
// 非同义改写 —— checkVariantSet 的子句级相似度守卫由构造保证通过）。
// 身份 references 与用户内容（subject/action）在所有变体间保持不动。
// ---------------------------------------------------------------------------
type VideoAxis = "composition" | "mood" | "motion"; // = VIDEO_VARIANT_AXES（测试断言同源）

const VIDEO_AXIS_TREATMENTS: Readonly<
  Record<VideoAxis, ReadonlyArray<{ shot: Partial<z.infer<typeof seedanceShot>>; note: string }>>
> = {
  composition: [
    { shot: { shotFraming: "close-up" }, note: "低角度仰拍，主体占满画面，背景被压缩" },
    { shot: { shotFraming: "wide" }, note: "对称构图，主体置于画面中央，四周留出大量负空间" },
  ],
  mood: [
    { shot: { sceneLight: "moody low-key", mood: "克制而安静的氛围" }, note: "冷色调低照度，侧逆光勾出轮廓，情绪内敛" },
    { shot: { sceneLight: "bright high-key", mood: "轻快明亮的氛围" }, note: "暖色调高调光，正面柔光铺满，情绪轻盈" },
  ],
  motion: [
    { shot: { camera: "orbit" }, note: "运镜绕主体匀速环绕，路径连贯，收在主体正面" },
    { shot: { camera: "handheld follow" }, note: "手持跟拍带轻微晃动，贴近主体，节奏加快" },
  ],
};

/**
 * 纯：确定性视频变体。取前 count 个轴（composition/mood/motion），每轴选第一个
 * 与现有输入不重合的处理（重合则取第二个），全 shot 应用字段替换并追加处理说明行。
 * edit 模式不在此派生（一次一处修改，变体由 Otto 层给出不同的修改方向）。
 */
export function seedanceVariants(i: SeedancePromptInput, count: 2 | 3): PromptVariant[] {
  const base = assembleSeedance(i);
  return (VIDEO_VARIANT_AXES.slice(0, count) as VideoAxis[]).map((axis) => {
    const options = VIDEO_AXIS_TREATMENTS[axis];
    const t = options.find((o) => Object.values(o.shot).every((val) => !base.includes(String(val)))) ?? options[1]!;
    const patched: SeedancePromptInput = { ...i, shots: i.shots.map((s) => ({ ...s, ...t.shot })) };
    // R3 P2：处理说明经 assembleSeedance 织入负向清单之前，保住「负向清单收尾」的装配律。
    return { axis, note: t.note, prompt: assembleSeedance(patched, t.note) };
  });
}
