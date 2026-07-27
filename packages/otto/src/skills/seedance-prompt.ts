/**
 * seedancePrompt — $0 确定性视频 prompt 装配 skill（free/read/internal → 不审批）。
 * 只出创作 prompt（中文正文，英文运镜词），技术 flag 由 provider 追加。Otto 提视频前先调它、用返回的 prompt。
 * 语言依据：Blueprint v2.13 —— 生成 prompt 语言由各引擎的 prompt 权威模块按实测最优决定；本引擎实测中文更优。
 * 商密：description 与装配输出对用户只称「视频引擎」，不出现供应商/模型商号（文件名等内部标识符不受限）。
 */
import { defineOttoSkill } from "../skill.js";
import { seedancePromptInput, assembleSeedance } from "./seedance-prompt.helpers.js";
import { CAMERA_MOVES, SHOT_SCALES, LIGHTING, enOnly } from "./prompt-vocab.js";

export const seedancePromptSkill = defineOttoSkill({
  name: "seedancePrompt",
  cost: "free",
  effect: "read",
  reach: "internal",
  description:
    "Assemble a model-tuned VIDEO prompt for the video engine. Write the prompt BODY in CHINESE — this " +
    "engine measurably performs best with Chinese — keeping industry camera/framing terms in English " +
    "(dolly in, close-up); subjects, actions, lighting, and mood go in Chinese. The CREATIVE prompt only; " +
    "never add resolution/duration/ratio (the system appends those). Call this FIRST before proposing a " +
    "video, then use the returned `prompt`. Primary mode i2v: describe the MOTION relative to the first " +
    "frame (what moves, how), not the static scene. Use mode:'t2v' when there is NO source frame to " +
    "animate (a from-scratch video) — otherwise the prompt would wrongly reference a first frame. Use " +
    "mode:'edit' for a targeted change to an EXISTING clip: fill editInstruction (one change per call, in " +
    "Chinese, e.g. 将T恤由白色改为黄色) and optionally preserve; shots are not needed. Our users don't know " +
    "cinematography — YOU fill it: give each shot a clear action, and add exactly ONE camera move, a shot " +
    "framing, and scene lighting even if unmentioned. One shot = one beat; use up to 4 shots for a " +
    "multi-beat clip; for precisely timed beats, prefix each shot's action with a half-width time range " +
    "('0-2s: …') that sums to the clip's duration. For beat-synced cuts, put the numeric beat length in " +
    "pacing (每拍约 0.5s, hard cut) — the engine cannot hear music. Set continuesFromPrev:true for a shot " +
    "that follows a prior clip, keep style word-for-word identical across segments, and do NOT re-describe " +
    "appearances in a continuation. List @-referenced entities in `references` to lock identity. " +
    "cleanFootage defaults true (bans on-screen text/watermark/logo) — set false only when text or a logo " +
    "should appear in the video. Extra exclusions go in `constraints` as a short noun list (≤5 items). " +
    `Camera — use ONE per shot from: ${enOnly(CAMERA_MOVES).join(", ")}. ` +
    `Shot framing from: ${enOnly(SHOT_SCALES).join(", ")}. ` +
    `Lighting — always give direction + color temperature, e.g.: ${enOnly(LIGHTING).join(", ")}.`,
  parameters: seedancePromptInput,
  execute: async (i) => ({ prompt: assembleSeedance(i) }),
});

export const seedancePrompt = seedancePromptSkill.tool;
