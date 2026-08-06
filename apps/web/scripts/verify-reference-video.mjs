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
 * The request body below mirrors what the REAL PAID PATH sends for a reference-video job
 * (no i2v image): the merchant's choices normalised at enqueue (apps/web/lib/batch-idempotency.ts)
 * and then assembled by BytePlusProvider.generateVideo (packages/generation/src/byteplus.ts).
 * Mirroring the whole path, not just the adapter, is the point — the adapter alone would accept an
 * absent `ratio`, but no paid job ever arrives without one (#663 P2-1). #646 T5 moved every control
 * out of the prompt text and onto strict top-level fields; this mirror moved with it (an
 * out-of-date mirror would spend real money verifying a request we no longer send).
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

import { interlock } from "../../../scripts/tools/_interlock.mjs";
interlock({ spends: "one real BytePlus (Ark) video generation" });
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

// --- Mirror of byteplus.ts generateVideo request assembly (reference-video case) ---
// content: the merchant's prompt ONLY — controls are top-level fields (#646 T5).
const content = [
  { type: "video_url", video_url: { url: videoUrl }, role: "reference_video" },
  { type: "text", text: prompt.trim() },
];
// #663 P2-1: the paid path NEVER reaches the adapter with an absent aspect ratio. A merchant
// who picks no shape has it normalised to the model default at enqueue
// (normalizeFactoryMaterial → videoDefaults("seedance-2-fast").aspectRatio = "16:9", in
// apps/web/lib/batch-idempotency.ts), and that value rides all the way into the adapter body
// as `ratio: "16:9"`. Omitting it here would spend real money verifying a request shape the
// product does not send. Kept honest by apps/web/lib/__tests__/verify-reference-video-mirror.test.ts,
// which evaluates this literal and derives the expected ratio from the same `videoDefaults`.
const body = {
  model: MODEL,
  content,
  resolution: "720p",
  duration: Number(duration),
  ratio: "16:9", // = videoDefaults("seedance-2-fast").aspectRatio, the paid path's normalised default
  generate_audio: true, // = the provider's `req.audio ?? true`
  watermark: false,
  execution_expires_after: 3600,
};

console.log("⚠️  PAID run — one BytePlus video generation. Model:", MODEL);
console.log("    reference_video:", videoUrl);
console.log("    prompt         :", prompt.trim());
console.log("    controls       :", JSON.stringify({ ...body, model: undefined, content: undefined }));
console.log("");

const submit = await fetch(`${ARK_BASE}/contents/generations/tasks`, {
  method: "POST", headers, body: JSON.stringify(body),
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
  if (["failed", "cancelled", "canceled", "expired"].includes(t.status)) {
    console.error(`\n✗ task ${t.status}: ${JSON.stringify(t).slice(0, 500)}`);
    console.error("  (if this is a real-face rejection, that's EXPECTED — retry with non-face footage.)");
    process.exit(1);
  }
  if (Date.now() - startedAt > TIMEOUT_MS) { console.error("✗ timed out"); process.exit(1); }
}
