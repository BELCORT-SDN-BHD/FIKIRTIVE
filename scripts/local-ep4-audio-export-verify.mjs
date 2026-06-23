#!/usr/bin/env node
// OPT-4 EP4 audio + NLE export — $0 local ffmpeg verify.
//
// Three checks, all offline ($0, no fal, no network, no DB, no MinIO):
//   1. DUCKING RENDER — synthesize a silent color video + a music tone + a voice
//      tone (lavfi sine), then run the EXACT ducking filtergraph the worker's
//      buildAudioMix() emits (apps/worker/src/jobs/render.ts: voice amix →
//      asplit → sidechaincompress the music bed under the voice key → re-amix →
//      the load-bearing aresample,atrim=0:${renderSeconds}[a] tail). Assert the
//      mp4's ffprobe(format.duration) == renderDuration AND the music ducks.
//
//      PROVING DUCKING (the hard part): astats RMS on the FULL mix can't show
//      ducking directly — during the voice window the loud dry voice tone
//      dominates total energy, so the mixed level RISES even as the bed is
//      attenuated. So we isolate the MUSIC BED contribution:
//        (a) BED-ISOLATION (primary proof): render the same sidechaincompress
//            applied to the music bed WITHOUT mixing the dry voice back in, and
//            assert the bed's RMS during the voice window is well below its RMS
//            during the voice-free window — i.e. the compressor pulls the music
//            down exactly while the voice is present. (~6dB dip in practice.)
//        (b) DUCKED-vs-FLAT (corroboration): the full ducking mix has a LOWER
//            voice-window RMS than a FLAT amix of the same inputs — proving the
//            sidechaincompress engaged (a flat sum would not attenuate the bed).
//   2. XML ROUND-TRIP — editToFcpXml() (the REAL @fikirtive/core dist) on a music
//      fixture: assert the string is well-formed XML, carries the right rate +
//      frame size, has frame-accurate <in>/<out>/<start>/<end>, one clipitem per
//      visual+audio clip, and the lossy-export comment lists dropped ducking.
//   3. NO-SPEND GREP — grep every EP4-touched file for any fal/generation/spend
//      token; any hit fails the run.
//
// $0. GENERATION_PROVIDER must be unset or "mock" (no generation call is made
// either way — this script only shells ffmpeg/ffprobe against local lavfi
// sources). Build core first so the dist import resolves:
//   pnpm --filter @fikirtive/core build && node scripts/local-ep4-audio-export-verify.mjs
//
// NOTE (deviation from plan skeleton): the plan's skeleton imports `execa`, but
// execa is not hoisted to the repo root (it's a transitive worker dep). EP1's
// working verify uses node:child_process execFile directly — this script matches
// that proven, dependency-free pattern.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const run = promisify(execFile);
const root = new URL("..", import.meta.url);

// REAL contract + render-duration math + XML serializer (the worker imports the
// same @fikirtive/core symbols).
const { fikirtiveEdit, renderDuration, editToFcpXml } = await import(
  new URL("packages/core/dist/index.js", root)
);

const fail = (m) => {
  console.error("FAIL " + m);
  process.exit(1);
};

// ffprobe(format.duration) in seconds.
async function probeDuration(file) {
  const { stdout } = await run("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file,
  ]);
  return Number(stdout.trim());
}

// astats RMS level (dB) over a [ss, ss+t] window of an mp4's audio.
// -inf (pure silence) is clamped to -120 so comparisons stay finite.
async function windowRmsDb(file, ss, t) {
  const { stderr } = await run(
    "ffmpeg",
    ["-ss", String(ss), "-t", String(t), "-i", file, "-af", "astats=metadata=1:reset=1", "-f", "null", "-"],
    { reject: false },
  ).catch((e) => ({ stderr: e.stderr ?? "" }));
  const m = /RMS level dB:\s*(-?[\d.]+|-inf)/.exec(stderr);
  if (!m) return NaN;
  return m[1] === "-inf" ? -120 : Number(m[1]);
}

