import { artlioEdit, type ArtlioEdit, type ArtlioClip, type BetweenClipTransition } from "./timeline.js";

/** A split/trim can never produce a clip shorter than this (avoids zero/negative
 *  length and clips too short for a fade). Below the smallest sane edit unit. */
export const MIN_CLIP_SECONDS = 0.1;

/** Transition indices live in TIMELINE order (clips sorted by start) — the same
 *  space `timeline.superRefine` validates. These helpers keep that array correct
 *  after an op changes the clip count/order. A transition is ALWAYS the adjacent
 *  pair (fromClipIndex, fromClipIndex+1); we rebuild from `fromClipIndex` only. */

/** Splitting clip `splitIndex` inserts a new clip at `splitIndex+1`, so every
 *  clip at index ≥ `splitIndex` shifts +1. A split is INTERIOR to one clip, so
 *  the only NEW boundary (the 1a|1b internal cut) never carries a user
 *  transition — nothing is dropped. A transition on the split clip's TAIL
 *  (fromClipIndex === splitIndex) moves to the second half's tail
 *  (splitIndex+1 → splitIndex+2): the same gapless pair, re-numbered. A
 *  transition into the split clip's HEAD (toClipIndex === splitIndex) is
 *  untouched (still ends at the first half's head).
 *
 *  NOTE: this DIVERGES from the plan's verbatim helper, which dropped any
 *  transition with `fromClipIndex === splitIndex`. That drop is wrong: it
 *  silently deletes a cross-fade between two unrelated, still-gapless clips just
 *  because the upstream clip got cut. The plan's own intent comment
 *  ("1->2 … now clip 2's tail … becomes 2->3") and 4 of its 6 split tests
 *  describe THIS shift behavior; only its two "DROPS the boundary" tests +
 *  matching code encoded the opposite — an internal contradiction. We keep the
 *  correct (shift, never drop) semantics. See report for the full rationale. */
export function reindexTransitionsAfterSplit(
  transitions: BetweenClipTransition[],
  splitIndex: number,
): BetweenClipTransition[] {
  const out: BetweenClipTransition[] = [];
  for (const tr of transitions) {
    const shift = tr.fromClipIndex >= splitIndex ? 1 : 0;
    const from = tr.fromClipIndex + shift;
    out.push({ ...tr, fromClipIndex: from, toClipIndex: from + 1 });
  }
  return out;
}

/** Drop any transition whose two (timeline-ordered) clips can no longer carry its
 *  duration — the EP1 "≤ half the shorter adjacent clip" guard, applied here so an
 *  op that shortens a clip (e.g. a tail-split) yields a parse-valid edit instead
 *  of shifting a transition then throwing at parse time. Clips are addressed in
 *  the SAME timeline order the contract validates (sorted by start). EPS mirrors
 *  the timeline.superRefine tolerance. */
export function dropTransitionsTooShort(
  transitions: BetweenClipTransition[],
  clips: ArtlioClip[],
): BetweenClipTransition[] {
  const ordered = [...clips].sort((a, b) => a.start - b.start);
  const EPS = 1e-6;
  return transitions.filter((tr) => {
    const from = ordered[tr.fromClipIndex];
    const to = ordered[tr.toClipIndex];
    if (!from || !to) return false; // dangling → drop
    const halfShorterMs = (Math.min(from.length, to.length) / 2) * 1000;
    return tr.durationMs <= halfShorterMs + EPS;
  });
}

/** Deleting clip `delIndex` drops any transition that TOUCHES it (fromClipIndex
 *  === delIndex || === delIndex-1, i.e. the boundary before or after it) and
 *  decrements every transition whose boundary is entirely after it. */
export function reindexTransitionsAfterDelete(
  transitions: BetweenClipTransition[],
  delIndex: number,
): BetweenClipTransition[] {
  const out: BetweenClipTransition[] = [];
  for (const tr of transitions) {
    if (tr.fromClipIndex === delIndex || tr.toClipIndex === delIndex) continue; // touches → drop
    const shift = tr.fromClipIndex > delIndex ? -1 : 0;
    const from = tr.fromClipIndex + shift;
    out.push({ ...tr, fromClipIndex: from, toClipIndex: from + 1 });
  }
  return out;
}

/** A move/reorder changes the sorted-by-start order. Recompute each transition by
 *  its CLIP IDENTITY: the pair (oldIds[from], oldIds[to]) keeps its transition iff
 *  those two clips are still consecutive AND in the same order in `newIds`;
 *  otherwise the pair no longer abuts and the transition is dropped. */
