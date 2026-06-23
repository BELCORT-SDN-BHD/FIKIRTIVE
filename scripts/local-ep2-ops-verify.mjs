#!/usr/bin/env node
// EP2 ops: $0 contract-level fuzz. Builds random gapless visual edits with random
// transitions, applies split/ripple/move/snap, and asserts every result re-parses
// clean AND each surviving transition still references a gapless-adjacent pair.
// No ffmpeg, no fal, no spend. Run: node scripts/local-ep2-ops-verify.mjs
import { fileURLToPath } from "node:url";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// import from the BUILT core (run `pnpm --filter @fikirtive/core build` first)
const core = await import(path.join(root, "packages/core/dist/index.js"));
const { fikirtiveEdit, splitClipAt, rippleDeleteClip, moveClip, snapEdit, reconcileTransitions, MIN_CLIP_SECONDS } = core;

const HASH = "a".repeat(64);
const SRC = `/files/u/founder/${HASH}.mp4`;
const rand = (n) => Math.floor(Math.random() * n);

function randomEdit() {
  const n = 2 + rand(4); // 2..5 clips
  let start = 0;
  const clips = [];
  for (let i = 0; i < n; i++) {
    const length = 1 + rand(4); // 1..4s (≥ 2× a 0.5s transition)
    clips.push({ asset: { type: "video", src: SRC, trim: rand(3) }, start, length });
    start += length;
  }
  // optionally add a transition on a random boundary, duration ≤ half shorter clip
  const transitions = [];
  if (n >= 2 && Math.random() < 0.7) {
    const b = rand(n - 1);
    const half = Math.min(clips[b].length, clips[b + 1].length) / 2;
    const durationMs = Math.max(100, Math.min(2000, Math.floor(half * 1000)));
    transitions.push({ fromClipIndex: b, toClipIndex: b + 1, type: "cross", durationMs });
  }
  return fikirtiveEdit.parse({
    timeline: {
      tracks: [
        { clips, transitions },
        { clips: [{ asset: { type: "audio", src: `/files/u/founder/${HASH}.mp3` }, start: 0, length: start }] },
      ],
    },
    output: { format: "mp4" },
  });
}

function assertConsistent(edit, label) {
  // re-parse must not throw (covers gapless-pair + adjacency + duplicate-boundary
  // + ≤half + overlap + min-clip guards)
  fikirtiveEdit.parse(edit);
  const t0 = edit.timeline.tracks[0];
  const ordered = [...t0.clips].sort((a, b) => a.start - b.start);
  for (const tr of t0.transitions ?? []) {
    if (tr.toClipIndex !== tr.fromClipIndex + 1) throw new Error(`${label}: non-adjacent transition ${JSON.stringify(tr)}`);
    const from = ordered[tr.fromClipIndex], to = ordered[tr.toClipIndex];
    if (!from || !to) throw new Error(`${label}: dangling transition ${JSON.stringify(tr)}`);
    if (Math.abs(to.start - (from.start + from.length)) > 1e-6) throw new Error(`${label}: gap under transition`);
  }
}

