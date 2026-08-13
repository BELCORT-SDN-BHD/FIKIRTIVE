"use server";
/**
 * Edit-desk server actions (#780) — the ONE action layer behind both surfaces.
 *
 * The merchant's own edit desk (components/otto/edit/EditDesk.tsx) and Otto's assistance
 * path (lib/otto-media-port.ts → ctx.render) call exactly these functions. There is no
 * second implementation of "join", "captions" or "music" anywhere: the desk is a set of
 * buttons over this file, and Otto is a set of tool calls over the same file, which is why
 * "Otto, join these three and caption them" and doing it by hand land the same cut.
 *
 * $0 by construction. Joining, captioning and scoring a cut only rewrite Project.editJson;
 * the render itself is ffmpeg on our own machines and the transcript is whisper — no GenJob,
 * no reservation, no provider call, no price to look up. Nothing here touches the money path.
 *
 * Tenant scope: every export gates with requireOwner() and does its work inside runAsUser,
 * and every row it reads or writes is filtered by that resolved ownerId — never by anything
 * the caller passed. A clip is addressed only by its content-addressed `src`, so a forged
 * src is resolved against THIS owner + THIS project and simply isn't found.
 *
 * That covers what the DESK writes. It does NOT by itself cover what is already ON the row:
 * this file is not the only writer of Project.editJson (actions.ts `saveProjectEdit` takes
 * client-authored timeline JSON), so "the cut only contains this tenant's keys" is asserted
 * again on the way out — see mutateCut, and `startRender` + the render worker behind
 * exportSavedCut. The desk's own resolution is the first link in that chain, not the whole
 * of it (#780 r2b).
 *
 * Concurrency: writes go through an optimistic-concurrency loop pinned on Project.updatedAt
 * (the same discipline addSegmentToCut uses) — two tabs, or the merchant and Otto at once,
 * can't silently overwrite each other's cut.
 */
import { revalidatePath } from "next/cache";
import { prisma } from "@fikirtive/db";
import {
  foreignEditSrcs,
  FOREIGN_MEDIA_MESSAGE,
  keyOwnerMatches,
  newId,
  parseStorageKey,
  srcToStorageKey,
  storageKey,
  storageKeyToSrc,
  type FikirtiveEdit,
} from "@fikirtive/core";
import { requireOwner, resolveUserPrincipal } from "./auth-guard";
import { runAsUser } from "@fikirtive/db/principal";
import { deskClipKind, deskClipLabel, deskClipSeconds, joinClips, readSavedCut, summarizeCut, UNREADABLE_CUT_MESSAGE, withCaptionsForClip, withMusic, withoutCaptions, withoutMusic, type CutSummary, type DeskClip, type DeskMedia } from "./edit-desk";
import { getTranscript, startRender } from "./actions";

/** `unreadable` = there IS a saved cut and we could not read it. It is not the same as an empty
 *  cut and must never be shown as one: both surfaces say so, and every write refuses. */
type DeskView = { media: DeskMedia[]; cut: CutSummary; unreadable: boolean };

/** Resolve merchant-supplied srcs to media that really is theirs, in THIS project.
 *  Order is preserved — for a join, the order the merchant picked IS the edit. */
async function resolveDeskClips(
  ownerId: string,
  projectId: string,
  srcs: string[],
): Promise<{ clips: DeskClip[] } | { error: string }> {
  if (srcs.length === 0) return { error: "Pick at least one clip first." };
  const clips: DeskClip[] = [];
  for (const src of srcs) {
    let contentHash: string;
    try {
      const key = srcToStorageKey(src);
      // a src carries its owner in the key: another org's src never resolves here
      if (!keyOwnerMatches(key, ownerId)) return { error: "That clip isn't in your media." };
      contentHash = parseStorageKey(key).contentHash;
    } catch {
      return { error: "That clip isn't in your media." };
    }
    const gen = await prisma.generation.findFirst({
      where: { ownerId, projectId, deletedAt: null, asset: { contentHash, deletedAt: null } },
      include: { asset: true },
    });
    if (!gen) return { error: "That clip isn't in this project — add it here first." };
    const ext = gen.asset.ext.toLowerCase();
    const kind = deskClipKind(ext);
    if (!kind) return { error: "That file isn't something we can put in a video." };
    const seconds = deskClipSeconds(kind, gen.asset.durationS);
    // Only music gets here with no length (see UNKNOWN_CLIP_SECONDS). We refuse rather than
    // invent one: a made-up five seconds is written into the cut and stays there, so a song the
    // merchant just uploaded would sit under their video as five seconds forever.
    if (seconds === null) {
      return { error: "We're still working out how long that music is — give it a moment, then try again." };
    }
    clips.push({
      src: storageKeyToSrc(storageKey(gen.asset.ownerId, gen.asset.contentHash, ext)),
      kind,
      seconds,
    });
  }
  return { clips };
}