export function reindexTransitionsAfterMove(
  transitions: BetweenClipTransition[],
  oldIds: (string | null)[],
  newIds: (string | null)[],
): BetweenClipTransition[] {
  // only NON-null (truly identifiable) clips go in the position map; a null
  // identity (ambiguous duplicate-src, no id) can never match → its transition drops.
  const newPos = new Map<string, number>();
  newIds.forEach((id, i) => {
    if (id !== null) newPos.set(id, i);
  });
  const out: BetweenClipTransition[] = [];
  for (const tr of transitions) {
    const fromId = oldIds[tr.fromClipIndex];
    const toId = oldIds[tr.toClipIndex];
    if (fromId == null || toId == null) continue; // missing or ambiguous → drop
    const nf = newPos.get(fromId);
    const nt = newPos.get(toId);
    if (nf === undefined || nt === undefined) continue;
    if (nt !== nf + 1) continue; // no longer consecutive (or reversed) → drop
    out.push({ ...tr, fromClipIndex: nf, toClipIndex: nf + 1 });
  }
  return out;
}

/** Stable per-clip identity tokens, in TIMELINE order (sorted by start), for
 *  matching the same clip across a native Shotstack edit (reorder/trim).
 *
 *  - SDK clip `id` (the Editor reads clips with getEdit({includeIds:true}), and
 *    getClip/moveClipById confirm clips carry stable ids — not part of the
 *    artlioEdit contract, so read loosely) → `id:<id>`, the only TRUE identity.
 *  - else, a UNIQUE `asset.src` in the list → `src:<src>`: src alone identifies
 *    the clip, so a pure trim/reorder still tracks it.
 *  - else (DUPLICATE src AND no id) → `null` = NON-matchable. Occurrence index is
 *    positional, not identity: after a reorder, occurrence#0 names a *different*
 *    clip, so remapping by occurrence would silently move a transition to the
 *    WRONG boundary (Codex P1). With no way to tell the two apart we return null
 *    so reconcile DROPS the transition rather than mis-attach it. (A split makes
 *    two same-src halves, so this is the common ambiguous case; the Editor avoids
 *    it entirely by always reading real ids.) */
function clipIdentities(clips: ArtlioClip[]): (string | null)[] {
  const ordered = [...clips].sort((a, b) => a.start - b.start);
  // count srcs among the id-LESS clips, to spot ambiguous duplicates
  const srcCount = new Map<string, number>();
  for (const c of ordered) {
    const id = (c as { id?: unknown }).id;
    if (typeof id === "string" && id.length > 0) continue;
    srcCount.set(c.asset.src, (srcCount.get(c.asset.src) ?? 0) + 1);
  }
  return ordered.map((c) => {
    const id = (c as { id?: unknown }).id;
    if (typeof id === "string" && id.length > 0) return `id:${id}`;
    const src = c.asset.src;
    return (srcCount.get(src) ?? 0) > 1 ? null : `src:${src}`;
  });
}

/** Reconcile index-based transitions across a NATIVE clip-list change (Shotstack's
 *  own drag-reorder or trim, which re-tiles the track but leaves our boundary-
 *  INDEXED transitions pointing at the wrong clips). Maps each transition's two
 *  clips from `prevClips` to their positions in `nextClips` by CLIP IDENTITY
 *  (clipIdentities), keeping it iff those two clips are still a gapless-adjacent,
 *  long-enough pair in the new timeline order — otherwise it's cleanly DROPPED.
 *  Transitions stay stored index-based (the contract has no clip id); this only
 *  remaps old→new indices. Both clip lists are addressed in timeline order. */
export function reconcileTransitions(
  prevClips: ArtlioClip[],
  nextClips: ArtlioClip[],
  transitions: BetweenClipTransition[],
): BetweenClipTransition[] {
  if (transitions.length === 0) return [];
  const oldIds = clipIdentities(prevClips);
  const newIds = clipIdentities(nextClips);
  // remap indices by identity (drops pairs no longer consecutive / reordered),
  // then drop any pair that opened a gap or is now too short for its duration.
  const reindexed = reindexTransitionsAfterMove(transitions, oldIds, newIds);
  const ordered = [...nextClips].sort((a, b) => a.start - b.start);
  const EPS = 1e-6;
  return reindexed.filter((tr) => {
    const from = ordered[tr.fromClipIndex];
    const to = ordered[tr.toClipIndex];
    if (!from || !to) return false;
    if (Math.abs(to.start - (from.start + from.length)) > EPS) return false; // gap opened → drop
    const halfShorterMs = (Math.min(from.length, to.length) / 2) * 1000;
    return tr.durationMs <= halfShorterMs + EPS; // too short for duration → drop
  });
}

/** Clamp a legacy per-clip fade so it fits a (possibly shortened) clip half: the
 *  contract requires `clip.length >= fade.duration * 2`, so a split that leaves a
 *  half shorter than `2 * duration` must shrink the fade rather than throw at parse
 *  (Codex P2). The half is >= MIN_CLIP_SECONDS, so the clamped duration stays > 0. */
