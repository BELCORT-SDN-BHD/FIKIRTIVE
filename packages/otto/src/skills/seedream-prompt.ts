/**
 * seedreamPrompt — $0 确定性图像 prompt 装配 skill（free/read/internal → 不审批）。
 * 结构化意图 → 图像引擎调优的英文 prompt 字符串；Otto 把它喂进 propose.structuredPrompt。
 * 语言依据：Blueprint v2.13 —— 生成 prompt 语言按各引擎实测最优；本引擎现有实测英文最优，
 * 若日后实测翻转，先改 PROMPT_LANGUAGES（prompt-skills.ts 的权威表面）再改装配，不许静默换语言。
 * 语言执法位置（R4）：写作端 —— description 直接从 PROMPT_LANGUAGES 读语言并明写要求；
 * schema 不再拦（判官实证硬门会拒掉 "a product photo 辣椒酱" 这类合法输入），
 * 不匹配只随结果回一句 languageAdvice。
 * 商密：description 与装配输出对用户只称「图像引擎」，不出现供应商/模型商号（文件名等内部标识符不受限）。
 */
import { defineOttoSkill } from "../skill.js";
import { seedreamPromptInput, assembleSeedream, seedreamVariants, seedreamLanguageAdvice } from "./seedream-prompt.helpers.js";
import { LIGHTING, STYLES, enOnly } from "./prompt-vocab.js";
import { LANGUAGE_LABEL, LANGUAGE_REASON, requirePromptLanguage } from "../prompt-language.js";
import { decideStrategy } from "./prompt-strategy.js";
import { checkVariantSet, deriveAssetChecklist, variantCountFor } from "./variant-policy.js";

/** 语言权威（PROMPT_LANGUAGES）是这段 description 的唯一来源 —— 无条目即模块加载失败，不静默兜底。 */
const IMAGE_LANGUAGE = requirePromptLanguage("seedream");

export const seedreamPromptSkill = defineOttoSkill({
  name: "seedreamPrompt",
  cost: "free",
  effect: "read",
  reach: "internal",
  description:
    "Assemble a model-tuned IMAGE prompt for the image engine. " +
    `LANGUAGE — WRITE THE PROMPT BODY IN ${LANGUAGE_LABEL[IMAGE_LANGUAGE]} (${LANGUAGE_REASON[IMAGE_LANGUAGE]}; ` +
    "front-loaded: the earliest tokens carry the most weight). Subject, pose, environment, mood, and detail " +
    `go in ${LANGUAGE_LABEL[IMAGE_LANGUAGE]}, whatever language the user writes in; only textContent — the ` +
    "text to be RENDERED INSIDE the image — stays in the user's language. NOTHING REJECTS A WRONG-LANGUAGE " +
    "BODY — the schema never fails a prompt over its language, so a non-English body would ship exactly as " +
    "you wrote it. When the result comes back with a `languageAdvice` note, the body is in the wrong " +
    "language: rewrite it and call this skill again BEFORE proposing. Call this FIRST whenever you are about " +
    "to propose an image, then pass the returned `prompt` as propose's structuredPrompt. Our users don't " +
    "know photography — YOU supply the craft: always give a concrete subject, and add style, lighting " +
    "(direction + color temperature), camera/lens, and composition even if the user didn't mention them. " +
    "Use mode:'i2i' ONLY when an @-referenced entity supplies the source image (pass its id via propose's " +
    "entityIds); to change a prior generation with no entity, use t2i instead. For i2i, fill editVerb + " +
    "editTarget + what to preserve. Set forVideo:true " +
    "when the image is a video's first frame. List any @-referenced entities in `references` (role + name) so " +
    "their identity is locked; the reference image itself is passed separately via propose's entityIds. " +
    `Lighting (give direction + color temperature), e.g.: ${enOnly(LIGHTING).join(", ")}. ` +
    `Style, e.g.: ${enOnly(STYLES).join(", ")}. ` +
    "Always pass userIntent (the user's request in their own words, any language): the skill routes a " +
    "strategy family from it and returns 2-3 prompt `variants` (each led by a different axis) plus an " +
    "`assetChecklist` — present the variants and checklist to the user before proposing; set " +
    "directionPinned:true when the user already fixed the direction (then 2 variants).",
  parameters: seedreamPromptInput,
  execute: async (i) => {
    // 复审 P1-A 接线：策略路由 + 变体 + 素材清单在 skill 执行时真实运行，随结果返回。
    const prompt = assembleSeedream(i);
    const strategy = decideStrategy({ text: i.userIntent ?? "", referenceRoles: i.references.map((r) => r.role) });
    const family = strategy.kind === "route" ? strategy.family : strategy.candidates[0];
    const assetChecklist = deriveAssetChecklist(
      family,
      i.references.map((r) => ({ role: r.role, name: r.name, ready: true, lock: r.lock })),
    );
    // R4：语言只是提示 —— 不匹配时附一句建议，永不拒绝输入、永不改写 prompt。
    const advice = seedreamLanguageAdvice(i);
    const languageAdvice = advice ? { languageAdvice: advice } : {};
    // i2i = 定向修改一次一处：变体属于「改哪里」的产品层选择，不做确定性派生。
    if (i.mode === "i2i") return { prompt, strategy, assetChecklist, ...languageAdvice };
    const variants = seedreamVariants(i, variantCountFor({ family, directionPinned: i.directionPinned, editType: false }));
    return { prompt, strategy, variants, variantCheck: checkVariantSet("image", variants), assetChecklist, ...languageAdvice };
  },
});

export const seedreamPrompt = seedreamPromptSkill.tool;