/** The music bed under this project's saved cut, resolved back to the MUSIC FILE's own length.
 *
 *  That length is the only thing that can lay a bed back out after the video grew — the saved
 *  clip carries the trimmed length, not the song. null when there is no bed, when the cut can't
 *  be read, or when the file's length still isn't known: in every one of those we leave the bed
 *  exactly as saved rather than guess at it. */
async function currentMusicBed(ownerId: string, projectId: string): Promise<DeskClip | null> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, ownerId, deletedAt: null },
    select: { editJson: true },
  });
  const saved = readSavedCut(project?.editJson ?? null);
  if (saved.state !== "cut") return null;
  const src = summarizeCut(saved.edit).music;
  if (!src) return null;
  const resolved = await resolveDeskClips(ownerId, projectId, [src]);
  return "error" in resolved ? null : (resolved.clips[0] ?? null);
}

/** Read-modify-write the saved cut under optimistic concurrency (D1 discipline).
 *  `mutate` is one of the pure functions in edit-desk.ts — it decides, this persists.
 *
 *  FAIL CLOSED on a cut we can't read: a saved-but-unreadable row used to arrive here as `null`,
 *  i.e. as "this video is empty", and the next join would then write over the very JSON nobody
 *  could read. Whatever is on that row is the merchant's work — we refuse the write and say so
 *  rather than replace an unknown with a blank. */
async function mutateCut(
  ownerId: string,
  projectId: string,
  mutate: (base: FikirtiveEdit | null) => FikirtiveEdit | { error: string },
): Promise<{ ok: true; cut: CutSummary } | { error: string }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const project = await prisma.project.findFirst({ where: { id: projectId, ownerId, deletedAt: null } });
    if (!project) return { error: "Project not found." };
    const saved = readSavedCut(project.editJson);
    if (saved.state === "unreadable") return { error: UNREADABLE_CUT_MESSAGE };
    const next = mutate(saved.state === "cut" ? saved.edit : null);
    if ("error" in next) return next;
    // Every clip the desk ADDS is resolved against this owner's own media (resolveDeskClips),
    // but the base is whatever is on the row — and a join keeps the audio tracks, so a music
    // bed pointing at another org's file (put there by a client writing editJson directly,
    // before that path was guarded) would ride through every desk edit and out the export.
    // Checked on the RESULT: taking the foreign bed off still saves, so the way out stays open.
    if (foreignEditSrcs(next, ownerId).length > 0) return { error: FOREIGN_MEDIA_MESSAGE };
    const res = await prisma.project.updateMany({
      where: { id: project.id, ownerId, updatedAt: project.updatedAt },
      data: { editJson: next },
    });
    if (res.count === 1) return { ok: true, cut: summarizeCut(next) };
    // someone else (the other tab, or Otto) saved between our read and write — retry on theirs
  }
  return { error: "This video changed while you were working on it — reload and try again." };
}

async function logDesk(ownerId: string, type: string, projectId: string, payload: object) {
  await prisma.actionEvent.create({ data: { id: newId(), ownerId, projectId, type, payload } });
}

/** What the desk opens with: this project's media, and the cut as it stands. */
export async function getEditDesk(projectId: string): Promise<DeskView | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<DeskView | { error: string }> => {
    const { ownerId } = gate;
    const project = await prisma.project.findFirst({ where: { id: projectId, ownerId, deletedAt: null } });
    if (!project) return { error: "Project not found." };
    const gens = await prisma.generation.findMany({
      where: { ownerId, projectId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: { asset: true },
    });
    const media: DeskMedia[] = [];
    for (const g of gens) {
      const ext = g.asset.ext.toLowerCase();
      const kind = deskClipKind(ext);
      if (!kind) continue;
      const src = storageKeyToSrc(storageKey(g.asset.ownerId, g.asset.contentHash, ext));
      if (media.some((m) => m.src === src)) continue; // same bytes twice = one clip to pick
      media.push({
        src,
        kind,
        seconds: deskClipSeconds(kind, g.asset.durationS),
        label: deskClipLabel(g.promptText ?? "", kind),
      });
    }
    const saved = readSavedCut(project.editJson);
    return {
      media,
      cut: summarizeCut(saved.state === "cut" ? saved.edit : null),
      unreadable: saved.state === "unreadable",
    };
  });
}

