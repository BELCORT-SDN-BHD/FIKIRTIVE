/**
 * seedreamPrompt — $0 确定性图像 prompt 装配 skill（free/read/internal → 不审批）。
 * 结构化意图 → Seedream 调优的英文 prompt 字符串；Otto 把它喂进 propose.structuredPrompt。
 */
import { defineOttoSkill } from "../skill.js";
import { seedreamPromptInput, assembleSeedream } from "./seedream-prompt.helpers.js";
import { LIGHTING, STYLES, enOnly, referenceAdvice } from "./prompt-vocab.js";

export const seedreamPromptSkill = defineOttoSkill({
  name: "seedreamPrompt",
  cost: "free",
  effect: "read",
  reach: "internal",
  description:
    "Assemble a model-tuned English IMAGE prompt for Seedream. Call this FIRST whenever you are about " +
    "to propose an image, then pass the returned `prompt` as propose's structuredPrompt. Our users don't " +
    "know photography — YOU supply the craft: always give a concrete subject, and add style, lighting " +
    "(direction + color temperature), camera/lens, and composition even if the user didn't mention them. " +
    "Use mode:'i2i' ONLY when an @-referenced entity supplies the source image (pass its id via propose's " +
    "entityIds); to change a prior generation with no entity, use t2i instead. For i2i, fill editVerb + " +
    "editTarget + what to preserve. Set forVideo:true " +
    "when the image is a video's first frame. List any @-referenced entities in `references` (role + name) so " +
    "their identity is locked; the reference image itself is passed separately via propose's entityIds. " +
    // #774 U2 —— 编号契约。错位比不编号更糟，所以两条前提逐字写给 Otto。
    // （措辞里刻意不带尖括号：`>` 属于导航路径分隔符族，写进描述面会被 #802 的地图硬规则
    //   当成一条不存在的路。编号本身照写不误 —— 它在装配结果里，不在这句教学文案里。）
    "`references` ORDER IS LOAD-BEARING: list them in the SAME order as the ids you pass to propose's " +
    "entityIds, and list ONLY entities that actually have reference images — the prompt numbers them " +
    "Image_1, Image_2 and so on to match the order the system really sends, and a wrong order is worse " +
    "than no numbering. Set baseImage:true when the user attached an image or is editing one they are " +
    "viewing (that image is sent first, so your references start at Image_2). " +
    // #774 U4 —— 画幅接线。同一个形状必须同时传给这里和 propose。
    "Pass `aspect` with the SAME shape you will pass to propose's desiredAspect — a vertical image gets an " +
    "extra caption-free instruction, because vertical output is the shape most likely to grow captions " +
    "nobody asked for. " +
    // #774 U8 —— 只提醒，不设限（商家的 data 商家的权利）。
    "If the skill returns `notes`, tell the user those points in your own plain words and let them decide — " +
    "they are advice, never a limit: never refuse, cap, or silently drop references the user gave you. " +
    `Lighting (give direction + color temperature), e.g.: ${enOnly(LIGHTING).join(", ")}. ` +
    `Style, e.g.: ${enOnly(STYLES).join(", ")}.`,
  parameters: seedreamPromptInput,
  execute: async (i) => {
    const notes = referenceAdvice(i.references);
    return { prompt: assembleSeedream(i), ...(notes.length > 0 ? { notes } : {}) };
  },
});

export const seedreamPrompt = seedreamPromptSkill.tool;