const ITER = 400;
let ok = 0;
for (let i = 0; i < ITER; i++) {
  const e = randomEdit();
  const t0 = e.timeline.tracks[0];
  const n = t0.clips.length;
  // split a random clip at its midpoint — INCLUDING clips a transition touches.
  // With drop-if-invalid (Fix 4), a split strictly inside a clip whose halves are
  // each ≥ MIN never throws on account of a transition: it DROPS the now-invalid
  // transition and returns a parse-valid edit. Any throw on this path is a genuine
  // failure. (We still skip clips too short to halve — that's the MIN-clip guard.)
  try {
    const ordered = [...t0.clips].sort((a, b) => a.start - b.start);
    const touchedSet = new Set();
    for (const tr of t0.transitions ?? []) { touchedSet.add(tr.fromClipIndex); touchedSet.add(tr.toClipIndex); }
    const splittable = ordered.map((_, i) => i).filter((i) => ordered[i].length >= 2 * MIN_CLIP_SECONDS);
    if (splittable.length) {
      const ci = splittable[rand(splittable.length)];
      const c = ordered[ci];
      const s = splitClipAt(e, 0, ci, c.start + c.length / 2); // must not throw, even if transitioned
      assertConsistent(s, "split");
      // if the split touched a transition, the result must have re-tiled the rest
      // and either kept the transition long-enough or dropped it — never left a
      // transition pointing at a too-short / gapped pair (assertConsistent covers it).
      if (touchedSet.has(ci)) {
        const survivors = (s.timeline.tracks[0].transitions ?? []).length;
        const before = (t0.transitions ?? []).length;
        if (survivors > before) throw new Error(`split added transitions (${before}→${survivors})`);
      }
    }
  } catch (err) { console.error("SPLIT FAIL", err.message); process.exit(1); }
  // ripple-delete a random clip (skip if only 1)
  try {
    if (n > 1) assertConsistent(rippleDeleteClip(e, 0, rand(n)), "ripple");
  } catch (err) { console.error("RIPPLE FAIL", err.message); process.exit(1); }
  // move a random clip to a random slot
  try {
    assertConsistent(moveClip(e, 0, rand(n), rand(n)), "move");
  } catch (err) { console.error("MOVE FAIL", err.message); process.exit(1); }
  // snap a slightly-perturbed copy. Drop the track-0 transitions first: a sub-
  // threshold gap under a transition makes the PERTURBED edit itself un-parseable
  // (the gapless-pair guard fires before snap runs), which is the contract working
  // — not a snap bug. snap's job is closing the gap on the visual track, so we
  // exercise it on a transition-free copy and assert it re-tiles to gapless.
  try {
    const perturbed = structuredClone(e);
    delete perturbed.timeline.tracks[0].transitions;
    perturbed.timeline.tracks[0].clips.forEach((c, idx) => { if (idx > 0) c.start += 0.05; });
    const snapped = snapEdit(fikirtiveEdit.parse(perturbed));
    assertConsistent(snapped, "snap");
    // a near-tiled track must come back exactly tiled-from-0 (every gap closed)
    let cur = 0;
    for (const c of [...snapped.timeline.tracks[0].clips].sort((a, b) => a.start - b.start)) {
      if (Math.abs(c.start - cur) > 1e-6) throw new Error(`snap left a gap: clip starts at ${c.start}s, expected ${cur}s`);
      cur += c.length;
    }
  } catch (err) { console.error("SNAP FAIL", err.message); process.exit(1); }
  // reconcile: simulate a NATIVE Shotstack reorder/trim (shuffle + re-tile + jitter)
  // then reconcile the index-based transitions against the new clip list by identity.
  // The result (merged back) must re-parse valid with consistent transitions — any
  // surviving transition references a gapless-adjacent, long-enough pair; the rest
  // are cleanly dropped. This is exactly the edit:changed path in Editor.tsx.
  try {
    const prevClips = [...t0.clips].sort((a, b) => a.start - b.start);
    const shuffled = [...prevClips];
    for (let i = shuffled.length - 1; i > 0; i--) { const j = rand(i + 1); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
    let cursor = 0;
    const nextClips = shuffled.map((c) => {
      const length = Math.max(MIN_CLIP_SECONDS, c.length + (Math.random() - 0.5)); // trim jitter
      const placed = { ...c, start: cursor, length };
      cursor += length;
      return placed;
    });
    const reconciled = reconcileTransitions(prevClips, nextClips, t0.transitions ?? []);
    const merged = fikirtiveEdit.parse({
      ...e,
      timeline: {
        ...e.timeline,
        tracks: [
          { clips: nextClips, ...(reconciled.length ? { transitions: reconciled } : {}) },
          { clips: [{ asset: { type: "audio", src: `/files/u/founder/${HASH}.mp3` }, start: 0, length: cursor }] },
        ],
      },
    });
    assertConsistent(merged, "reconcile");
  } catch (err) { console.error("RECONCILE FAIL", err.message); process.exit(1); }
  ok++;
}
console.log(`PASS ${ok}/${ITER} random edits — split/ripple/move/snap/reconcile all re-parse valid with consistent transitions.`);

// no-spend grep on EP2-touched files
const files = ["packages/core/src/timeline-ops.ts", "apps/web/components/Editor.tsx", "packages/core/src/index.ts"];
const { stdout } = await run("grep", ["-nE", "startGen|GenJob|fal\\.|@fal|coworkGenerate|fal-media|falApi", ...files], { cwd: root })
  .catch((e) => (e.code === 1 ? { stdout: "" } : Promise.reject(e)));
if (stdout.trim()) { console.error("FAIL no-spend grep — EP2 files reference a spend path:\n" + stdout); process.exit(1); }
console.log("PASS no-spend  EP2 files reference no fal/generation/spend path.");
