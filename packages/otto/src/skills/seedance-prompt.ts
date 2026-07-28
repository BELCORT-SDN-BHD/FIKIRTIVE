/**
 * seedancePrompt — $0 确定性视频 prompt 装配 skill（free/read/internal → 不审批）。
 * 只出创作 prompt（中文正文，英文运镜词），技术 flag 由 provider 追加。Otto 提视频前先调它、用返回的 prompt。
 * 语言依据：Blueprint v2.13 —— 生成 prompt 语言由各引擎的 prompt 权威模块按实测最优决定；本引擎实测中文更优。
 * 语言执法位置（R4）：写作端 —— 这段 description 直接从 PROMPT_LANGUAGES 读语言并明写要求；
 * schema 不再拦（拦会误杀合法输入），不匹配只随结果回一句 languageAdvice。
 * 商密：description 与装配输出对用户只称「视频引擎」，不出现供应商/模型商号（文件名等内部标识符不受限）。
 */
import { defineOttoSkill } from "../skill.js";
import { seedancePromptInput, assembleSeedance, seedanceVariants, seedanceLanguageAdvice } from "./seedance-prompt.helpers.js";
import { CAMERA_MOVES, SHOT_SCALES, LIGHTING, enOnly } from "./prompt-vocab.js";
import { LANGUAGE_LABEL, LANGUAGE_REASON, promptLanguageFor } from "../prompt-language.js";
import { decideStrategy } from "./prompt-strategy.js";
import { checkVariantSet, deriveAssetChecklist, variantCountFor } from "./variant-policy.js";

/** 语言权威（PROMPT_LANGUAGES）是这段 description 的唯一来源 —— 不在此另写语言字面。 */
const VIDEO_LANGUAGE = promptLanguageFor("seedance") ?? "zh";

export const seedancePromptSkill = defineOttoSkill({
  name: "seedancePrompt",
  cost: "free",
  effect: "read",
  reach: "internal",
  description:
    "Assemble a model-tuned VIDEO prompt for the video engine. " +
    `LANGUAGE — WRITE THE PROMPT BODY IN ${LANGUAGE_LABEL[VIDEO_LANGUAGE]} (${LANGUAGE_REASON[VIDEO_LANGUAGE]}). ` +
    `Subjects, actions, moods, edit instructions, and constraints go in ${LANGUAGE_LABEL[VIDEO_LANGUAGE]}; keep ` +
    "industry camera/framing/lighting terms in English (dolly in, close-up, golden hour) and keep quoted " +
    "dialogue in whatever language the character speaks. NOTHING REJECTS A WRONG-LANGUAGE BODY — the schema " +
    "never fails a prompt over its language, so a non-Chinese body would ship exactly as you wrote it. When " +
    "the result comes back with a `languageAdvice` note, the body is in the wrong language: rewrite it and " +
    "call this skill again BEFORE proposing. The CREATIVE prompt only; " +
    "never add resolution/duration/ratio (the system appends those). Call this FIRST before proposing a " +
    "video, then use the returned `prompt`. Primary mode i2v: describe the MOTION relative to the first " +
    "frame (what moves, how), not the static scene. Use mode:'t2v' when there is NO source frame to " +
    "animate (a from-scratch video) — otherwise the prompt would wrongly reference a first frame. Use " +
    "mode:'edit' for a targeted change to an EXISTING clip: fill editInstruction (one change per call, in " +
    "Chinese, e.g. 将T恤由白色改为黄色) and optionally preserve; shots are not needed. Our users don't know " +
    "cinematography — YOU fill it: give each shot a clear action, and add exactly ONE camera move, a shot " +
    "framing, and scene lighting even if unmentioned. One shot = one beat; use up to 4 shots for a " +
    "multi-beat clip; for precisely timed beats, prefix each shot's action with a half-width time range " +
    "('0-2s: …') that sums to the clip's duration. For beat-synced cuts, put the beat length WITH ITS TIME " +
    "UNIT in pacing (每拍约 0.5s / 120 BPM, hard cut) — the engine cannot hear music, and a bare number " +
    "like 4K or 16:9 is not a beat length. A one-continuous-take clip is exactly ONE shot: never combine " +
    "camera 'one continuous take' (or a 一镜到底 style/pacing) with several shots. Set continuesFromPrev:true for a shot " +
    "that follows a prior clip, keep style word-for-word identical across segments, and do NOT re-describe " +
    "appearances in a continuation. List @-referenced entities in `references` to lock identity. " +
    "cleanFootage defaults true (bans on-screen text/watermark/logo) — set false only when text or a logo " +
    "should appear in the video. Extra exclusions go in `constraints` as a short noun list (≤5 items). " +
    `Camera — use ONE per shot from: ${enOnly(CAMERA_MOVES).join(", ")}. ` +
    `Shot framing from: ${enOnly(SHOT_SCALES).join(", ")}. ` +
    `Lighting — always give direction + color temperature, e.g.: ${enOnly(LIGHTING).join(", ")}. ` +
    "Always pass userIntent (the user's request in their own words, any language): the skill routes a " +
    "strategy family from it and returns 2-3 prompt `variants` (each led by a different axis) plus an " +
    "`assetChecklist` — present the variants and checklist to the user before proposing; set " +
    "directionPinned:true when the user already fixed the direction (then 2 variants). Declare the " +
    "capability ids you rely on in `capabilities` (e.g. singleTake, timestampedShots, beatSync, " +
    "negativeExclusion, multiSegmentContinuation) — their constraints are machine-checked.",
  parameters: seedancePromptInput,
  execute: async (i) => {
    // 复审 P1-A 接线：策略路由 + 变体 + 素材清单在 skill 执行时真实运行，随结果返回。
    const prompt = assembleSeedance(i);
    const strategy = decideStrategy({ text: i.userIntent ?? "", referenceRoles: i.references.map((r) => r.role) });
    const family = strategy.kind === "route" ? strategy.family : strategy.candidates[0];
    const assetChecklist = deriveAssetChecklist(
      family,
      i.references.map((r) => ({ role: r.role, name: r.name, ready: true, lock: r.lock })),
    );
    // R4：语言只是提示 —— 不匹配时附一句建议，永不拒绝输入、永不改写 prompt。
    const advice = seedanceLanguageAdvice(i);
    const languageAdvice = advice ? { languageAdvice: advice } : {};
    // edit = 一次一处修改：变体属于「改哪里」的产品层选择，不做确定性派生。
    if (i.mode === "edit") return { prompt, strategy, assetChecklist, ...languageAdvice };
    const variants = seedanceVariants(i, variantCountFor({ family, directionPinned: i.directionPinned, editType: false }));
    return { prompt, strategy, variants, variantCheck: checkVariantSet("video", variants), assetChecklist, ...languageAdvice };
  },
});

export const seedancePrompt = seedancePromptSkill.tool;
