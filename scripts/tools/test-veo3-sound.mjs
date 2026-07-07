// Verify a sound model returns a clip WITH a real audio track (real fal spend ~$0.90).
// Exercises our ACTUAL provider code path (VIDEO_CFG lookup, generate_audio,
// output parse + download), then ffprobes the bytes for an audio stream.
// Defaults to veo3.1-fast; pass another model key as argv[2] to spot-check it.
// Run via: railway run --service worker -- node scripts/tools/test-veo3-sound.mjs [model]
import { interlock } from "./_interlock.mjs";
interlock({ spends: "~$0.90 — one real fal text-to-video generation (audio on)" });
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const key = process.env.FAL_KEY;
if (!key) { console.error("FAL_KEY not set"); process.exit(1); }
const { FalProvider } = await import("../../packages/generation/dist/index.js");

const model = process.argv[2] || "veo3.1-fast";
const provider = new FalProvider(key);
console.log(`Generating one ${model} text-to-video clip (audio on)…`);
const t0 = Date.now();
const { bytes, ext } = await provider.generateVideo({
  prompt: "a calm ocean wave rolling onto a sandy beach at golden sunset, gentle ambient surf sound",
  imageUrl: "",          // t2v (cheapest verification; i2v shares the same param shape)
  durationSeconds: 5,    // → each model snaps to its own nearest duration
  model,
});
const path = `/tmp/veo3-test.${ext}`;
writeFileSync(path, bytes);
console.log(`✓ clip: ${bytes.byteLength} bytes → ${path} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);

const probe = execFileSync("ffprobe",
  ["-v", "error", "-show_entries", "stream=codec_type,codec_name,duration", "-of", "default=nw=1", path],
  { encoding: "utf8" });
console.log("ffprobe streams:\n" + probe);
const hasAudio = /codec_type=audio/.test(probe);
console.log(hasAudio ? "\n✓ AUDIO TRACK PRESENT — Veo 3 Fast sound works end-to-end" : "\n✗ NO AUDIO TRACK — investigate");
process.exit(hasAudio ? 0 : 2);