// ---- mirror apps/worker/src/jobs/render.ts buildAudioMix() (keep in sync) ----
// Faithful replica of the worker's THREE-group partition (EP4 P2). `sounded` is a
// list of { idx, trackKind, audioRole } stand-ins for PlannedInput. The per-source
// head ([idx:a] → aresample/volume → [a${idx}]) is fed in separately by the caller
// so this builds the mix graph from the [a${idx}] labels exactly as the worker does.
//   voice   = native visual-clip audio OR an audio track with audioRole "voice"
//   bed     = an audio track with audioRole "music" (the ducked layer)
//   neutral = an audio track with NO audioRole (rides flat — never ducks)
// Duck ONLY when bed.length>0 AND voice.length>0; else a flat amix of ALL sounded.
function buildAudioMix(sounded, renderSeconds) {
  const lab = (p) => `[a${p.idx}]`;
  const tail = `aresample=async=1:first_pts=0,atrim=0:${renderSeconds}[a]`;
  const isMusic = (p) => p.trackKind === "audio" && p.audioRole === "music";
  const isVoice = (p) =>
    p.trackKind === "visual" || (p.trackKind === "audio" && p.audioRole === "voice");
  const bed = sounded.filter(isMusic);
  const voice = sounded.filter(isVoice);
  const neutral = sounded.filter((p) => !isMusic(p) && !isVoice(p));
  const duckable = bed.length > 0 && voice.length > 0;

  if (!duckable) {
    const mixIn = sounded.map(lab).join("");
    return [`${mixIn}amix=inputs=${sounded.length}:duration=longest:normalize=0,${tail}`];
  }

  const lines = [];
  lines.push(`${voice.map(lab).join("")}amix=inputs=${voice.length}:duration=longest:normalize=0[vmix]`);
  lines.push(`${bed.map(lab).join("")}amix=inputs=${bed.length}:duration=longest:normalize=0[bmix]`);
  lines.push(`[vmix]asplit=2[vkey][vout]`);
  lines.push(`[bmix][vkey]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=300[duck]`);
  lines.push(`[vout][duck]${neutral.map(lab).join("")}amix=inputs=${2 + neutral.length}:duration=longest:normalize=0,${tail}`);
  return lines;
}

// The rendered fixture has inputs 0=video(silent), 1=music bed, 2=voice. We feed
// the buildAudioMix replica the same partition (bed=music idx1, voice idx2) and
// prepend each source's audioChain head so the graph runs against the lavfi tones.
function srcHeads(idxs) {
  return idxs.map((i) => `[${i}:a]aresample=async=1:first_pts=0,volume=1[a${i}]`);
}
function duckingGraph(renderSeconds) {
  const sounded = [
    { idx: 1, trackKind: "audio", audioRole: "music" }, // bed
    { idx: 2, trackKind: "audio", audioRole: "voice" }, // voice trigger
  ];
  return [...srcHeads([1, 2]), ...buildAudioMix(sounded, renderSeconds)].join(";");
}

// The FLAT amix the worker emits when NOT duckable (EP1 behavior) — the control.
// Same two sources but BOTH neutral (no roles) so buildAudioMix takes the flat
// path: proves the sidechaincompress in the ducking path changed the output.
function flatGraph(renderSeconds) {
  const sounded = [
    { idx: 1, trackKind: "audio", audioRole: undefined },
    { idx: 2, trackKind: "audio", audioRole: undefined },
  ];
  return [...srcHeads([1, 2]), ...buildAudioMix(sounded, renderSeconds)].join(";");
}

// The isolated MUSIC BED after the SAME sidechaincompress (no dry voice mixed
// back in). This exposes the bed's level on its own so a window RMS comparison
// reads the music's ducking directly (the full mix is masked by the dry voice).
function bedOnlyGraph(renderSeconds) {
  const tail = `aresample=async=1:first_pts=0,atrim=0:${renderSeconds}[a]`;
  return [
    "[1:a]aresample=async=1:first_pts=0,volume=1[a1]", // music bed
    "[2:a]aresample=async=1:first_pts=0,volume=1[a2]", // voice key
    "[a1]amix=inputs=1:duration=longest:normalize=0[bmix]",
    "[a2]amix=inputs=1:duration=longest:normalize=0[vmix]",
    `[bmix][vmix]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=300,${tail}`,
  ].join(";");
}

