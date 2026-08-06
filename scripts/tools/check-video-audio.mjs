// Does a real generated video carry an audio track? Downloads the most
// recent prod video generation and ffprobes it. Run via:
//   railway run --service worker -- node scripts/tools/check-video-audio.mjs
import { interlock } from "./_interlock.mjs";
interlock({ prod: "reads the prod DB and downloads a prod generation ($0, read-only)" });
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
const require = createRequire(new URL("../../apps/worker/package.json", import.meta.url));
const { prisma } = await import("../../packages/db/dist/src/index.js");
const { createStorage } = await import("../../packages/storage/dist/index.js");
const { storageKey } = await import("../../packages/core/dist/index.js");

const gen = await prisma.generation.findFirst({
  where: { source: "GENERATED", deletedAt: null, asset: { ext: { in: ["mp4", "webm", "mov"] } } },
  orderBy: { createdAt: "desc" }, include: { asset: true },
});
if (!gen) { console.log("no video generation found"); process.exit(0); }
const storage = createStorage("/tmp/unused");
const url = await storage.presignedGet(storageKey(gen.asset.ownerId, gen.asset.contentHash, gen.asset.ext), 600);
const res = await fetch(url);
const buf = Buffer.from(await res.arrayBuffer());
writeFileSync("/tmp/probe.mp4", buf);
console.log(`generation ${gen.id.slice(0, 8)} · ${gen.asset.ext} · ${buf.length} bytes`);
console.log(`prompt: ${gen.promptText.slice(0, 80)}`);
const audio = execSync(`ffprobe -v error -select_streams a -show_entries stream=codec_type,codec_name -of csv=p=0 /tmp/probe.mp4`).toString().trim();
const video = execSync(`ffprobe -v error -select_streams v -show_entries stream=codec_type,width,height -of csv=p=0 /tmp/probe.mp4`).toString().trim();
console.log(`video stream: ${video || "none"}`);
console.log(`audio stream: ${audio || "NONE — the clip is silent"}`);
await prisma.$disconnect();
process.exit(0);