function fitFade(
  fade: NonNullable<ArtlioClip["transition"]>,
  halfLen: number,
): NonNullable<ArtlioClip["transition"]> {
  const maxDuration = halfLen / 2;
  return fade.duration > maxDuration ? { ...fade, duration: maxDuration } : fade;
}

/** Split the clip at `clipIndex` (timeline order, sorted by start) on track
 *  `trackIndex` at timeline time `atSeconds`. Returns a NEW edit with that clip
 *  replaced by two gapless halves; the tail's `trim` advances so it continues
 *  the source seamlessly. Transitions are re-indexed by shift (see
 *  reindexTransitionsAfterSplit); any whose now-shorter adjacent pair can no
 *  longer satisfy the transition's duration (the EP1 "≤ half the shorter clip"
 *  guard) is DROPPED so the result is always parse-valid — never shift-then-throw.
 *  Throws only if the split point isn't strictly inside the clip or either half
 *  would be < MIN_CLIP_SECONDS. The result re-parses through artlioEdit. */
export function splitClipAt(
  edit: ArtlioEdit,
  trackIndex: number,
  clipIndex: number,
  atSeconds: number,
): ArtlioEdit {
  const track = edit.timeline.tracks[trackIndex];
  if (!track) throw new Error(`split: track ${trackIndex} out of range`);
  // operate in timeline (sorted-by-start) order so indices match the contract
  const ordered = [...track.clips].sort((a, b) => a.start - b.start);
  const clip = ordered[clipIndex];
  if (!clip) throw new Error(`split: clip ${clipIndex} out of range`);

  const end = clip.start + clip.length;
  if (!(atSeconds > clip.start && atSeconds < end)) {
    throw new Error(`split: ${atSeconds}s is outside clip range [${clip.start}, ${end}]`);
  }
  const headLen = atSeconds - clip.start;
  const tailLen = end - atSeconds;
  if (headLen < MIN_CLIP_SECONDS || tailLen < MIN_CLIP_SECONDS) {
    throw new Error(`split: each half must be ≥ ${MIN_CLIP_SECONDS}s (got ${headLen}s / ${tailLen}s — too short)`);
  }

  const head: ArtlioClip = {
    ...structuredClone(clip),
    length: headLen,
    // head keeps its trim and any legacy fade-IN; drop a legacy fade-OUT (moves to tail)
    transition: clip.transition?.in ? fitFade({ ...clip.transition, out: undefined }, headLen) : undefined,
  };
  const tail: ArtlioClip = {
    ...structuredClone(clip),
    start: atSeconds,
    length: tailLen,
    asset: { ...structuredClone(clip.asset), trim: (clip.asset.trim ?? 0) + headLen },
    // tail keeps any legacy fade-OUT; drop the fade-IN
    transition: clip.transition?.out ? fitFade({ ...clip.transition, in: undefined }, tailLen) : undefined,
  };

  const nextClips = [...ordered.slice(0, clipIndex), head, tail, ...ordered.slice(clipIndex + 1)];
  // shift the boundary-indexed transitions, then DROP any whose now-shorter pair
  // can no longer carry its duration (≤ half the shorter clip) — splitting a
  // transitioned clip's tail can make the new tail too short for the cross-fade.
  // Dropping (vs throwing) keeps the rest of the cut intact and parse-valid.
  const nextTransitions = dropTransitionsTooShort(
    reindexTransitionsAfterSplit(track.transitions ?? [], clipIndex),
    nextClips,
  );

  const nextTrack = { ...track, clips: nextClips, transitions: nextTransitions.length ? nextTransitions : undefined };
  const nextEdit: ArtlioEdit = {
    ...edit,
    timeline: { ...edit.timeline, tracks: edit.timeline.tracks.map((t, i) => (i === trackIndex ? nextTrack : t)) },
  };
  return artlioEdit.parse(nextEdit); // canonicalize + enforce EP1 guards
}

/** Remove the clip at `clipIndex` (timeline order) on track `trackIndex` and
 *  shift every downstream clip's start LEFT by the removed length (close the
 *  gap). Transitions touching the removed clip are dropped; later ones decrement.
 *  Throws if it would empty the track (the contract requires ≥1 clip). Re-parses. */
