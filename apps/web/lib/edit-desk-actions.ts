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
 * Concurrency: writes go through an optimistic-concurrency loop pinned on Project.updatedAt
 * (the same discipline addSegmentToCut uses) — two tabs, or the merchant and Otto at once,
 * can't silently overwrite each other's cut.
 */
import { revalidatePath } from "next/cache";
import { prisma } from "@fikirtive/db";
import {
  fikirtiveEdit,
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
import { deskClipKind, deskClipLabel, deskClipSeconds, joinClips, summarizeCut, withCaptionsForClip, withMusic, withoutCaptions, withoutMusic, type CutSummary, type DeskClip, type DeskMedia } from "./edit-desk";
import { getTranscript, startRender } from "./actions";

type DeskView = { media: DeskMedia[]; cut: CutSummary };

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
    clips.push({
      src: storageKeyToSrc(storageKey(gen.asset.ownerId, gen.asset.contentHash, ext)),
      kind,
      seconds: deskClipSeconds(kind, gen.asset.durationS),
    });
  }
  return { clips };
}

/** Read-modify-write the saved cut under optimistic concurrency (D1 discipline).
 *  `mutate` is one of the pure functions in edit-desk.ts — it decides, this persists. */
async function mutateCut(
  ownerId: string,
  projectId: string,
  mutate: (base: FikirtiveEdit | null) => FikirtiveEdit | { error: string },
): Promise<{ ok: true; cut: CutSummary } | { error: string }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const project = await prisma.project.findFirst({ where: { id: projectId, ownerId, deletedAt: null } });
    if (!project) return { error: "Project not found." };
    const saved = project.editJson ? fikirtiveEdit.safeParse(project.editJson) : null;
    const next = mutate(saved?.success ? saved.data : null);
    if ("error" in next) return next;
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
    const saved = project.editJson ? fikirtiveEdit.safeParse(project.editJson) : null;
    return { media, cut: summarizeCut(saved?.success ? saved.data : null) };
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
    const out = await mutateCut(ownerId, projectId, (base) => joinClips(base, resolved.clips));
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
    if (!project.editJson) return { error: "There's no saved cut to export yet — put some clips together first." };
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
