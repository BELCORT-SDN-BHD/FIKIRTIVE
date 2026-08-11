/**
 * Cut algebra for the edit desk (#780).
 *
 * The joining/caption/music ENGINE was already built and running (contract in
 * packages/core/timeline.ts, ffmpeg + whisper in apps/worker) — what was missing was a
 * merchant-sized vocabulary on top of it. The editor that used to speak that vocabulary
 * left with #606, so `saveProjectEdit` / `addSegmentToCut` sat with no callers and a
 * merchant could not get "join these three clips", "put the words on screen" or "lay
 * music under it" out of a product that already knew how to do all three.
 *
 * This module is that vocabulary and NOTHING else: four pure functions over the SAME
 * FikirtiveEdit document the worker renders. No Prisma, no session, no I/O — so both
 * surfaces (the merchant's own edit desk and Otto's assistance path) can be built on one
 * implementation, and this file's behaviour is provable without a database.
 *
 * Every function returns a CANONICALIZED edit (`fikirtiveEdit.parse`), never a hand-built
 * object: the contract stays the single judge of what is a legal cut, and a caller can
 * persist what it gets back without re-deciding anything. Anything the contract refuses
 * comes back as `{ error }` in merchant English — never a zod message.
 */
import {
  editDuration,
  fikirtiveEdit,
  EXT_BY_TYPE,
  MAX_CAPTIONS,
  MAX_CLIPS_PER_TRACK,
  MAX_TIMELINE_SECONDS,
  type CaptionCue,
  type FikirtiveEdit,
} from "@fikirtive/core";

/** A piece of the merchant's own media, as the desk hands it around. */
export type DeskClip = {
  src: string;
  kind: "video" | "image" | "audio";
  seconds: number;
};

/** The same clip, offered for picking — with a name a person can tell apart from the next one. */
export type DeskMedia = DeskClip & { label: string };

/** What to call this clip on screen.
 *
 *  A merchant picking three clips out of twelve has to know WHICH three, and a content hash
 *  cannot tell them: it is an identifier for us, not a name for them. So the name is what they
 *  asked for when it was made, cut to a glance; only when there is nothing to quote does it
 *  fall back to what kind of thing it is. */
export function deskClipLabel(promptText: string, kind: DeskClip["kind"]): string {
  const asked = promptText.trim().replace(/\s+/g, " ");
  if (asked.length > 0) return asked.length > 48 ? `${asked.slice(0, 47)}…` : asked;
  return kind === "video" ? "Clip" : kind === "image" ? "Still" : "Music";
}

/** A still has no length of its own — this is how long one is held on screen. */
export const STILL_SECONDS = 3;
/** Length for a clip ingested before the duration probe ran (same fallback as the editor's). */
export const UNKNOWN_CLIP_SECONDS = 5;

/** Which of the three kinds a file extension is, or null when it can't be in a video.
 *  Read off the contract's own allow-list, so "what can go in a cut" has one definition. */
export function deskClipKind(ext: string): DeskClip["kind"] | null {
  const lower = ext.toLowerCase();
  for (const kind of ["video", "image", "audio"] as const) {
    if ((EXT_BY_TYPE[kind] as readonly string[]).includes(lower)) return kind;
  }
  return null;
}

/** How long this clip runs on the timeline. */
export function deskClipSeconds(kind: DeskClip["kind"], durationS: number | null): number {
  if (kind === "image") return STILL_SECONDS;
  return durationS && durationS > 0 ? durationS : UNKNOWN_CLIP_SECONDS;
}

/** What the desk (and Otto) reads back about the saved cut — no JSON in sight. */
export type CutSummary = {
  clips: { src: string; kind: "video" | "image"; seconds: number }[];
  seconds: number;
  captionCount: number;
  /** the music bed's src, or null when the cut has no music */
  music: string | null;
};

type Track = FikirtiveEdit["timeline"]["tracks"][number];
type Clip = Track["clips"][number];

const EPS = 1e-6;

const isVisualTrack = (t: Track) => t.clips.some((c) => c.asset.type !== "audio");

/** The empty cut a first join starts from — the same shape actions.ts already blanks to.
 *  Deliberately NOT parsed: the contract requires at least one clip on a track, and an empty
 *  cut is a scratch value that a join replaces before anything is persisted. It never reaches
 *  the database, because every function below canonicalizes its OWN result. */
export function blankCut(): FikirtiveEdit {
  return {
    timeline: { background: "#000000", tracks: [{ clips: [] }] },
    output: { format: "mp4", resolution: "hd", aspectRatio: "16:9", fps: 25 },
  };
}

/** Canonicalize, turning the contract's refusal into one merchant sentence. */
function canonicalize(next: unknown, refusal: string): FikirtiveEdit | { error: string } {
  const parsed = fikirtiveEdit.safeParse(next);
  return parsed.success ? parsed.data : { error: refusal };
}