export function rippleDeleteClip(edit: ArtlioEdit, trackIndex: number, clipIndex: number): ArtlioEdit {
  const track = edit.timeline.tracks[trackIndex];
  if (!track) throw new Error(`ripple-delete: track ${trackIndex} out of range`);
  if (track.clips.length <= 1) throw new Error(`ripple-delete: cannot remove the last clip on a track (≥1 required)`);

  const ordered = [...track.clips].sort((a, b) => a.start - b.start);
  const removed = ordered[clipIndex];
  if (!removed) throw new Error(`ripple-delete: clip ${clipIndex} out of range`);

  const nextClips = ordered
    .filter((_, i) => i !== clipIndex)
    .map((c, i) => (i >= clipIndex ? { ...c, start: c.start - removed.length } : c));
  const nextTransitions = reindexTransitionsAfterDelete(track.transitions ?? [], clipIndex);

  const nextTrack = { ...track, clips: nextClips, transitions: nextTransitions.length ? nextTransitions : undefined };
  const nextEdit: ArtlioEdit = {
    ...edit,
    timeline: { ...edit.timeline, tracks: edit.timeline.tracks.map((t, i) => (i === trackIndex ? nextTrack : t)) },
  };
  return artlioEdit.parse(nextEdit);
}

/** Move the clip at timeline position `fromIndex` to `toIndex` on track
 *  `trackIndex`, then RE-TILE the track gapless from 0 (starts = cumulative
 *  length). Transitions are re-indexed by clip identity — one survives only if
 *  its two clips stay consecutive in the new order. Returns a re-parsed edit. */
export function moveClip(edit: ArtlioEdit, trackIndex: number, fromIndex: number, toIndex: number): ArtlioEdit {
  const track = edit.timeline.tracks[trackIndex];
  if (!track) throw new Error(`move: track ${trackIndex} out of range`);
  const ordered = [...track.clips].sort((a, b) => a.start - b.start);
  if (fromIndex < 0 || fromIndex >= ordered.length || toIndex < 0 || toIndex >= ordered.length) {
    throw new Error(`move: index out of range (from ${fromIndex}, to ${toIndex}, len ${ordered.length})`);
  }

  // identity tokens for the transition re-index (the contract has no clip id)
  const oldIds = ordered.map((_, i) => `c${i}`);
  const moving = ordered[fromIndex]!;
  const movingId = oldIds[fromIndex]!;
  const withoutFrom = ordered.filter((_, i) => i !== fromIndex);
  const idsWithoutFrom = oldIds.filter((_, i) => i !== fromIndex);
  const newOrdered = [...withoutFrom.slice(0, toIndex), moving, ...withoutFrom.slice(toIndex)];
  const newIds = [...idsWithoutFrom.slice(0, toIndex), movingId, ...idsWithoutFrom.slice(toIndex)];

  // re-tile gapless from 0
  let cursor = 0;
  const nextClips = newOrdered.map((c) => {
    const placed = { ...c, start: cursor };
    cursor += c.length;
    return placed;
  });
  const nextTransitions = reindexTransitionsAfterMove(track.transitions ?? [], oldIds, newIds);

  const nextTrack = { ...track, clips: nextClips, transitions: nextTransitions.length ? nextTransitions : undefined };
  const nextEdit: ArtlioEdit = {
    ...edit,
    timeline: { ...edit.timeline, tracks: edit.timeline.tracks.map((t, i) => (i === trackIndex ? nextTrack : t)) },
  };
  return artlioEdit.parse(nextEdit);
}

/** Default snap threshold (seconds): an edge within this of a target snaps to it. */
export const SNAP_THRESHOLD_SECONDS = 0.15;

/** Contract-time snapping (snap-on-commit; Shotstack exposes no pixel→time map).
 *  For LTX-light's single tiled visual track, "snap" = if the track is within
 *  `threshold` of being perfectly tiled-from-0, re-tile it exactly (close tiny
 *  gaps, pin the first start to 0). A gap LARGER than threshold is left alone (a
 *  deliberate gap, not a snap miss). Audio tracks are untouched. Re-parses. */
export function snapEdit(edit: ArtlioEdit, threshold = SNAP_THRESHOLD_SECONDS): ArtlioEdit {
  const tracks = edit.timeline.tracks.map((track) => {
    const isVisual = track.clips.some((c) => c.asset.type !== "audio");
    if (!isVisual) return track;
    const ordered = [...track.clips].sort((a, b) => a.start - b.start);
    // decide whether the track is "near-tiled": every boundary gap ≤ threshold
    let cursor = 0;
    let nearTiled = true;
    for (const c of ordered) {
      if (Math.abs(c.start - cursor) > threshold) {
        nearTiled = false;
        break;
      }
      cursor += c.length;
    }
    if (!nearTiled) return track; // a real gap — don't snap it shut
    // re-tile exactly from 0
    let t = 0;
    const clips = ordered.map((c) => {
      const placed = { ...c, start: t };
      t += c.length;
      return placed;
    });
    return { ...track, clips };
  });
  return artlioEdit.parse({ ...edit, timeline: { ...edit.timeline, tracks } });
}
