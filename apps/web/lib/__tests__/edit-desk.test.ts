/**
 * #780 — the cut algebra behind both surfaces.
 *
 * These are the assertions that make "join / captions / music" a capability rather than three
 * buttons: whatever the merchant's desk and Otto each ask for, they go through THESE functions,
 * so proving them here proves both surfaces at once.
 *
 * Everything asserted is about the DOCUMENT the worker will render — not about a return value
 * being truthy. The engine reads `audioRole` to duck music, reads `timeline.captions` in
 * timeline time, and refuses a caption window past the last frame; a test that only checked
 * "no error" would pass while the merchant got silence, no words, or a rejected save.
 */
import { describe, it, expect } from "vitest";
import { editDuration, fikirtiveEdit, MAX_TIMELINE_SECONDS, type FikirtiveEdit } from "@fikirtive/core";
import {
  blankCut,
  deskClipKind,
  deskClipLabel,
  deskClipSeconds,
  joinClips,
  readSavedCut,
  summarizeCut,
  withCaptionsForClip,
  withMusic,
  withoutCaptions,
  withoutMusic,
  STILL_SECONDS,
  UNKNOWN_CLIP_SECONDS,
  type DeskClip,
} from "../edit-desk";

const OWNER = "org_desk";
const hash = (n: number) => String(n).repeat(64).slice(0, 64);
const vid = (n: number, seconds = 5): DeskClip => ({ src: `/files/u/${OWNER}/${hash(n)}.mp4`, kind: "video", seconds });
const still = (n: number): DeskClip => ({ src: `/files/u/${OWNER}/${hash(n)}.png`, kind: "image", seconds: STILL_SECONDS });
const song = (n: number, seconds = 60): DeskClip => ({ src: `/files/u/${OWNER}/${hash(n)}.mp3`, kind: "audio", seconds });

/** Unwrap, failing loudly with the merchant sentence when a step refused. */
function ok(result: FikirtiveEdit | { error: string }): FikirtiveEdit {
  if ("error" in result) throw new Error(`unexpected refusal: ${result.error}`);
  return result;
}

describe("joinClips — three clips become one video", () => {
  it("lays them gapless, in the order picked, and the contract accepts it", () => {
    const cut = ok(joinClips(null, [vid(1, 4), vid(2, 6), vid(3, 5)]));
    const track = cut.timeline.tracks[0]!;
    expect(track.clips.map((c) => c.asset.src)).toEqual([vid(1).src, vid(2).src, vid(3).src]);
    expect(track.clips.map((c) => c.start)).toEqual([0, 4, 10]);
    expect(editDuration(cut)).toBe(15);
    // the persisted document is the contract's own output, not a hand-built object
    expect(fikirtiveEdit.safeParse(cut).success).toBe(true);
  });

  it("order is the merchant's, not the media library's", () => {
    const forwards = ok(joinClips(null, [vid(1), vid(2)]));
    const backwards = ok(joinClips(null, [vid(2), vid(1)]));
    expect(forwards.timeline.tracks[0]!.clips[0]!.asset.src).not.toBe(
      backwards.timeline.tracks[0]!.clips[0]!.asset.src,
    );
  });

  it("stills join too, held for their own on-screen length", () => {
    const cut = ok(joinClips(null, [still(1), vid(2, 4)]));
    expect(cut.timeline.tracks[0]!.clips[0]!.length).toBe(STILL_SECONDS);
    expect(editDuration(cut)).toBe(STILL_SECONDS + 4);
  });

  it("re-joining keeps the music the merchant already chose", () => {
    const first = ok(joinClips(null, [vid(1, 10)]));
    const scored = ok(withMusic(first, song(9, 30)));
    const rejoined = ok(joinClips(scored, [vid(1, 10), vid(2, 10)]));
    expect(summarizeCut(rejoined).music).toBe(song(9).src);
    expect(summarizeCut(rejoined).clips).toHaveLength(2);
  });

  it("music never outlives the video it sits under", () => {
    const long = ok(withMusic(ok(joinClips(null, [vid(1, 20)])), song(9, 60)));
    const shorter = ok(joinClips(long, [vid(1, 6)]));
    const musicTrack = shorter.timeline.tracks.find((t) => t.audioRole === "music")!;
    expect(musicTrack.clips[0]!.length).toBe(6);
    expect(fikirtiveEdit.safeParse(shorter).success).toBe(true);
  });

  it("adding one more clip at the end keeps the captions already on the earlier ones", () => {
    const first = ok(joinClips(null, [vid(1, 10)]));
    const captioned = ok(withCaptionsForClip(first, vid(1).src, [{ startMs: 0, lengthMs: 1000, text: "our new sauce" }]));
    const extended = ok(joinClips(captioned, [vid(1, 10), vid(2, 10)]));
    expect(extended.timeline.captions).toEqual([{ startMs: 0, lengthMs: 1000, text: "our new sauce" }]);
  });

  it("re-ordering drops the words rather than leaving them over the wrong footage", () => {
    const first = ok(joinClips(null, [vid(1, 10), vid(2, 10)]));
    const captioned = ok(withCaptionsForClip(first, vid(1).src, [{ startMs: 0, lengthMs: 1000, text: "our new sauce" }]));
    // clip 1 now plays SECOND — a caption left at 0s would be its words over clip 2's picture
    const reordered = ok(joinClips(captioned, [vid(2, 10), vid(1, 10)]));
    expect(reordered.timeline.captions ?? []).toEqual([]);
  });

  it("refuses an empty pick, and audio picked as picture", () => {
    expect(joinClips(null, [])).toEqual({ error: expect.stringContaining("at least one clip") });
    const refused = joinClips(null, [vid(1), song(9)]) as { error: string };
    expect(refused.error).toContain("Music goes under the video");
  });

  it("refuses a cut longer than one video can be — in words, not zod's", () => {
    const refused = joinClips(null, [vid(1, MAX_TIMELINE_SECONDS), vid(2, 60)]) as { error: string };
    expect(refused.error).toContain("minutes");
    expect(refused.error).not.toContain("timeline");
  });
});

