/**
 * seedancePrompt — $0 确定性视频 prompt 装配 skill（free/read/internal → 不审批）。
 * 只出创作 prompt（英文），技术 flag 由 provider 追加。Otto 提视频前先调它、用返回的 prompt。
 */
import { defineOttoSkill } from "../skill.js";
import { seedancePromptInput, assembleSeedance } from "./seedance-prompt.helpers.js";

export const seedancePromptSkill = defineOttoSkill({
  name: "seedancePrompt",
  cost: "free",
  effect: "read",
  reach: "internal",
  description:
    "Assemble a model-tuned English VIDEO prompt for Seedance — the CREATIVE prompt only; never add " +
    "resolution/duration/ratio (the system appends those). Call this FIRST before proposing a video, then use " +
    "the returned `prompt`. Primary mode i2v: describe the MOTION relative to the first frame (what moves, how), " +
    "not the static scene. Use mode:'t2v' when there is NO source frame to animate (a from-scratch video) — " +
    "otherwise the prompt would wrongly reference a first frame. Our users don't know cinematography — YOU fill " +
    "it: give each shot a clear action, and add exactly ONE camera move, a shot framing, and scene lighting even " +
    "if unmentioned. One shot = one beat; use up to 4 shots for a multi-beat clip. Set continuesFromPrev:true for " +
    "a shot that follows a prior clip. List @-referenced entities in `references` to lock identity. cleanFootage " +
    "defaults true (bans on-screen text/watermark/logo) — set false only when text or a logo should appear in " +
    "the video.",
  parameters: seedancePromptInput,
  execute: async (i) => ({ prompt: assembleSeedance(i) }),
});

export const seedancePrompt = seedancePromptSkill.tool;
