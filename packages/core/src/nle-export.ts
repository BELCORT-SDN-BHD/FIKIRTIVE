import type { ArtlioEdit, ArtlioClip } from "./timeline.js";

/** Frame size per aspect×resolution — mirrors the worker SIZES table
 *  (render.ts:39–43). The XML export uses the TRUE selected resolution (an NLE
 *  re-renders at full res; the 720p worker cap is render-only, EP4 Decision 4). */
const SIZES: Record<string, Record<string, [number, number]>> = {
  "16:9": { sd: [854, 480], hd: [1280, 720], "1080": [1920, 1080] },
  "9:16": { sd: [480, 854], hd: [720, 1280], "1080": [1080, 1920] },
  "1:1": { sd: [480, 480], hd: [720, 720], "1080": [1080, 1080] },
};

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const isAudioTrack = (clips: ArtlioClip[]) => clips.every((c) => c.asset.type === "audio");

/** Serialize an ArtlioEdit to FCP7 XML (xmeml v5) — imports into Premiere Pro and
 *  DaVinci Resolve. LOSSY by design (any NLE interchange is): between-clip
 *  transitions, audio ducking, and captions/overlays are DROPPED and listed in a
 *  top-of-file comment. Hard cuts + clip in/out/start/end (frame-accurate from
 *  trim/length/start × fps) + per-clip media references are preserved. Media is
 *  referenced by app-relative src in <pathurl>; the user re-links on import.
 *  Pure: no I/O, no spend. */
export function editToFcpXml(edit: ArtlioEdit, opts?: { sequenceName?: string }): string {
  const fps = edit.output.fps;
  const res = edit.output.resolution;
  const [width, height] = SIZES[edit.output.aspectRatio]?.[res] ?? [1280, 720];
  const name = xmlEscape(opts?.sequenceName ?? "Artlio cut");
  const sec = (s: number) => Math.round(s * fps); // seconds → frames

  const dropped: string[] = [];
  for (const t of edit.timeline.tracks) if ((t.transitions?.length ?? 0) > 0) { dropped.push("between-clip transitions"); break; }
  if (edit.timeline.tracks.some((t) => t.audioRole === "music")) dropped.push("audio ducking");
  // EP3 captions/overlays are top-level-on-timeline; drop them too if present
  const tl = edit.timeline as unknown as { captions?: unknown[]; textOverlays?: unknown[] };
  if ((tl.captions?.length ?? 0) > 0) dropped.push("captions");
  if ((tl.textOverlays?.length ?? 0) > 0) dropped.push("text overlays");

  let fileSeq = 0;
  const clipItem = (c: ArtlioClip, trackKind: "video" | "audio"): string => {
    const inF = sec(c.asset.trim ?? 0);
    const startF = sec(c.start);
    const lenF = sec(c.length);
    const fileId = `file-${fileSeq++}`;
    const path = xmlEscape(c.asset.src);
    const media =
      trackKind === "video"
        ? `<media><video><samplecharacteristics><width>${width}</width><height>${height}</height></samplecharacteristics></video></media>`
        : `<media><audio/></media>`;
    return [
      `<clipitem id="${fileId}-clip">`,
      `<name>${path.slice(path.lastIndexOf("/") + 1)}</name>`,
      `<rate><timebase>${fps}</timebase></rate>`,
      `<in>${inF}</in>`,
      `<out>${inF + lenF}</out>`,
      `<start>${startF}</start>`,
      `<end>${startF + lenF}</end>`,
      `<file id="${fileId}"><name>${path.slice(path.lastIndexOf("/") + 1)}</name><pathurl>${path}</pathurl><rate><timebase>${fps}</timebase></rate>${media}</file>`,
      `</clipitem>`,
    ].join("");
  };

  const visualTracks = edit.timeline.tracks.filter((t) => !isAudioTrack(t.clips));
  const audioTracks = edit.timeline.tracks.filter((t) => isAudioTrack(t.clips));
  const totalFrames = sec(
    Math.max(0, ...edit.timeline.tracks.flatMap((t) => t.clips.map((c) => c.start + c.length))),
  );

  const videoTrackXml = visualTracks
    .map((t) => `<track>${[...t.clips].sort((a, b) => a.start - b.start).map((c) => clipItem(c, "video")).join("")}</track>`)
    .join("");
  const audioTrackXml = audioTracks
    .map((t) => `<track>${[...t.clips].sort((a, b) => a.start - b.start).map((c) => clipItem(c, "audio")).join("")}</track>`)
    .join("");

  const comment =
    dropped.length > 0
      ? `<!-- Artlio FCP7 export (lossy): the following were DROPPED and must be re-created in the NLE: ${dropped.join(", ")}. Re-link media by filename on import. -->`
      : `<!-- Artlio FCP7 export (lossy interchange). Re-link media by filename on import. -->`;

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    comment,
    `<xmeml version="5">`,
    `<sequence>`,
    `<name>${name}</name>`,
    `<duration>${totalFrames}</duration>`,
    `<rate><timebase>${fps}</timebase></rate>`,
    `<media>`,
    `<video><format><samplecharacteristics><width>${width}</width><height>${height}</height><rate><timebase>${fps}</timebase></rate></samplecharacteristics></format>${videoTrackXml}</video>`,
    `<audio>${audioTrackXml}</audio>`,
    `</media>`,
    `</sequence>`,
    `</xmeml>`,
  ].join("\n");
}
