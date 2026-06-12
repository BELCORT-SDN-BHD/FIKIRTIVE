import "server-only";
import { storageKey, storageKeyToSrc, TRANSITION_DEFAULT_SECONDS, type ArtlioEdit } from "@artlio/core";
import type { ShotWithDetail, CandidateGen } from "./data";

const VIDEO_EXTS = new Set(["mp4", "mov", "webm", "mkv"]);
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif", "avif"]);
const IMAGE_SECONDS = 3;          // images have no inherent duration — product default
const FALLBACK_VIDEO_SECONDS = 5; // covers assets ingested before the probe ran

type Clip = ArtlioEdit["timeline"]["tracks"][number]["clips"][number];
type AssetRow = { ownerId: string; contentHash: string; ext: string; durationS: number | null };

function toClip(asset: AssetRow, isVideo: boolean, start: number): Clip {
  const length = isVideo ? (asset.durationS ?? FALLBACK_VIDEO_SECONDS) : IMAGE_SECONDS;
  return {
    asset: { type: isVideo ? "video" : "image", src: storageKeyToSrc(storageKey(asset.ownerId, asset.contentHash, asset.ext.toLowerCase())) },
    start,
    length,
  };
}

/** Map a storyboard segment's transition ("in"/"out"/"both") to a clip fade.
 *  Skipped when the clip is too short for the fade (contract: length ≥ 2×dur),
 *  so a board cut can never validate out-of-contract on export. */
export function transitionFor(t: string | null, length: number): Clip["transition"] {
  if (!t || length < TRANSITION_DEFAULT_SECONDS * 2) return undefined;
  return {
    in: t === "in" || t === "both" ? ("fade" as const) : undefined,
    out: t === "out" || t === "both" ? ("fade" as const) : undefined,
    duration: TRANSITION_DEFAULT_SECONDS,
  };
}

/** Initial cut for the editor: each shot's latest attached render in board order,
 *  then any unattached Gen-space *video* clips (candidates not yet on a shot) so
 *  anything you generated is available to cut. A persisted savedEdit still wins
 *  over this in the editor. Returns the edit (null if empty) + the clip count. */
export function buildBoardEdit(shots: ShotWithDetail[], candidates: CandidateGen[]): { edit: ArtlioEdit | null; clipCount: number } {
  const clips: Clip[] = [];
  let cursor = 0;
  for (const shot of shots) {
    const latest = shot.generations[0]; // version desc, attached only
    if (!latest) continue;
    const ext = latest.asset.ext.toLowerCase();
    const isVideo = VIDEO_EXTS.has(ext);
    if (!isVideo && !IMAGE_EXTS.has(ext)) continue;
    const c = toClip(latest.asset, isVideo, cursor);
    const tr = transitionFor(shot.transition, c.length);
    if (tr) c.transition = tr;
    clips.push(c);
    cursor += c.length;
  }
  for (const cand of candidates) {
    // loose candidates: videos only — a "Video editor" shouldn't auto-fill with stills
    if (!VIDEO_EXTS.has(cand.asset.ext.toLowerCase())) continue;
    const c = toClip(cand.asset, true, cursor);
    clips.push(c);
    cursor += c.length;
  }
  const edit: ArtlioEdit | null = clips.length > 0
    ? { timeline: { background: "#000000", tracks: [{ clips }] }, output: { format: "mp4", resolution: "1080", aspectRatio: "16:9", fps: 25 } }
    : null;
  return { edit, clipCount: clips.length };
}