// (FIX 1) Static partition proof — assert the THREE-group logic directly on the
// buildAudioMix replica. The load-bearing case: a music bed + an UN-roled
// (neutral) track must NOT duck — only a music bed + a real voice source does.
function checkPartition() {
  const RS = 6;
  const hasSidechain = (lines) => lines.some((l) => l.includes("sidechaincompress"));
  const isFlat = (lines) => lines.length === 1 && /^\[.*\]amix=/.test(lines[0]);

  // music bed + voice-role track → ducks
  const mv = buildAudioMix(
    [{ idx: 1, trackKind: "audio", audioRole: "music" }, { idx: 2, trackKind: "audio", audioRole: "voice" }],
    RS,
  );
  if (!hasSidechain(mv)) fail("partition: music+voice should duck (no sidechaincompress emitted)");

  // music bed + native visual audio → ducks
  const mvis = buildAudioMix(
    [{ idx: 0, trackKind: "visual" }, { idx: 1, trackKind: "audio", audioRole: "music" }],
    RS,
  );
  if (!hasSidechain(mvis)) fail("partition: music+visual-native-audio should duck");

  // music bed + NEUTRAL (un-roled) track ONLY → must NOT duck (the EP4 P2 fix)
  const mn = buildAudioMix(
    [{ idx: 1, trackKind: "audio", audioRole: "music" }, { idx: 2, trackKind: "audio", audioRole: undefined }],
    RS,
  );
  if (hasSidechain(mn)) fail("partition: music+neutral(un-roled) must NOT duck — neutral is not a voice trigger");
  if (!isFlat(mn)) fail("partition: music+neutral should be a single flat amix");

  // music bed + voice + neutral → ducks AND the neutral rides flat in the final amix
  const mvn = buildAudioMix(
    [
      { idx: 1, trackKind: "audio", audioRole: "music" },
      { idx: 2, trackKind: "audio", audioRole: "voice" },
      { idx: 3, trackKind: "audio", audioRole: undefined },
    ],
    RS,
  );
  if (!hasSidechain(mvn)) fail("partition: music+voice+neutral should duck");
  const finalLine = mvn[mvn.length - 1];
  if (!/\[vout\]\[duck\]\[a3\]amix=inputs=3:/.test(finalLine)) {
    fail(`partition: neutral track [a3] must ride flat in the final amix=inputs=3 — got: ${finalLine}`);
  }

  // neutral-only (no music, no voice) → flat (legacy/EP1 behavior preserved)
  const nn = buildAudioMix([{ idx: 1, trackKind: "audio", audioRole: undefined }], RS);
  if (!isFlat(nn)) fail("partition: neutral-only should be a flat amix");

  // every path keeps the load-bearing tail
  for (const [name, lines] of [["music+voice", mv], ["music+neutral", mn], ["music+voice+neutral", mvn]]) {
    if (!lines[lines.length - 1].includes(`atrim=0:${RS}[a]`)) {
      fail(`partition: ${name} dropped the load-bearing aresample,atrim tail`);
    }
  }

  console.log(
    "PASS partition — 3-group: music+voice ducks, music+visual ducks, music+NEUTRAL does NOT duck " +
      "(flat), music+voice+neutral ducks with neutral riding flat (amix=inputs=3); tail preserved.",
  );
}

async function renderMix(vid, music, voice, graph, out) {
  await run("ffmpeg", [
    "-y",
    "-i", vid, "-i", music, "-i", voice,
    "-filter_complex", graph,
    "-map", "0:v", "-map", "[a]",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart", out,
  ]);
}

