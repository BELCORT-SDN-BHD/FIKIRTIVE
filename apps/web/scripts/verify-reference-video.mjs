#!/usr/bin/env node
/**
 * verify-reference-video.mjs — founder-gated PAID verification for whole-clip reference video (PR #97).
 *
 * Purpose (the "money gate" step of docs/superpowers/plans/2026-07-02-otto-reference-video.md, Task 8):
 *   1. Confirm the exact Ark param shape we ship — `{type:"video_url", video_url:{url}, role:"reference_video"}`
 *      on dreamina-seedance-2-0-fast-260128 — is ACCEPTED (not "invalid role"/"video input not supported").
 *   2. Measure the REAL COGS of a reference-video gen so we can check margin vs our fixed reference-video price = 16cr ($1.60).
 *
 * ⚠️ THIS SPENDS REAL MONEY on BytePlus (one video generation). Run ONLY with the founder's explicit go-ahead.
 *
 * The content array below is a byte-for-byte mirror of BytePlusProvider.generateVideo
 * (packages/generation/src/byteplus.ts) for the reference-video (no i2v image) case, so this verifies
 * the exact request we ship — not a hand-rolled approximation.
 *
 * Usage:
 *   BYTEPLUS_API_KEY=... node apps/web/scripts/verify-reference-video.mjs --video <PUBLIC_MP4_URL> [--prompt "..."] [--duration 5]
 *
 * --video : a PUBLIC, BytePlus-reachable mp4/mov URL, 2–6s, NON-real-human-face (product/scene/motion),
 *           720p-ish. Seedance 2.0 rejects real human faces as subject — use non-face footage for this test.
 *
 * COGS: BytePlus bills per generation; the API response may not itself carry the charge. Note your BytePlus
 * console credit balance BEFORE and AFTER this run to get the real per-gen COGS, and compare to $1.60 (16cr).
 */

const ARK_BASE = "https://ark.ap-southeast.bytepluses.com/api/v3";
const MODEL = "dreamina-seedance-2-0-fast-260128"; // = VIDEO_MODEL_MAP["seedance-2-fast"]

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const apiKey = process.env.BYTEPLUS_API_KEY;
const videoUrl = arg("video", "");
const prompt = arg("prompt", "Recreate this reference video's camera motion and pacing with a sleek product on a clean studio backdrop.");
const duration = arg("duration", "5");

if (!apiKey) { console.error("✗ BYTEPLUS_API_KEY env is required."); process.exit(2); }
if (!videoUrl) { console.error("✗ --video <PUBLIC_MP4_URL> is required (2–6s, non-real-face)."); process.exit(2); }
if (Number(duration) !== 5) { console.error("✗ reference-video verification is fixed to --duration 5 to match the 16cr costing model."); process.exit(2); }

const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

// --- Mirror of byteplus.ts generateVideo content assembly (reference-video case) ---
const flags = [`--resolution 720p`, `--duration ${duration}`].join(" ");
const content = [
  { type: "video_url", video_url: { url: videoUrl }, role: "reference_video" },
  { type: "text", text: `${prompt} ${flags}`.trim() },
];

console.log("⚠️  PAID run — one BytePlus video generation. Model:", MODEL);
console.log("    reference_video:", videoUrl);
console.log("    prompt+flags   :", `${prompt} ${flags}`);
console.log("");

const submit = await fetch(`${ARK_BASE}/contents/generations/tasks`, {
  method: "POST", headers, body: JSON.stringify({ model: MODEL, content }),
});
const submitText = await submit.text();
if (!submit.ok) {
  console.error(`✗ PARAM REJECTED — submit ${submit.status}: ${submitText.slice(0, 500)}`);
  console.error("  → the reference_video param shape or tier is NOT accepted as-shipped. Do NOT merge/deploy the provider call until resolved.");
  process.exit(1);
}
const taskId = JSON.parse(submitText).id;
if (!taskId) { console.error("✗ submit returned no task id:", submitText.slice(0, 300)); process.exit(1); }
console.log(`✓ submit accepted — task ${taskId} created (⇒ billed on success). Polling…`);

const startedAt = Date.now();
const TIMEOUT_MS = 5 * 60_000;
while (true) {
  await new Promise((r) => setTimeout(r, 5_000));
  const st = await fetch(`${ARK_BASE}/contents/generations/tasks/${taskId}`, { headers });
  if (!st.ok) {
    if (Date.now() - startedAt > TIMEOUT_MS) { console.error(`✗ poll ${st.status} after timeout`); process.exit(1); }
    continue;
  }
  const t = await st.json();
  if (t.status === "succeeded") {
    const url = t.content?.video_url;
    const secs = ((Date.now() - startedAt) / 1000).toFixed(0);
    console.log(`\n✅ PARAM ACCEPTED — reference_video works on ${MODEL}.`);
    console.log(`   video_url: ${url}`);
    console.log(`   elapsed  : ~${secs}s`);
    if (t.usage) console.log(`   usage    : ${JSON.stringify(t.usage)}`);
    console.log(`\n   → Now check your BytePlus console credit delta (before vs after) for the real COGS.`);
    console.log(`     If COGS threatens the 45% margin floor at $1.60 (16cr), lower REF_VIDEO_MAX_SECONDS before shipping broader use.`);
    process.exit(0);
  }
  if (["failed", "cancelled", "canceled"].includes(t.status)) {
    console.error(`\n✗ task ${t.status}: ${JSON.stringify(t).slice(0, 500)}`);
    console.error("  (if this is a real-face rejection, that's EXPECTED — retry with non-face footage.)");
    process.exit(1);
  }
  if (Date.now() - startedAt > TIMEOUT_MS) { console.error("✗ timed out"); process.exit(1); }
}
