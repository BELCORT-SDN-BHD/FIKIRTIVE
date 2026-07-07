#!/usr/bin/env node
// OPT-4 EP1 transitions — $0 local ffmpeg render-verify.
//
// For each transition type (the 7-tile library) this script:
//   1. builds an FikirtiveEdit and parses it through the REAL @fikirtive/core contract
//      (proves the contract accepts a track-level transition),
//   2. computes renderDuration() from the SAME core helper the worker uses,
//   3. replicates the worker's EXACT filtergraph (apps/worker/src/jobs/render.ts:
//      strengthened videoChain + transitionToXfade + chained xfade + the
//      afade-crossfade/adelay/amix/atrim audio chain) against synthetic lavfi
//      color+sine sources — no fal, no network, no spend path,
//   4. renders to mp4 and asserts ffprobe(format.duration) == renderDuration
//      (= Σ clip − Σ transition) within a container-rounding tolerance.
//
// Also renders a 3-clip / 2-transition fixture to exercise the chain, and
// greps the EP1 diff to prove no spend path was introduced.
//
// $0. GENERATION_PROVIDER must be unset or "mock". Run:
//   node scripts/archive/local-ep1-transitions-verify.mjs
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const run = promisify(execFile);
const root = new URL("..", import.meta.url);

// REAL contract + render-duration math (the worker imports the same symbols).
const { fikirtiveEdit, renderDuration, TRANSITION_TYPES } = await import(
  new URL("packages/core/dist/index.js", root)
);

// ---- mirror apps/worker/src/jobs/render.ts (keep in sync) -------------------
// transitionToXfade(): Fikirtive transition type → ffmpeg xfade transition= value.
function transitionToXfade(type, direction) {
  const dir = direction ?? "left";
  switch (type) {
    case "fade":
    case "cross":
      return "fade";
    case "slide":
      return { left: "slideleft", right: "slideright", up: "slideup", down: "slidedown" }[dir];
    case "wipe":
      return { left: "wipeleft", right: "wiperight", up: "wipeup", down: "wipedown" }[dir];
    case "clockwipe":
      return "radial";
    case "iris":
      return dir === "down" || dir === "right" ? "circleclose" : "circleopen";
    case "flip":
      return "vertopen"; // best-effort approximation (no native xfade flip)
    default:
      throw new Error(`unknown transition type ${type}`);
  }
}