/**
 * Join clips into ONE video, in the order the merchant picked them.
 *
 * Gapless from zero: transitions, captions and the music bed are all addressed against
 * timeline time, so a gap would silently move every one of them. The visual track is
 * REPLACED (this is "these clips, in this order"), while the music bed and the output
 * settings survive — re-joining after adding music must not throw the music away.
 *
 * Captions are kept ONLY where the clip under them did not move. Re-ordering or dropping a
 * clip changes what is on screen at a given second, and a caption that stayed behind would
 * then be words spoken over different footage — a silent, merchant-visible lie. Adding one
 * more clip at the end (the common case) moves nothing, so those captions survive.
 */
export function joinClips(base: FikirtiveEdit | null, clips: DeskClip[]): FikirtiveEdit | { error: string } {
  if (clips.length === 0) return { error: "Pick at least one clip to join." };
  const audio = clips.find((c) => c.kind === "audio");
  if (audio) return { error: "Music goes under the video, not in it — pick videos or images to join, then add music." };
  if (clips.length > MAX_CLIPS_PER_TRACK) {
    return { error: `One video can hold up to ${MAX_CLIPS_PER_TRACK} clips — you picked ${clips.length}.` };
  }

  let cursor = 0;
  const visual: Clip[] = clips.map((c) => {
    const clip: Clip = { asset: { type: c.kind, src: c.src }, start: cursor, length: c.seconds };
    cursor += c.seconds;
    return clip;
  });
  if (cursor > MAX_TIMELINE_SECONDS + EPS) {
    return { error: `Those clips run ${Math.round(cursor / 60)} minutes together — one video can be up to ${MAX_TIMELINE_SECONDS / 60} minutes.` };
  }

  const from = base ?? blankCut();
  const before = from.timeline.tracks.find(isVisualTrack)?.clips ?? [];
  const audioTracks = from.timeline.tracks.filter((t) => !isVisualTrack(t)).map((t) => fitTrackTo(t, cursor));
  return canonicalize(
    {
      ...from,
      timeline: {
        ...from.timeline,
        tracks: [{ clips: visual }, ...audioTracks.filter((t): t is Track => t !== null)],
        captions: (from.timeline.captions ?? []).filter((c) => stillOverTheSameClip(before, visual, c.startMs)),
        textOverlays: (from.timeline.textOverlays ?? []).filter(
          (o) => o.startMs / 1000 + o.lengthMs / 1000 <= cursor + EPS,
        ),
      },
    },
    "Those clips don't make a video we can render — try picking fewer, or shorter, ones.",
  );
}

/** The clip playing at this moment on the timeline, or undefined in a gap. */
function clipAt(clips: Clip[], ms: number): Clip | undefined {
  const seconds = ms / 1000;
  return clips.find((c) => seconds >= c.start - EPS && seconds < c.start + c.length - EPS);
}

/** Is the same footage still playing at this moment, at the same place? */
function stillOverTheSameClip(before: Clip[], after: Clip[], ms: number): boolean {
  const was = clipAt(before, ms);
  const now = clipAt(after, ms);
  if (!was || !now) return false;
  return (
    was.asset.src === now.asset.src &&
    Math.abs(was.start - now.start) < EPS &&
    Math.abs(was.length - now.length) < EPS
  );
}

/** Trim an audio track so it can't run past the video. Returns null when nothing is left. */
function fitTrackTo(t: Track, seconds: number): Track | null {
  const clips = t.clips
    .filter((c) => c.start < seconds - EPS)
    .map((c) => ({ ...c, length: Math.min(c.length, seconds - c.start) }));
  return clips.length > 0 ? { ...t, clips } : null;
}

/**
 * Lay a music bed under the whole video.
 *
 * `audioRole: "music"` is not decoration — it is what makes the worker duck the bed under
 * any voice (sidechaincompress) instead of flat-mixing it over the talking. One bed only:
 * a second call replaces the first, so "change the music" is the same action as "add music"
 * and a merchant can never end up with two songs playing at once.
 */
export function withMusic(base: FikirtiveEdit | null, music: DeskClip): FikirtiveEdit | { error: string } {
  if (music.kind !== "audio") return { error: "That file isn't music — pick an audio file." };
  if (!base) return { error: "Join your clips into a video first, then add music under it." };
  const seconds = editDuration(base);
  if (seconds <= 0) return { error: "Join your clips into a video first, then add music under it." };
  // everything EXCEPT the old bed survives — replacing the music must not silently take
  // any other sound off the video with it
  const kept = base.timeline.tracks.filter((t) => isVisualTrack(t) || t.audioRole !== "music");
  const length = Math.min(music.seconds, seconds);
  if (length <= 0) return { error: "That music track has no length we can read — try another file." };
  return canonicalize(
    {
      ...base,
      timeline: {
        ...base.timeline,
        tracks: [
          ...kept,
          { clips: [{ asset: { type: "audio", src: music.src }, start: 0, length }], audioRole: "music" },
        ],
      },
    },
    "That music can't go under this video — try another file.",
  );
}