async function checkDucking(work) {
  const renderSeconds = 6;
  const vid = path.join(work, "vid.mp4");
  const music = path.join(work, "music.wav");
  const voice = path.join(work, "voice.wav");

  // 6s silent color video; 6s steady music tone; a 2s voice tone sitting at
  // t=2..4 (silence-padded to 6s) so we have a voice window and a voice-free one.
  await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=blue:s=320x240:d=6:r=25", "-pix_fmt", "yuv420p", vid]);
  await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=220:duration=6", music]);
  await run("ffmpeg", [
    "-y", "-f", "lavfi", "-i", "sine=frequency=880:duration=2",
    "-af", "adelay=2000:all=1,apad=whole_dur=6", voice,
  ]);

  // render the ducking graph (what the worker emits for music+voice)
  const duckOut = path.join(work, "ducked.mp4");
  await renderMix(vid, music, voice, duckingGraph(renderSeconds), duckOut);

  // render the flat graph (control — same inputs, no sidechaincompress)
  const flatOut = path.join(work, "flat.mp4");
  await renderMix(vid, music, voice, flatGraph(renderSeconds), flatOut);

  // render the isolated ducked bed (music under the voice key, no dry voice)
  const bedOut = path.join(work, "bedonly.mp4");
  await renderMix(vid, music, voice, bedOnlyGraph(renderSeconds), bedOut);

  // (a) valid mp4 at renderDuration
  const dur = await probeDuration(duckOut);
  if (!Number.isFinite(dur) || Math.abs(dur - renderSeconds) > 0.5) {
    fail(`ducked output duration ${dur}s != ~${renderSeconds}s`);
  }

  // (b) PRIMARY ducking proof — bed isolation: the music bed (sidechained, no dry
  // voice) is markedly quieter during the voice window than the voice-free window.
  // This reads the music's ducking directly (the full mix is masked by the voice).
  const bedVoiceWin = await windowRmsDb(bedOut, 2, 1.5); // bed pulled down (voice present)
  const bedFreeWin = await windowRmsDb(bedOut, 4.5, 1.0); // bed at full level (voice gone)
  const bedDip = bedFreeWin - bedVoiceWin;
  if (!(bedDip > 2.0)) {
    fail(
      `ducking not detected on the music bed: voice-window RMS ${bedVoiceWin}dB ` +
        `only ${bedDip.toFixed(1)}dB below free-window RMS ${bedFreeWin}dB (expected >2dB dip)`,
    );
  }

  // (c) CORROBORATION — sidechaincompress engaged: the full ducking mix has a
  // LOWER voice-window RMS than a flat amix of the SAME inputs (a flat sum would
  // not attenuate the bed under the voice).
  const duckVoiceWin = await windowRmsDb(duckOut, 2, 1.5);
  const flatVoiceWin = await windowRmsDb(flatOut, 2, 1.5);
  if (!(duckVoiceWin < flatVoiceWin - 0.5)) {
    fail(
      `sidechaincompress did not engage: ducked voice-window RMS ${duckVoiceWin}dB ` +
        `not below flat-mix voice-window RMS ${flatVoiceWin}dB`,
    );
  }

  console.log(
    `PASS ducking — mp4 valid @ ${dur.toFixed(2)}s (renderDuration ${renderSeconds}s); ` +
      `music bed dips ${bedDip.toFixed(1)}dB under voice (${bedVoiceWin.toFixed(1)}dB vs ` +
      `${bedFreeWin.toFixed(1)}dB free); full mix ${duckVoiceWin.toFixed(1)}dB < flat ` +
      `${flatVoiceWin.toFixed(1)}dB (compressor engaged).`,
  );
}