/** Join clips into one video, in the order given. */
export async function joinClipsIntoCut(
  projectId: string,
  srcs: string[],
): Promise<{ ok: true; cut: CutSummary } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<{ ok: true; cut: CutSummary } | { error: string }> => {
    const { ownerId } = gate;
    const resolved = await resolveDeskClips(ownerId, projectId, srcs);
    if ("error" in resolved) return resolved;
    // Read the bed BEFORE the write loop: joining is what changes the video's length, and the
    // music is promised under the whole of it.
    const bed = await currentMusicBed(ownerId, projectId);
    const out = await mutateCut(ownerId, projectId, (base) => {
      const joined = joinClips(base, resolved.clips);
      if ("error" in joined) return joined;
      // A longer video must get MORE music, not the leftover of the old trim — the join itself
      // can only shorten a bed, so the bed is laid out again from the music file's own length.
      // Skipped when another writer swapped the bed between our read and this attempt: we only
      // re-lay the bed we actually resolved.
      if (!bed || summarizeCut(base).music !== bed.src) return joined;
      const rescored = withMusic(joined, bed);
      return "error" in rescored ? joined : rescored;
    });
    if ("error" in out) return out;
    await logDesk(ownerId, "edit.join", projectId, { clips: resolved.clips.length, seconds: Math.round(out.cut.seconds) });
    revalidatePath("/", "layout");
    return out;
  });
}

/** Lay one audio file under the whole video (ducked under any voice by the renderer). */
export async function setCutMusic(
  projectId: string,
  src: string,
): Promise<{ ok: true; cut: CutSummary } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<{ ok: true; cut: CutSummary } | { error: string }> => {
    const { ownerId } = gate;
    const resolved = await resolveDeskClips(ownerId, projectId, [src]);
    if ("error" in resolved) return resolved;
    const music = resolved.clips[0];
    if (!music) return { error: "That clip isn't in this project — add it here first." };
    const out = await mutateCut(ownerId, projectId, (base) => withMusic(base, music));
    if ("error" in out) return out;
    await logDesk(ownerId, "edit.music.set", projectId, { seconds: Math.round(music.seconds) });
    revalidatePath("/", "layout");
    return out;
  });
}

/** Take the music back off. */
export async function clearCutMusic(projectId: string): Promise<{ ok: true; cut: CutSummary } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<{ ok: true; cut: CutSummary } | { error: string }> => {
    const { ownerId } = gate;
    const out = await mutateCut(ownerId, projectId, withoutMusic);
    if ("error" in out) return out;
    await logDesk(ownerId, "edit.music.clear", projectId, {});
    revalidatePath("/", "layout");
    return out;
  });
}

/** Put one clip's already-transcribed words on screen.
 *  The transcript itself is produced by the existing $0 caption job (startCaption →
 *  getTranscript); this only folds the finished cues into the cut at that clip's position. */
export async function addCaptionsToClip(
  projectId: string,
  src: string,
): Promise<{ ok: true; cut: CutSummary } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<{ ok: true; cut: CutSummary } | { error: string }> => {
    const { ownerId } = gate;
    const cues = await getTranscript(projectId, src);
    if (cues.length === 0) {
      return { error: "There are no words for that clip yet — add captions to it first, then put them on the video." };
    }
    const out = await mutateCut(ownerId, projectId, (base) => withCaptionsForClip(base, src, cues));
    if ("error" in out) return out;
    await logDesk(ownerId, "edit.captions.add", projectId, { cues: cues.length, total: out.cut.captionCount });
    revalidatePath("/", "layout");
    return out;
  });
}

/** Export the SAVED video to a finished file.
 *
 *  Neither surface holds timeline JSON — the desk works in clips and Otto works in words — so
 *  the cut being rendered is read here, server-side, from the row both surfaces have been
 *  writing. That is what makes "export renders what you saved" true by construction rather
 *  than by two clients remembering to send the same thing. */
export async function exportSavedCut(projectId: string): Promise<{ id: string } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<{ id: string } | { error: string }> => {
    const { ownerId } = gate;
    const project = await prisma.project.findFirst({
      where: { id: projectId, ownerId, deletedAt: null },
      select: { editJson: true },
    });
    if (!project) return { error: "Project not found." };
    const saved = readSavedCut(project.editJson);
    // Same three states as everywhere else: nothing saved is not the same as saved-and-unreadable,
    // and neither one may be rendered as if it were an empty video.
    if (saved.state === "empty") return { error: "There's no saved cut to export yet — put some clips together first." };
    if (saved.state === "unreadable") return { error: UNREADABLE_CUT_MESSAGE };
    return startRender(projectId, JSON.stringify(project.editJson));
  });
}

/** Take every caption back off the video. */
export async function clearCutCaptions(projectId: string): Promise<{ ok: true; cut: CutSummary } | { error: string }> {
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<{ ok: true; cut: CutSummary } | { error: string }> => {
    const { ownerId } = gate;
    const out = await mutateCut(ownerId, projectId, withoutCaptions);
    if ("error" in out) return out;
    await logDesk(ownerId, "edit.captions.clear", projectId, {});
    revalidatePath("/", "layout");
    return out;
  });
}