/** Take the music bed off again (an entrance always gets an exit). */
export function withoutMusic(base: FikirtiveEdit | null): FikirtiveEdit | { error: string } {
  if (!base) return { error: "There's no video to change yet." };
  const kept = base.timeline.tracks.filter((t) => isVisualTrack(t) || t.audioRole !== "music");
  if (kept.length === 0) return { error: "There's no video to change yet." };
  return canonicalize(
    { ...base, timeline: { ...base.timeline, tracks: kept } },
    "Couldn't take the music off this video.",
  );
}

/**
 * Put one clip's words on screen.
 *
 * The transcript comes back addressed to the CLIP's own audio (0 = the clip's first frame),
 * while `timeline.captions` is addressed to the finished video — so every cue shifts by
 * where that clip sits in the cut. Only the window belonging to this clip is rewritten:
 * captioning clip 3 must not wipe the words already on clips 1 and 2.
 *
 * Cues that spill past the clip are clamped, and anything past the end of the video is
 * dropped — the contract refuses a caption window that ends after the last frame, and a
 * merchant should get their captions, not a rejected save.
 *
 * A clip used twice in one video is captioned where it FIRST plays; captioning the second
 * placement separately is not something either surface can ask for today.
 */
export function withCaptionsForClip(
  base: FikirtiveEdit | null,
  src: string,
  cues: CaptionCue[],
): FikirtiveEdit | { error: string } {
  if (!base) return { error: "Join your clips into a video first, then add captions." };
  const track = base.timeline.tracks.find(isVisualTrack);
  const clip = track?.clips.find((c) => c.asset.src === src);
  if (!track || !clip) return { error: "That clip isn't in this video — add it first, then caption it." };
  if (cues.length === 0) return { error: "There are no words to put on screen for that clip yet." };

  const startMs = Math.round(clip.start * 1000);
  const endMs = Math.round((clip.start + clip.length) * 1000);
  const timelineEndMs = Math.round(editDuration(base) * 1000);
  const limitMs = Math.min(endMs, timelineEndMs);

  const shifted: CaptionCue[] = [];
  for (const cue of cues) {
    const cueStart = startMs + cue.startMs;
    if (cueStart >= limitMs) continue; // starts after this clip is over
    const lengthMs = Math.min(cue.lengthMs, limitMs - cueStart);
    if (lengthMs <= 0) continue;
    shifted.push({ startMs: cueStart, lengthMs, text: cue.text });
  }
  if (shifted.length === 0) return { error: "There are no words to put on screen for that clip yet." };

  // keep every cue that belongs to a DIFFERENT clip, replace this clip's window
  const others = (base.timeline.captions ?? []).filter((c) => c.startMs < startMs || c.startMs >= endMs);
  const merged = [...others, ...shifted].sort((a, b) => a.startMs - b.startMs);
  if (merged.length > MAX_CAPTIONS) {
    return { error: `That's more than ${MAX_CAPTIONS} captions on one video — caption fewer clips, or shorten it.` };
  }
  return canonicalize(
    { ...base, timeline: { ...base.timeline, captions: merged } },
    "Those captions don't fit this video — try captioning it again after your last change.",
  );
}

/** Take every caption off (the exit for the caption entrance). */
export function withoutCaptions(base: FikirtiveEdit | null): FikirtiveEdit | { error: string } {
  if (!base) return { error: "There's no video to change yet." };
  return canonicalize(
    { ...base, timeline: { ...base.timeline, captions: [] } },
    "Couldn't take the captions off this video.",
  );
}

/** What the merchant (or Otto) is told about the saved cut. */
export function summarizeCut(edit: FikirtiveEdit | null): CutSummary {
  if (!edit) return { clips: [], seconds: 0, captionCount: 0, music: null };
  const visual = edit.timeline.tracks.find(isVisualTrack);
  const music = edit.timeline.tracks.find((t) => !isVisualTrack(t) && t.audioRole === "music");
  return {
    clips: (visual?.clips ?? [])
      .filter((c) => c.asset.type !== "audio")
      .sort((a, b) => a.start - b.start)
      .map((c) => ({ src: c.asset.src, kind: c.asset.type as "video" | "image", seconds: c.length })),
    seconds: editDuration(edit),
    captionCount: edit.timeline.captions?.length ?? 0,
    music: music?.clips[0]?.asset.src ?? null,
  };
}