describe("withMusic — a bed the renderer will duck", () => {
  it("marks the track as music, which is what turns ducking on", () => {
    const cut = ok(withMusic(ok(joinClips(null, [vid(1, 12)])), song(9, 30)));
    const music = cut.timeline.tracks.find((t) => t.audioRole === "music");
    expect(music).toBeDefined();
    expect(music!.clips[0]!.asset.type).toBe("audio");
    expect(music!.clips[0]!.start).toBe(0);
    expect(music!.clips[0]!.length).toBe(12); // trimmed to the video, not the song
  });

  it("a second choice replaces the first — never two songs at once", () => {
    const one = ok(withMusic(ok(joinClips(null, [vid(1, 12)])), song(8, 30)));
    const two = ok(withMusic(one, song(9, 30)));
    const beds = two.timeline.tracks.filter((t) => t.audioRole === "music");
    expect(beds).toHaveLength(1);
    expect(beds[0]!.clips[0]!.asset.src).toBe(song(9).src);
  });

  it("refuses music before there is anything to put it under", () => {
    expect(withMusic(null, song(9))).toEqual({ error: expect.stringContaining("Join your clips") });
    expect(withMusic(blankCut(), song(9))).toEqual({ error: expect.stringContaining("Join your clips") });
  });

  it("withoutMusic leaves the picture exactly as it was", () => {
    const scored = ok(withMusic(ok(joinClips(null, [vid(1, 12)])), song(9, 30)));
    const bare = ok(withoutMusic(scored));
    expect(bare.timeline.tracks).toHaveLength(1);
    expect(editDuration(bare)).toBe(12);
  });
});

describe("withCaptionsForClip — the words land where the clip plays", () => {
  const cut = ok(joinClips(null, [vid(1, 10), vid(2, 10)]));

  it("shifts a clip's own transcript into timeline time", () => {
    // the transcript is addressed to the CLIP (0 = its first frame); clip 2 starts at 10s
    const withWords = ok(
      withCaptionsForClip(cut, vid(2).src, [
        { startMs: 0, lengthMs: 2000, text: "same day delivery" },
        { startMs: 3000, lengthMs: 1500, text: "order before noon" },
      ]),
    );
    expect(withWords.timeline.captions).toEqual([
      { startMs: 10_000, lengthMs: 2000, text: "same day delivery" },
      { startMs: 13_000, lengthMs: 1500, text: "order before noon" },
    ]);
  });

  it("captioning a second clip keeps the first clip's words", () => {
    const one = ok(withCaptionsForClip(cut, vid(1).src, [{ startMs: 0, lengthMs: 1000, text: "hello" }]));
    const both = ok(withCaptionsForClip(one, vid(2).src, [{ startMs: 0, lengthMs: 1000, text: "goodbye" }]));
    expect(both.timeline.captions!.map((c) => c.text)).toEqual(["hello", "goodbye"]);
  });

  it("re-captioning the SAME clip replaces its words rather than doubling them", () => {
    const one = ok(withCaptionsForClip(cut, vid(1).src, [{ startMs: 0, lengthMs: 1000, text: "first go" }]));
    const again = ok(withCaptionsForClip(one, vid(1).src, [{ startMs: 0, lengthMs: 1000, text: "second go" }]));
    expect(again.timeline.captions!.map((c) => c.text)).toEqual(["second go"]);
  });

  it("clamps a cue that would run past the end — the contract refuses those outright", () => {
    const withWords = ok(
      withCaptionsForClip(cut, vid(2).src, [{ startMs: 9000, lengthMs: 60_000, text: "long tail" }]),
    );
    const cue = withWords.timeline.captions![0]!;
    expect(cue.startMs + cue.lengthMs).toBeLessThanOrEqual(Math.round(editDuration(cut) * 1000));
    expect(fikirtiveEdit.safeParse(withWords).success).toBe(true);
  });

  it("refuses a clip that isn't in the video, and an empty transcript", () => {
    const missing = withCaptionsForClip(cut, vid(7).src, [{ startMs: 0, lengthMs: 500, text: "x" }]) as { error: string };
    expect(missing.error).toContain("isn't in this video");
    const empty = withCaptionsForClip(cut, vid(1).src, []) as { error: string };
    expect(empty.error).toContain("no words");
  });

  it("withoutCaptions takes every word back off", () => {
    const one = ok(withCaptionsForClip(cut, vid(1).src, [{ startMs: 0, lengthMs: 1000, text: "hello" }]));
    expect(summarizeCut(ok(withoutCaptions(one))).captionCount).toBe(0);
  });
});

