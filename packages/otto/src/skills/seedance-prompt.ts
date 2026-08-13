/**
 * seedancePrompt — $0 确定性视频 prompt 装配 skill（free/read/internal → 不审批）。
 * 只出创作 prompt（英文），技术 flag 由 provider 追加。Otto 提视频前先调它、用返回的 prompt。
 */
import { defineOttoSkill } from "../skill.js";
import { seedancePromptInput, assembleSeedance } from "./seedance-prompt.helpers.js";
import {
  CAMERA_MOVES, SHOT_SCALES, LIGHTING, enOnly,
  VIDEO_CONSTRAINTS, EMOTION_CUES, referenceAdvice,
} from "./prompt-vocab.js";
import { openingForTeaching, videoPromptWarnings } from "./video-capabilities.js";

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
    "otherwise the prompt would wrongly reference a first frame. " +
    // #775 —— 两个新动作。只有商家**这一轮挂了一整条片子**时才成立。
    "Two more modes exist, and BOTH require the user to have attached a whole clip this turn. " +
    "mode:'edit' — they want something INSIDE that clip changed and everything else left alone " +
    `("make the shirt red", "fix the ending"); the prompt opens with the engine's strict-edit sentence ` +
    `("${openingForTeaching("editClip")} …") and adds the line that protects the rest. ` +
    "mode:'extend' — they want that clip carried on (\"keep it going\", \"what happens next\"); the prompt opens " +
    `with the engine's carry-on sentence ("${openingForTeaching("extendClip")} forward, …"), so pass ` +
    "`extendDirection` 'forward' (default) or 'backward'. The sentence names their clip for you — never write " +
    "that name yourself, exactly as with image numbering. Both modes take EXACTLY ONE shot — an edit or an " +
    "extension is one change, not a sequence — and neither takes a style or quality direction: re-styling " +
    "fights the whole point of anchoring to a clip they already have. When they attached a clip but want a " +
    "NEW clip that merely follows its feel, that is not these modes — use t2v and describe the feel. " +
    "Never write the word \"reference\" in an edit or extend prompt: it makes the engine start a fresh clip " +
    "instead of touching theirs. " +
    "Our users don't know cinematography — YOU fill " +
    "it: give each shot a clear action, and add exactly ONE camera move, a shot framing, and scene lighting even " +
    "if unmentioned. One shot = one beat; use up to 4 shots for a multi-beat clip. Set continuesFromPrev:true for " +
    "a shot that follows a prior clip. List @-referenced entities in `references` to lock identity. cleanFootage " +
    "defaults true (bans on-screen text/watermark/logo) — set false only when text or a logo should appear in " +
    "the video. " +
    // #774 U3 ③ —— 情绪外化：给镜头看得见的东西，不是一个感受词。
    "Never write a feeling word alone — pass `emotion` and the prompt turns it into what the camera can " +
    `actually see (e.g. happy → ${EMOTION_CUES.happy}). Known emotions: ${Object.keys(EMOTION_CUES).join(", ")}. ` +
    // #774 U3 ③ —— 声音符号规范。
    "Sound: pass `music`, `sfx`, and `dialogue` as SEPARATE fields (the prompt writes each in the notation " +
    "the engine expects); keep spoken lines in the language the user asked for. Never ask for subtitles. " +
    // #774 U3 ② —— 约束词表（祈使式）。
    "`constraints`: write each one as a COMMAND and separate them with a semicolon, e.g.: " +
    `${VIDEO_CONSTRAINTS.join(" ")} ` +
    // #774 U4 —— 画幅接线。
    "Pass `aspect` with the SAME shape you will pass to propose's desiredAspect — a vertical clip gets an " +
    "extra caption-free instruction, because vertical output is by far the most likely to grow burned-in " +
    "captions nobody asked for. " +
    // #774 U8 —— 只提醒，不设限。
    "If the skill returns `notes`, tell the user those points in your own plain words and let them decide — " +
    "they are advice, never a limit: never refuse, cap, or silently drop references the user gave you. " +
    `Camera — use ONE per shot from: ${enOnly(CAMERA_MOVES).join(", ")}. ` +
    `Shot framing from: ${enOnly(SHOT_SCALES).join(", ")}. ` +
    `Lighting — always give direction + color temperature, e.g.: ${enOnly(LIGHTING).join(", ")}.`,
  parameters: seedancePromptInput,
  execute: async (i) => {
    const prompt = assembleSeedance(i);
    // #775 —— 禁词只**提醒**,绝不改写:提示词里每个字都是商家要的东西,机器动手改一次,
    // 商家批准的与引擎收到的就分家了。与 U8 的素材建议走同一条 `notes` 出口。
    const banned =
      i.mode === "edit" || i.mode === "extend"
        ? videoPromptWarnings(i.mode === "edit" ? "editClip" : "extendClip", prompt)
        : [];
    const notes = [...referenceAdvice(i.references), ...banned];
    return { prompt, ...(notes.length > 0 ? { notes } : {}) };
  },
});

export const seedancePrompt = seedancePromptSkill.tool;
