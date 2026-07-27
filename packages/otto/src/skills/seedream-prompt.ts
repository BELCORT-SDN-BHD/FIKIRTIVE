/**
 * seedreamPrompt — $0 确定性图像 prompt 装配 skill（free/read/internal → 不审批）。
 * 结构化意图 → 图像引擎调优的英文 prompt 字符串；Otto 把它喂进 propose.structuredPrompt。
 * 语言依据：Blueprint v2.13 —— 生成 prompt 语言按各引擎实测最优；本引擎现有实测英文最优，
 * 若日后实测翻转，先改 prompt-skills.ts 的 PROMPT_LANGUAGES 再改装配，不许静默换语言。
 * 商密：description 与装配输出对用户只称「图像引擎」，不出现供应商/模型商号（文件名等内部标识符不受限）。
 */
import { defineOttoSkill } from "../skill.js";
import { seedreamPromptInput, assembleSeedream } from "./seedream-prompt.helpers.js";
import { LIGHTING, STYLES, enOnly } from "./prompt-vocab.js";

export const seedreamPromptSkill = defineOttoSkill({
  name: "seedreamPrompt",
  cost: "free",
  effect: "read",
  reach: "internal",
  description:
    "Assemble a model-tuned English IMAGE prompt for the image engine — image prompts stay in ENGLISH " +
    "(front-loaded: the earliest tokens carry the most weight). Call this FIRST whenever you are about " +
    "to propose an image, then pass the returned `prompt` as propose's structuredPrompt. Our users don't " +
    "know photography — YOU supply the craft: always give a concrete subject, and add style, lighting " +
    "(direction + color temperature), camera/lens, and composition even if the user didn't mention them. " +
    "Use mode:'i2i' ONLY when an @-referenced entity supplies the source image (pass its id via propose's " +
    "entityIds); to change a prior generation with no entity, use t2i instead. For i2i, fill editVerb + " +
    "editTarget + what to preserve. Set forVideo:true " +
    "when the image is a video's first frame. List any @-referenced entities in `references` (role + name) so " +
    "their identity is locked; the reference image itself is passed separately via propose's entityIds. " +
    `Lighting (give direction + color temperature), e.g.: ${enOnly(LIGHTING).join(", ")}. ` +
    `Style, e.g.: ${enOnly(STYLES).join(", ")}.`,
  parameters: seedreamPromptInput,
  execute: async (i) => ({ prompt: assembleSeedream(i) }),
});

export const seedreamPrompt = seedreamPromptSkill.tool;