describe("summarizeCut — what the merchant and Otto are told", () => {
  it("reports clips, length, captions and music, and no timeline JSON", () => {
    const built = ok(
      withCaptionsForClip(
        ok(withMusic(ok(joinClips(null, [vid(1, 4), vid(2, 6)])), song(9, 30))),
        vid(1).src,
        [{ startMs: 0, lengthMs: 1000, text: "hi" }],
      ),
    );
    expect(summarizeCut(built)).toEqual({
      clips: [
        { src: vid(1).src, kind: "video", seconds: 4 },
        { src: vid(2).src, kind: "video", seconds: 6 },
      ],
      seconds: 10,
      captionCount: 1,
      music: song(9).src,
    });
  });

  it("an absent cut summarizes to nothing, never to a crash", () => {
    expect(summarizeCut(null)).toEqual({ clips: [], seconds: 0, captionCount: 0, music: null });
  });
});

describe("kind + length come off the contract's own allow-list", () => {
  it("maps the extensions the editor accepts, and refuses the rest", () => {
    expect(deskClipKind("mp4")).toBe("video");
    expect(deskClipKind("MOV")).toBe("video");
    expect(deskClipKind("png")).toBe("image");
    expect(deskClipKind("mp3")).toBe("audio");
    expect(deskClipKind("pdf")).toBeNull();
  });

  it("a still has a fixed hold; unmeasured PICTURE gets the app's standing fallback", () => {
    expect(deskClipSeconds("image", 999)).toBe(STILL_SECONDS);
    expect(deskClipSeconds("video", null)).toBe(UNKNOWN_CLIP_SECONDS);
    expect(deskClipSeconds("video", 12)).toBe(12);
  });

  it("unmeasured MUSIC comes back unknown — a guess would be written under the video for good", () => {
    // The bed is promised under the whole video. Calling an unmeasured song five seconds long
    // lays five seconds of it under a three-minute video and keeps it that way, which is why
    // this one case refuses to answer instead of answering wrongly.
    expect(deskClipSeconds("audio", null)).toBeNull();
    expect(deskClipSeconds("audio", 0)).toBeNull();
    expect(deskClipSeconds("audio", 92)).toBe(92);
  });

  it("a clip is named by what the merchant asked for, never by its hash", () => {
    expect(deskClipLabel("  our new  sauce ", "video")).toBe("our new sauce");
    expect(deskClipLabel("", "video")).toBe("Clip");
    expect(deskClipLabel("", "image")).toBe("Still");
    expect(deskClipLabel("", "audio")).toBe("Music");
    expect(deskClipLabel("x".repeat(200), "video")).toHaveLength(48); // 47 + the ellipsis
  });
});

describe("readSavedCut — three states, because two would lose work", () => {
  const legal = ok(joinClips(null, [vid(1, 4)]));

  it("nothing saved is 'empty'", () => {
    expect(readSavedCut(null)).toEqual({ state: "empty" });
    expect(readSavedCut(undefined)).toEqual({ state: "empty" });
  });

  it("a legal saved document comes back parsed, ready to build on", () => {
    const read = readSavedCut(JSON.parse(JSON.stringify(legal)));
    expect(read.state).toBe("cut");
    if (read.state !== "cut") return;
    expect(editDuration(read.edit)).toBe(4);
  });

  it("saved-but-unreadable is its OWN state, never folded into 'empty'", () => {
    // Every shape a row can take that we cannot read: a version we don't understand, a
    // half-written object, and something that isn't an edit at all.
    for (const damaged of [
      { timeline: { tracks: [{ clips: [{ asset: { type: "hologram", src: "/files/u/o/a.mp4" }, start: 0, length: 4 }] }] } },
      { timeline: { background: "#000000", tracks: [] }, output: { format: "mp4" } },
      { note: "someone stored the wrong thing here" },
      "not even an object",
      42,
    ]) {
      expect(readSavedCut(damaged), JSON.stringify(damaged)).toEqual({ state: "unreadable" });
    }
  });
});
