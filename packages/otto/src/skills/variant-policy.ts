/**
 * 变体与资产清单策略（#437）—— 纯数据 + 纯函数。
 *
 * 验收：每个创作请求出 2-3 个 prompt 变体（各由不同主导轴驱动，禁同义词改写）
 * + 一份资产清单（@reference：role + 名称 + 人话理由 + lock + 就绪状态）。
 * instructions.ts 载有压缩版规则给 Otto；本模块是可测试的权威定义。
 * 商密：本文件所有字符串都可能进入用户可见文本，不得出现供应商/模型商号。
 */
import type { StrategyFamily } from "./prompt-strategy.js";
import type { PromptRef } from "./prompt-vocab.js";

export type VariantAxis = "composition" | "mood" | "motion" | "style";

/** 视频三轴：构图 / 氛围 / 运动；图像三轴：构图 / 氛围 / 风格。 */
export const VIDEO_VARIANT_AXES: readonly VariantAxis[] = ["composition", "mood", "motion"];
export const IMAGE_VARIANT_AXES: readonly VariantAxis[] = ["composition", "mood", "style"];

export interface PromptVariant {
  /** The declared leading axis — the field group that materially changes. */
  axis: VariantAxis;
  /** One plain-language line telling the user what is different. */
  note: string;
  /** The assembled prompt for this variant. */
  prompt: string;
}

const clauses = (s: string): string[] =>
  s
    .split(/[,，;；。\n]/)
    .map((c) => c.trim().toLowerCase())
    .filter((c) => c.length > 0);

/**
 * 纯：子句级相似度（中英通用）—— 逐子句（逗号/分号/换行切分）比对，
 * 相同子句数 / 较长一方的子句数。同义词级改写 = 绝大多数子句原封不动 → 高相似。
 */
export function promptSimilarity(a: string, b: string): number {
  const ca = clauses(a);
  const cb = clauses(b);
  if (ca.length === 0 || cb.length === 0) return a.trim() === b.trim() ? 1 : 0;
  const remaining = [...cb];
  let shared = 0;
  for (const c of ca) {
    const idx = remaining.indexOf(c);
    if (idx >= 0) {
      shared++;
      remaining.splice(idx, 1);
    }
  }
  return shared / Math.max(ca.length, cb.length);
}

const NEAR_IDENTICAL = 0.7;

/** 纯：机检一组变体是否合格 —— 2-3 个、轴合法且互不相同、prompt 非同义词级改写。 */
export function checkVariantSet(
  kind: "video" | "image",
  variants: readonly PromptVariant[],
): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (variants.length < 2 || variants.length > 3) {
    problems.push(`expected 2-3 variants, got ${variants.length}`);
  }
  const allowed = kind === "video" ? VIDEO_VARIANT_AXES : IMAGE_VARIANT_AXES;
  for (const v of variants) {
    if (!allowed.includes(v.axis)) problems.push(`axis "${v.axis}" is not valid for ${kind}`);
  }
  const axes = variants.map((v) => v.axis);
  if (new Set(axes).size !== axes.length) problems.push("two variants share the same leading axis");
  for (let a = 0; a < variants.length; a++) {
    for (let b = a + 1; b < variants.length; b++) {
      const va = variants[a];
      const vb = variants[b];
      if (va && vb && promptSimilarity(va.prompt, vb.prompt) >= NEAR_IDENTICAL) {
        problems.push(`variants ${a + 1} and ${b + 1} differ only at synonym level — not a real variant`);
      }
    }
  }
  return { ok: problems.length === 0, problems };
}

/**
 * 纯：出 2 个还是 3 个。方向已钉死 / 编辑型请求 / 科教族 → 2；其余 → 3（上限就是 3 ——
 * 更多选项只会让非专业用户瘫痪）。
 */
export function variantCountFor(input: {
  family: StrategyFamily;
  directionPinned?: boolean;
  editType?: boolean;
}): 2 | 3 {
  if (input.directionPinned || input.editType || input.family === "educational") return 2;
  return 3;
}

// ---------------------------------------------------------------------------
// 资产清单（@reference checklist）
// ---------------------------------------------------------------------------

export interface AssetInput {
  role: PromptRef["role"];
  name: string;
  /** Reference photos already uploaded on the elements page. */
  ready: boolean;
  lock?: boolean;
}

export interface AssetChecklistItem {
  role: PromptRef["role"];
  name: string;
  lock: boolean;
  ready: boolean;
  /** Plain-language reason the asset is needed (user-visible). */
  why: string;
  /** Present when not ready: how the user supplies it. */
  howToSupply?: string;
}

/** 人话理由，按 role 固定（用户可见，Otto 按用户语言转述）。 */
export const ASSET_WHY: Readonly<Record<PromptRef["role"], string>> = {
  character: "keeps this person looking like themselves — same face, hair, and build — in every shot",
  product: "keeps your real item — same shape, color, and label — instead of a lookalike",
  location: "keeps the setting recognizably your actual place",
  brandmark: "shows your real logo exactly, instead of an invented one",
};

export const ASSET_HOW_TO_SUPPLY = "Upload 2-3 clear photos from different angles on the elements page.";

/** 缺资产的诚实降级话术：撤下 reference、改文字描述,并向用户明说后果 —— 绝不假装已锁定。 */
export const MISSING_ASSET_WARNING =
  "Without reference photos, the person or product in the result will only look similar — an exact match is not guaranteed.";

/** 各策略族默认必备的引用 role（用户没提也要列出并向用户要）。 */
export const FAMILY_REQUIRED_ROLES: Readonly<Record<StrategyFamily, readonly PromptRef["role"][]>> = {
  ecommerce: ["product"],
  dialogueDrama: ["character"],
  fantasyAnimation: ["character"],
  educational: [],
  beatSync: [],
  generalCreative: [], // 开放场景：用户没提具体人/物/地就不主动索要
};

/** 纯：策略族 + 已知引用 → 资产清单（每项 role + 名称 + 人话理由 + lock + 就绪/补法）。 */
export function deriveAssetChecklist(
  family: StrategyFamily,
  assets: readonly AssetInput[],
): AssetChecklistItem[] {
  const items: AssetChecklistItem[] = assets.map((a) => ({
    role: a.role,
    name: a.name,
    lock: a.lock ?? true,
    ready: a.ready,
    why: ASSET_WHY[a.role],
    ...(a.ready ? {} : { howToSupply: ASSET_HOW_TO_SUPPLY }),
  }));
  for (const role of FAMILY_REQUIRED_ROLES[family]) {
    if (!items.some((i) => i.role === role)) {
      items.push({ role, name: "", lock: true, ready: false, why: ASSET_WHY[role], howToSupply: ASSET_HOW_TO_SUPPLY });
    }
  }
  return items;
}