// videoChain(): strengthened per-clip normalization (the bytes the worker emits).
function videoChain(index, w, h, fps) {
  const scale = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`;
  const filters = [scale, "setsar=1", `fps=${fps}`, "format=yuv420p", "settb=AVTB", "setpts=PTS-STARTPTS"];
  return `[${index}:v]${filters.join(",")}[v${index}]`;
}

// renderedStartSeconds(): edit-time start → rendered-time start (overlap before).
function renderedStartSeconds(clipStart, visualStarts, transitions) {
  const byFrom = new Map();
  for (const tr of transitions) byFrom.set(tr.fromClipIndex, tr.durationMs / 1000);
  let acc = 0;
  const atStart = [{ editStart: 0, overlap: 0 }];
  for (let i = 1; i < visualStarts.length; i++) {
    acc += byFrom.get(i - 1) ?? 0;
    atStart.push({ editStart: visualStarts[i], overlap: acc });
  }
  let overlapBefore = 0;
  for (const e of atStart) if (e.editStart <= clipStart + 1e-6) overlapBefore = e.overlap;
  return Math.max(0, clipStart - overlapBefore);
}

// audioChain(): resample + volume + per-transition afade crossfade + adelay.
function audioChain(vIdx, clip, visual, transitions) {
  const filters = ["aresample=async=1:first_pts=0", `volume=${clip.asset.volume ?? 1}`];
  for (const tr of transitions) {
    const durS = tr.durationMs / 1000;
    if (tr.fromClipIndex === vIdx) filters.push(`afade=t=out:st=${Math.max(0, clip.length - durS)}:d=${durS}`);
    if (tr.toClipIndex === vIdx) filters.push(`afade=t=in:st=0:d=${durS}`);
  }
  const delayMs = Math.round(
    renderedStartSeconds(clip.start, visual.map((c) => c.start), transitions) * 1000,
  );
  if (delayMs > 0) filters.push(`adelay=${delayMs}:all=1`);
  return `[${vIdx}:a]${filters.join(",")}[a${vIdx}]`;
}

// Build the worker's filtergraph for a parsed, gapless single-visual-track edit.
function buildArgs(edit, sources, out, renderSeconds) {
  const { resolution } = edit.output;
  const wh = { sd: 480, hd: 720, "1080": 720 }[resolution] ?? 720; // 16:9 height; worker caps 1080→hd
  const [w, h] = [Math.round((wh * 16) / 9 / 2) * 2, wh];
  const fps = edit.output.fps;
  const visual = [...edit.timeline.tracks[0].clips].sort((a, b) => a.start - b.start);
  const transitions = edit.timeline.tracks[0].transitions ?? [];
  const byFrom = new Map(transitions.map((t) => [t.fromClipIndex, t]));

  const graph = [];
  for (let i = 0; i < visual.length; i++) graph.push(videoChain(i, w, h, fps));

  // chained xfade (hard cuts concat)
  let acc = "[v0]";
  let accEnd = visual[0].length;
  let stage = 0;
  for (let i = 1; i < visual.length; i++) {
    const tr = byFrom.get(i - 1);
    const next = `[vx${stage}]`;
    if (tr) {
      const durS = tr.durationMs / 1000;
      const offset = accEnd - durS;
      graph.push(`${acc}[v${i}]xfade=transition=${transitionToXfade(tr.type, tr.direction)}:duration=${durS}:offset=${offset}${next}`);
      accEnd = accEnd + visual[i].length - durS;
    } else {
      graph.push(`${acc}[v${i}]concat=n=2:v=1:a=0${next}`);
      accEnd = accEnd + visual[i].length;
    }
    acc = next;
    stage++;
  }
  const vLabel = visual.length === 1 ? "[v0]" : acc;

  // audio: every synthetic clip is sounded
  for (let i = 0; i < visual.length; i++) graph.push(audioChain(i, visual[i], visual, transitions));
  const mixIn = visual.map((_, i) => `[a${i}]`).join("");
  graph.push(`${mixIn}amix=inputs=${visual.length}:duration=longest:normalize=0,aresample=async=1:first_pts=0,atrim=0:${renderSeconds}[a]`);

  const args = ["-y"];
  for (let i = 0; i < visual.length; i++) args.push("-t", String(visual[i].length), "-i", sources[i]);
  args.push("-filter_complex", graph.join(";"), "-map", vLabel, "-map", "[a]", "-c:a", "aac", "-b:a", "192k");
  args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out);
  return args;
}

const COLORS = ["red", "green", "blue", "yellow"];
async function makeSource(dir, i, seconds, fps) {
  const out = path.join(dir, `src-${i}.mp4`);
  await run("ffmpeg", [
    "-y",
    "-f", "lavfi", "-i", `color=c=${COLORS[i % COLORS.length]}:s=640x360:r=${fps}:d=${seconds + 1}`,
    "-f", "lavfi", "-i", `sine=frequency=${330 + i * 110}:duration=${seconds + 1}`,
    "-t", String(seconds + 1),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", out,
  ]);
  return out;
}

async function probeDuration(file) {
  const { stdout } = await run("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file,
  ]);
  return Number(stdout.trim());
}

// a contract-valid placeholder src (/files/u/<owner>/<sha256>.mp4). The real
// ffmpeg input file is supplied by index in buildArgs — src only needs to satisfy
// the zod regex so the edit parses.
const FAKE_SHA = "a".repeat(64);
const fakeSrc = (i) => `/files/u/verify/${i}${FAKE_SHA.slice(1)}.mp4`;

function makeEdit(lengths, transitions) {
  let start = 0;
  const clips = lengths.map((len, i) => {
    const c = { asset: { type: "video", src: fakeSrc(i) }, start, length: len };
    start += len;
    return c;
  });
  return fikirtiveEdit.parse({
    timeline: { background: "#000000", tracks: [{ clips, transitions }] },
    output: { format: "mp4", resolution: "sd", aspectRatio: "16:9", fps: 25 },
  });
}

const TOLERANCE = 0.15; // ffmpeg container rounding

async function noSpendGrep() {
  const files = [
    "apps/worker/src/jobs/render.ts",
    "apps/web/components/Editor.tsx",
    "packages/core/src/timeline.ts",
  ];
  // grep the working tree (staged or not) for any spend-path token in EP1 files
  const { stdout } = await run("grep", ["-nE", "startGen|GenJob|fal\\.|@fal|coworkGenerate|fal-media|falApi", ...files], { cwd: new URL(".", root) }).catch(
    (e) => (e.code === 1 ? { stdout: "" } : Promise.reject(e)),
  );
  const hits = stdout.split("\n").filter(Boolean);
  if (hits.length) {
    console.error("FAIL no-spend grep — EP1 files reference a spend path:\n" + hits.join("\n"));
    return false;
  }
  console.log("PASS no-spend  EP1 files reference no fal/generation/spend path");
  return true;
}

const main = async () => {
  const provider = process.env.GENERATION_PROVIDER;
  if (provider && provider !== "mock") {
    throw new Error(`refusing to run with GENERATION_PROVIDER=${provider} (set it to mock or unset)`);
  }

  const dir = await mkdtemp(path.join(tmpdir(), "ep1-transitions-"));
  let failures = 0;
  try {
    const fps = 25;
    const CLIP = 2, DUR_MS = 500; // 2s + 2s, 0.5s transition → renderDuration 3.5s
    // four synthetic clips reused across the per-type 2-clip renders + the 3-clip chain
    const sources = [];
    for (let i = 0; i < 4; i++) sources.push(await makeSource(dir, i, CLIP, fps));

    console.log(`EP1 transitions $0 verify — types: ${TRANSITION_TYPES.join(", ")}\n`);

    // (1) one render per transition type: 2 gapless clips + 1 transition
    for (const type of TRANSITION_TYPES) {
      const edit = makeEdit([CLIP, CLIP], [{ fromClipIndex: 0, toClipIndex: 1, type, durationMs: DUR_MS }]);
      const expected = renderDuration(edit); // = 4 − 0.5 = 3.5
      const out = path.join(dir, `out-${type}.mp4`);
      await run("ffmpeg", buildArgs(edit, sources, out, expected));
      const got = await probeDuration(out);
      const ok = Number.isFinite(got) && Math.abs(got - expected) <= TOLERANCE;
      console.log(`${ok ? "PASS" : "FAIL"} ${type.padEnd(10)} renderDuration=${expected}s  ffprobe=${got.toFixed(3)}s`);
      if (!ok) failures++;
    }

    // (2) 3-clip chain: two transitions of different types/durations
    const chainEdit = makeEdit(
      [CLIP, CLIP, CLIP],
      [
        { fromClipIndex: 0, toClipIndex: 1, type: "cross", durationMs: 500 },
        { fromClipIndex: 1, toClipIndex: 2, type: "wipe", durationMs: 1000 },
      ],
    );
    const chainExpected = renderDuration(chainEdit); // 6 − 1.5 = 4.5
    const chainOut = path.join(dir, "out-chain.mp4");
    await run("ffmpeg", buildArgs(chainEdit, sources, chainOut, chainExpected));
    const chainGot = await probeDuration(chainOut);
    const chainOk = Number.isFinite(chainGot) && Math.abs(chainGot - chainExpected) <= TOLERANCE;
    console.log(`${chainOk ? "PASS" : "FAIL"} ${"3-clip chain".padEnd(10)} renderDuration=${chainExpected}s  ffprobe=${chainGot.toFixed(3)}s`);
    if (!chainOk) failures++;

    console.log("");
    if (!(await noSpendGrep())) failures++;

    if (failures) throw new Error(`${failures} check(s) failed`);
    console.log(`\nALL ${TRANSITION_TYPES.length} transition types + 3-clip chain rendered valid mp4s at renderDuration ($0, no fal).`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
