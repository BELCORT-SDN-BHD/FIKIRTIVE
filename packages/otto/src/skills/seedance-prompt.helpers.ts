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

/**
 * R6（判官 P2 误伤收口）：文本信号必须尊重否定语境 ——「不要一镜到底，使用多镜头」是在
 * 排除一镜到底，不是在申报它。单一实现：凡词面信号（一镜到底/节拍）与负向清单计数都从
 * 这里走，任何守卫不得自抄子句切分或否定词表。
 *
 * 口径（中英同治）：
 *   ① 子句边界 = 逗号/句号/分号/叹问号/换行/竖线；顿号与斜杠是并列分隔，不断句；
 *      数字夹着的小数点（0.5s）不断句；
 *   ② 命中所在子句内、命中位置**之前**出现否定词（不要/不用/无需/避免/…、
 *      no/not/-n't/avoid/without/…）→ 该命中不计入能力信号；
 *   ③ 单字 别/勿/莫 只在子句开头算否定（「特别流畅」「告别」不是否定，「别的」也不是）；
 *   ④ 紧贴命中的 不/无/没/非（「不卡点」「非一镜到底」）也算否定。
 * 否定误判的代价只是「少一个形状信号」—— capabilities 显式申报的执法路径不受影响。
 */
const CLAUSE_BOUNDARY_RE = /[，,;；!！?？\n|｜。]|(?<!\d)\.(?!\d)/gu;
const NEG_PHRASE_RE =
  /不要|不得|不能|不可|不用|不需|不必|无需|不许|不准|不出现|不再|不含|不带|没有|避免|禁止|杜绝|切勿|请勿|严禁|\b(?:no|not|never|avoid|without|exclude|excluding|omit|skip)\b|\b[a-z]+n['’]t\b/iu;
const NEG_LEAD_RE = /^\s*(?:别(?!的)|勿|莫)/u;
const NEG_ADJACENT_RE = /[不无没非]\s*$/u;

/** 子句及其在全文中的起点（起点供 firstNegationEnd 定位否定词）。 */
function clauseSpans(text: string): Array<{ clause: string; start: number }> {
  const spans: Array<{ clause: string; start: number }> = [];
  let start = 0;
  for (const m of text.matchAll(CLAUSE_BOUNDARY_RE)) {
    spans.push({ clause: text.slice(start, m.index!), start });
    start = m.index! + m[0].length;
  }
  spans.push({ clause: text.slice(start), start });
  return spans;
}

/**
 * 纯：文本里是否存在**非否定语境**的信号命中。signal 不得带 g 标志（本文件的词面
 * 信号都如此）。每个子句只看第一个命中 —— 同一子句「先否定后肯定」同一词面的写法
 * 不构成自然语料。
 */
export function hasAffirmativeSignal(text: string, signal: RegExp): boolean {
  return clauseSpans(normalizeSeparators(text)).some(({ clause }) => {
    const hit = signal.exec(clause);
    if (!hit) return false;
    const before = clause.slice(0, hit.index);
    return !(NEG_LEAD_RE.test(clause) || NEG_ADJACENT_RE.test(before) || NEG_PHRASE_RE.test(before));
  });
}

/** 全文最早一个否定词的结束位置（无否定词 → -1）。负向清单计数用；词表与信号判定同源。 */
function firstNegationEnd(text: string): number {
  for (const { clause, start } of clauseSpans(text)) {
    const hits = [NEG_LEAD_RE.exec(clause), NEG_PHRASE_RE.exec(clause)]
      .filter((m): m is RegExpExecArray => m !== null)
      .sort((a, b) => a.index - b.index);
    if (hits[0]) return start + hits[0].index + hits[0][0].length;
  }
  return -1;
}

/** 半角时间戳前缀（时间戳分镜能力）：如 "0-2s: …" / "2.5-4s: …"（归一后匹配，破折号写法一并覆盖）。 */
const TIMESTAMP_RE = /^\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*s\s*[:：]/;
/**
 * 形状信号（R5-P2）：字段**以**时间区间开头。
 * 旧的「任意位置出现两个数字夹一个横杠」把散文里的时长当成时间戳：
 * "a 3-5s hold"、"a 3-5 second dolly" 都被判成时间戳清单然后因「缺前缀」拒掉 ——
 * 后者从 R3 起就一直误拒。检出与执法现在用同一把尺：时间戳清单的形状是「行首区间」，
 * 这是散文不会出现的写法，因此关掉的是「句中出现数字区间」一整类，而不是逐个词打补丁。
 */
const TIMESTAMP_LEAD = /^\s*\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?\s*s\b/;
/** 形状信号：一镜到底（扫哪些字段由能力表的 fields 决定，本处只管词面）。 */
const SINGLE_TAKE_TEXT = /一镜到底|one[\s-]+(?:continuous[\s-]+)?take|single[\s-]+take/i;
/**
 * 形状信号：文本自证在做节拍剪辑 → 必须给数值拍长。
 * R4-P2 词面收紧到「真的在说拍子」：「upbeat」（beat 前无词界）与「跟拍」（运镜术语）不再命中。
 * R5-P2 再收一层：「beat」这个词本身不是节拍申报 —— "beats the drum"、"heart is beating"、
 * "wings beat slowly" 都是普通动词，拒掉它们就是在拒合法输入。判定改为「节奏义必须先被确立」，
 * 两条来源二选一：
 *   ① 词形自证（本条）：卡点/每拍/拍点/踩拍/节拍、bpm、beat 与 sync/match/drop/cut 相邻、
 *      on/to/per the beat —— 这些搭配没有第二种意思，出现在能力表的**任何**承载字段都算申报；
 *   ② 字段职责（BEAT_WEAK_TEXT，见下）。
 */
const BEAT_RHYTHM_TEXT =
  /卡点|每拍|拍点|踩拍|节拍|\bbpm\b|\bbeat[\s-]*(?:sync\w*|match\w*|drop|cut)|\b(?:on|to|per|off)[\s-]+the[\s-]+beat\b|\bper[\s-]+beat\b/i;
/**
 * 歧义词面：只有写在「职责字段」里才算申报。职责字段不是手写的，是能力表 requires 指到的那格
 * （beatSync.requires → pacing，「带时间单位的拍长就写在这里」）—— pacing 这一格的存在意义
 * 就是节奏，写在这里的 beat / hard cut 只可能是拍子；写在 action / shotFraming / style 里的
 * 同一个词则是普通动词或转场描述，不构成节拍申报。
 */
const BEAT_WEAK_TEXT = /\bbeat|hard[\s-]*cut|硬切/i;
/**
 * R4-c：「数值拍长」= 数字紧邻时间单位（s/sec/ms/BPM/秒/毫秒/拍），不是「文本里有个数字」。
 * 旧的 /\d/ 会被 "beat 4K"、"hard cut 16:9" 这类分辨率/比例数字冒充过关。
 */
const BEAT_NUMBER = /\d+(?:\.\d+)?\s*(?:s(?:ec(?:onds?)?)?\b|ms\b|bpm\b|秒|毫秒|拍)/i;

/**
 * 纯：负向排除名词清单的项数。
 * R6：只统计**否定语境**覆盖的清单 ——「preserve face/wardrobe/…」是保持条件，不是
 * 排除清单，计 0（旧口径把 constraints 里任何清单都当负向清单数，正是判官的误伤例）。
 * 否定词表与 hasAffirmativeSignal 同源（单一实现）：
 *   ① 无否定词 → 0；
 *   ② 否定词后同子句内有冒号（「画面中不出现：」）→ 清单 = 冒号后的全部文本，
 *      分隔符沿用旧口径：顿号、半/全角逗号、分号、换行、竖线、斜杠 ——
 *      少一种就能把六项写成一项混过去；
 *   ③ 无冒号 → 清单 = 否定词起到句末（句号/分号/换行/竖线），分隔符 、,，/／。
 */
export function negativeTermCount(constraints: string): number {
  const text = normalizeSeparators(constraints);
  const negEnd = firstNegationEnd(text);
  if (negEnd < 0) return 0;
  const rest = text.slice(negEnd);
  const colon = /^[^，,;；!！?？\n|｜。.]*[：:]/.exec(rest);
  let list: string;
  let splitter: RegExp;
  if (colon) {
    list = rest.slice(colon[0].length);
    splitter = /[、,，;；\n|｜/／]/;
  } else {
    const end = rest.search(/[;；!！?？\n|｜。]|(?<!\d)\.(?!\d)/u);
    list = end < 0 ? rest : rest.slice(0, end);
    splitter = /[、,，/／]/;
  }
  return list.split(splitter).map((t) => t.trim()).filter((t) => t.length > 0).length;
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

/**
 * 某能力全部承载字段上的文本（归一后拼接）—— 形状信号只扫这里，扫哪些字段由能力表说了算。
 * R6：用换行拼接 —— 换行是子句边界，字段各成子句，甲字段句尾的否定词不会「管到」乙字段。
 */
function carrierText(v: SeedanceInputShape, cap: VideoCapability): string {
  const parts = cap.fields.flatMap((p) => readPath(v, p)).filter((x): x is string => typeof x === "string");
  return normalizeSeparators(parts.join("\n"));
}

/**
 * 「职责字段」上的文本：该能力 requires 指到的字段（beatSync → pacing）。
 * 承载字段（fields）回答「这项能力可能被写在哪」，职责字段回答「哪一格的存在意义就是这项能力」——
 * 歧义词面只在后者算申报。同样从表读，本文件不写死任何字段名。
 */
function roleText(v: SeedanceInputShape, cap: VideoCapability): string {
  const parts = cap.requires.flatMap((r) => readPath(v, r.path)).filter((x): x is string => typeof x === "string");
  return normalizeSeparators(parts.join("\n")); // 换行拼接同 carrierText（R6）
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
    // R6：否定语境的命中不算自证 ——「不要一镜到底，使用多镜头」是在排除这项能力。
    if (v.mode !== "edit"
      && (caps.has(SINGLE_TAKE.id) || hasAffirmativeSignal(carrierText(v, SINGLE_TAKE), SINGLE_TAKE_TEXT))
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
    // R5-P2 检出口径：时间戳清单的形状是「行首区间」，不是「句子里有两个数字夹横杠」。
    // 规范形（区间+冒号）出现一处即成立；无冒号的写法要求**每个** shot 都以区间开头
    // （多 shot 齐刷刷以区间开头是清单，散文里的一句时长不是）—— 随后仍按「每段都要前缀」执法。
    const canonical = v.shots.some((s) => timestampOf(s) !== undefined);
    const allLead = v.shots.length > 1
      && v.shots.every((s) => timedFields.some((f) => TIMESTAMP_LEAD.test(shotText(s, f))));
    if (caps.has(TIMESTAMPED.id) || canonical || allLead) {
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

    // 音乐卡点：能力表列出的任一承载字段自证「节奏意图」（或已声明）→ 要求数值拍长。
    // R4-c：数值必须紧邻时间单位，"4K"/"16:9" 这类裸数字不算。
    // R5-P2：节奏意图 = 无歧义词形（任何承载字段）∪ 歧义词形写在职责字段（pacing）里。
    // 「beat 这个词出现过」不再等于申报 —— 鼓手打鼓、心跳、振翅都是合法输入。
    // R6：否定语境的命中不算意图 ——「不要卡点」「no hard cuts」是在排除这项能力。
    const beatText = carrierText(v, BEAT_SYNC);
    const beatIntent = caps.has(BEAT_SYNC.id)
      || hasAffirmativeSignal(beatText, BEAT_RHYTHM_TEXT)
      || hasAffirmativeSignal(roleText(v, BEAT_SYNC), BEAT_WEAK_TEXT);
    if (beatIntent && !BEAT_NUMBER.test(beatText)) {
      ctx.addIssue({ code: "custom", path: [primaryPath(BEAT_SYNC)],
        message: "beat-synced pacing requires a NUMERIC beat length (e.g. 每拍约 0.5s, hard cut) — the engine cannot hear music" });
    }

    // 负向排除：项数上限从形状即可导出 —— 无条件 ≤5（constraints 必填由表里的 requires 管）。
    // R6：negativeTermCount 只数否定语境覆盖的清单 ——「preserve …」保持条件不再被误算。
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
