import { z } from "zod";
import { promptRef, identityLockClause } from "./prompt-vocab.js";
import { languageAdvice, promptLanguageFor } from "../prompt-language.js";
import { IMAGE_VARIANT_AXES, type PromptVariant } from "./variant-policy.js";

// 复审 R2 追加（全部 optional/default，旧形状兼容）：userIntent（策略路由输入）、
// directionPinned（方向已钉死 → 2 个变体）。
// R4：语言不再是闸门 —— schema 永不因文字系统拒绝任何输入（判官实证硬门会拒掉
// "a product photo 辣椒酱" 这类合法输入）。语言改走 seedreamLanguageAdvice 的非阻断
// 建议 + 写作端执法，详见 prompt-language.ts。
export const seedreamPromptInput = z
  .object({
    mode: z.enum(["t2i", "i2i"]).default("t2i"),
    subject: z.string().min(1),
    actionPose: z.string().optional(),
    environment: z.string().optional(),
    style: z.string().optional(),
    lighting: z.string().optional(),
    colorPalette: z.string().optional(),
    cameraLens: z.string().optional(),
    mood: z.string().optional(),
    detail: z.string().optional(),
    textContent: z.string().max(60).optional(),
    forVideo: z.boolean().default(false),
    references: z.array(promptRef).max(8).default([]),
    editVerb: z.enum(["Add", "Remove", "Replace", "Change"]).optional(),
    editTarget: z.string().optional(),
    preserve: z.string().optional(),
    userIntent: z.string().optional(),
    directionPinned: z.boolean().default(false),
  });

export type SeedreamPromptInput = z.infer<typeof seedreamPromptInput>;

/**
 * 纯：语言只给建议，绝不拦（#437 R4）。散文字段主体文字系与引擎偏好（PROMPT_LANGUAGES
 * 里 seedream = en）不符 → 一句 languageAdvice 随装配结果返回；相符 → undefined。
 * textContent（要画进图里的文字）与 userIntent（用户原话）本就任意语言，不参与判定；
 * 度量类字段（cameraLens "50mm"、colorPalette）也不参与。
 */
export function seedreamLanguageAdvice(i: SeedreamPromptInput): string | undefined {
  const language = promptLanguageFor("seedream");
  if (!language) return undefined;
  return languageAdvice(language, [
    i.subject, i.actionPose, i.environment, i.mood, i.detail, i.editTarget, i.preserve,
  ]);
}

/** 纯：结构化意图 → Seedream 偏好的英文 prose prompt（最前 token 权重最高）。 */
export function assembleSeedream(i: SeedreamPromptInput): string {
  const locks = identityLockClause(i.references);
  if (i.mode === "i2i") {
    const parts: (string | false | undefined)[] = [
      `${i.editVerb ?? "Change"} ${i.editTarget ?? ""}`.trim(),
      i.style && `restyle to ${i.style}`,
      i.lighting,
      locks,
      i.preserve ?? "keep everything else unchanged, maintain the same composition and lighting",
    ];
    return parts.filter(Boolean).join(", ");
  }
  const parts: (string | false | undefined)[] = [
    i.subject,
    i.actionPose,
    i.environment,
    i.style,
    i.lighting,
    i.colorPalette,
    i.cameraLens,
    i.mood,
    i.detail,
    i.forVideo && "clean uncluttered composition with headroom for motion, single dominant light direction",
    locks,
    i.textContent && `with the text "${i.textContent}" in bold sans-serif, placed prominently`,
  ];
  return parts.filter(Boolean).join(", ");
}

// ---------------------------------------------------------------------------
// 变体派生（复审 P1-A 接线，图像侧）：轴 = 构图 / 氛围 / 风格。
// 每轴处理 = 替换该轴字段 + 追加三子句英文处理说明（确定性数据表，非同义改写）。
// 身份 references 与主体内容在所有变体间保持不动。
// ---------------------------------------------------------------------------
type ImageAxis = "composition" | "mood" | "style"; // = IMAGE_VARIANT_AXES（测试断言同源）

const IMAGE_AXIS_TREATMENTS: Readonly<
  Record<ImageAxis, ReadonlyArray<{ patch: Partial<SeedreamPromptInput>; note: string }>>
> = {
  composition: [
    { patch: { cameraLens: "35mm wide-angle, low angle" }, note: "subject filling the frame, tight crop, compressed background" },
    { patch: { cameraLens: "85mm portrait lens, eye-level" }, note: "centered symmetrical composition, generous negative space, clean margins" },
  ],
  mood: [
    { patch: { lighting: "moody low-key side light", mood: "quiet, restrained mood" }, note: "cool color temperature, deep shadows, intimate atmosphere" },
    { patch: { lighting: "bright high-key light", mood: "airy, upbeat mood" }, note: "warm color temperature, soft shadows, fresh atmosphere" },
  ],
  style: [
    { patch: { style: "editorial photography" }, note: "magazine-grade styling, refined textures, premium finish" },
    { patch: { style: "minimalist" }, note: "pared-back styling, flat clean backdrop, restrained palette" },
  ],
};

/**
 * 纯：确定性图像变体。取前 count 个轴（composition/mood/style），每轴选第一个与
 * 现有输入不重合的处理，应用字段替换并把处理说明接到 prompt 末尾。
 * i2i 模式不在此派生（定向修改一次一处，变体由 Otto 层给出不同修改方向）。
 */
export function seedreamVariants(i: SeedreamPromptInput, count: 2 | 3): PromptVariant[] {
  const base = assembleSeedream(i);
  return (IMAGE_VARIANT_AXES.slice(0, count) as ImageAxis[]).map((axis) => {
    const options = IMAGE_AXIS_TREATMENTS[axis];
    const t = options.find((o) => Object.values(o.patch).every((val) => !base.includes(String(val)))) ?? options[1]!;
    return { axis, note: t.note, prompt: `${assembleSeedream({ ...i, ...t.patch })}, ${t.note}` };
  });
}