function checkXmlRoundTrip() {
  const HASH = "a".repeat(64);
  const fixture = fikirtiveEdit.parse({
    timeline: {
      background: "#000000",
      tracks: [
        { clips: [{ asset: { type: "video", src: `/files/u/founder/${HASH}.mp4`, trim: 1.5 }, start: 0, length: 4 }] },
        { clips: [{ asset: { type: "audio", src: `/files/u/founder/${HASH}.mp3` }, start: 0, length: 4 }], audioRole: "music" },
      ],
    },
    output: { format: "mp4", resolution: "hd", aspectRatio: "16:9", fps: 25 },
  });
  const xml = editToFcpXml(fixture);

  // well-formed root + rate + frame size (25fps, 1280x720 = 16:9 hd)
  if (!xml.startsWith("<?xml version=")) fail("xml missing prolog");
  if (!xml.includes('<xmeml version="5">')) fail("xml missing xmeml v5 root");
  if (!/<timebase>25<\/timebase>/.test(xml)) fail("xml missing 25fps timebase");
  if (!/<width>1280<\/width>/.test(xml) || !/<height>720<\/height>/.test(xml)) {
    fail("xml missing 1280x720 frame size");
  }
  // frame-accurate in/out/start/end (editToFcpXml rounds seconds×fps): trim
  // 1.5s → round(1.5*25)=38 in; length 4s → 100 frames → out 138; start 0, end 100.
  if (!xml.includes("<in>38</in>")) fail("xml missing frame-accurate in (round(1.5s*25)=38)");
  if (!xml.includes("<out>138</out>")) fail("xml missing frame-accurate out (38+100=138)");
  if (!xml.includes("<start>0</start>")) fail("xml missing start frame");
  if (!xml.includes("<end>100</end>")) fail("xml missing end frame");
  // one clipitem per visual+audio clip
  const clipItems = (xml.match(/<clipitem/g) ?? []).length;
  if (clipItems !== 2) fail(`expected 2 clipitems (1 video + 1 audio), got ${clipItems}`);
  // lossy comment must note dropped ducking
  if (!/lossy[\s\S]*ducking/i.test(xml)) fail("xml comment must note dropped ducking");
  // basic well-formed-XML round-trip: balanced xmeml tag + no raw & in pathurl
  if (!/<\/xmeml>\s*$/.test(xml)) fail("xml not closed with </xmeml>");
  if (/<pathurl>[^<]*&(?!amp;|lt;|gt;|quot;|apos;)/.test(xml)) fail("xml has an unescaped & in a pathurl");

  console.log(
    `PASS editToFcpXml — well-formed xmeml v5, 1280x720@25, frame-accurate in/out/start/end, ` +
      `${clipItems} clipitems, lossy-comment notes ducking (renderDuration=${renderDuration(fixture)}s).`,
  );
}

async function checkNoSpend() {
  const files = [
    "packages/core/src/timeline.ts",
    "packages/core/src/nle-export.ts",
    "apps/worker/src/jobs/render.ts",
    "apps/web/lib/actions.ts",
    "apps/web/components/Editor.tsx",
  ];
  const { stdout } = await run(
    "grep",
    ["-nE", "startGen|GenJob|createGenJob|fal\\.|@fal|coworkGenerate|fal-media|falApi", ...files],
    { cwd: new URL(".", root), reject: false },
  ).catch((e) => (e.code === 1 ? { stdout: "" } : Promise.reject(e)));
  if (stdout.trim()) fail("no-spend grep — EP4 files reference a spend path:\n" + stdout);
  console.log("PASS no-spend — EP4 files reference no fal/generation/spend path.");
}

const main = async () => {
  const provider = process.env.GENERATION_PROVIDER;
  if (provider && provider !== "mock") {
    throw new Error(`refusing to run with GENERATION_PROVIDER=${provider} (set it to mock or unset)`);
  }

  const work = await mkdtemp(path.join(tmpdir(), "ep4-verify-"));
  try {
    checkPartition();
    await checkDucking(work);
    checkXmlRoundTrip();
    await checkNoSpend();
    console.log("\nALL EP4 checks passed ($0, no fal): 3-group partition + ducking render + XML round-trip + no-spend.");
  } finally {
    await rm(work, { recursive: true, force: true });
  }
};

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
