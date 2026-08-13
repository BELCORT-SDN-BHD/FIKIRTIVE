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
    // #774 r2 —— mode 的口径按**实际行为**统一：它只挑装配分支（改一张已有的图 vs 从零
    // 造一张），跟「哪些图会被送进引擎」无关 —— 那件事由服务端从商家自己的东西解析。
    "Use mode:'i2i' whenever this prompt CHANGES an image that already exists — the image the user " +
    "attached, the one they are viewing and editing, or an @-referenced entity's photo used as the base; " +
    "use t2i only when the picture is made from nothing. For i2i, fill editVerb + editTarget + what to " +
    "preserve. Set forVideo:true " +
    "when the image is a video's first frame. List any @-referenced entities in `references` (role + name) so " +
    "their identity is locked BY NAME; the reference images themselves travel with the card via propose's " +
    "entityIds, and the system numbers them for the engine at send time — never write image numbers yourself. " +
    // #774 U4 —— 画幅接线。同一个形状必须同时传给这里和 propose。
    "Pass `aspect` with the SAME shape you will pass to propose's desiredAspect — a vertical image gets an " +
    "extra caption-free instruction in BOTH t2i and i2i, because vertical output is the shape most likely " +
    "to grow captions nobody asked for; the only exception is when you asked for on-image text yourself " +
    "via textContent. " +
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
