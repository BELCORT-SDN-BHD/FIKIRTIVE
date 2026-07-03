"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@fikirtive/db";
import { newId, canTransition, type ScheduledPostStatus } from "@fikirtive/core";
import { requireOwner } from "./auth-guard";
import { fetchOwnerPages } from "./meta-pages";
import { channelRegistry } from "./channels/registry";
import type { ChannelId } from "./channels/types";

// Channels this slice supports — code-validated (mirrors the ScheduledPost.channel comment),
// not a PG enum. IG/FB only until App Review adds more.
const CHANNELS = ["instagram", "facebook"] as const;
type ScheduleChannel = (typeof CHANNELS)[number];

export type CreateScheduledPostInput = {
  channel: ScheduleChannel;
  caption: string;
  scheduledAt: string;   // UTC ISO-8601 instant
  scheduledTz: string;   // IANA tz (e.g. "Asia/Kuala_Lumpur")
  media?: string[];      // ids of ALREADY-generated media, carousel order — never regenerated ($0)
  firstComment?: string;
  metaTargetId?: string; // connected IG business / FB page id (validated at approve-time)
};

export type UpdateScheduledPostPatch = {
  caption?: string;
  scheduledAt?: string;
  scheduledTz?: string;
  firstComment?: string | null;
  metaTargetId?: string | null;
};

export type ScheduledPostRow = {
  id: string;
  channel: string;
  caption: string;
  firstComment: string | null;
  scheduledAt: Date;
  scheduledTz: string;
  status: string;
  publishMode: string;
  source: string;
  metaTargetId: string | null;
  approvedAt: Date | null;
  media: { generationId: string; position: number }[];
  updatedAt: Date;
};

const LIST_SELECT = {
  id: true, channel: true, caption: true, firstComment: true,
  scheduledAt: true, scheduledTz: true, status: true, publishMode: true,
  source: true, metaTargetId: true, approvedAt: true, updatedAt: true,
  media: { select: { generationId: true, position: true }, orderBy: { position: "asc" } },
} as const;

function toDate(v: string): Date | null {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Create an owner-scoped DRAFT (spec §四B Composer "Save Draft"). $0 — media reuses
 *  already-paid Generation rows, never regenerates, never publishes. approvedAt stays
 *  null (no consent yet); metaTargetId is validated later, at approve-time. */
export async function createScheduledPost(
  input: CreateScheduledPostInput,
): Promise<{ ok: true; id: string } | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;

  const channel = (input?.channel ?? "") as ScheduleChannel;
  if (!CHANNELS.includes(channel)) return { error: "Pick a supported channel." };
  const caption = typeof input?.caption === "string" ? input.caption.trim() : "";
  if (!caption) return { error: "A post needs a caption." };
  const scheduledAt = typeof input?.scheduledAt === "string" ? toDate(input.scheduledAt) : null;
  if (!scheduledAt) return { error: "Pick a valid date and time." };
  const scheduledTz = typeof input?.scheduledTz === "string" ? input.scheduledTz.trim() : "";
  if (!scheduledTz) return { error: "Pick a time zone." };
  const media = Array.isArray(input?.media) ? input.media.filter((m) => typeof m === "string" && m) : [];
  if (media.length > 10) return { error: "A carousel can have at most 10 items." };
  const firstComment = typeof input?.firstComment === "string" && input.firstComment.trim() ? input.firstComment : null;
  const metaTargetId = typeof input?.metaTargetId === "string" && input.metaTargetId ? input.metaTargetId : null;

  // Cross-tenant media guard: every media id must be a Generation the SESSION owner owns
  // (never trust the client). A foreign id here would persist another org's asset onto this
  // post — reject the create outright rather than silently drop, so the owner picks again.
  if (media.length) {
    const owned = await prisma.generation.findMany({
      where: { id: { in: media }, ownerId: gate.ownerId, deletedAt: null },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((g) => g.id));
    if (media.some((id) => !ownedIds.has(id))) return { error: "Some selected media isn't yours." };
  }

  try {
    const id = newId();
    await prisma.scheduledPost.create({
      data: {
        id,
        ownerId: gate.ownerId, // from the SESSION — client-supplied owner ids are ignored
        projectId: gate.ownerId, // no per-project scoping in this slice; scope by org
        channel,
        metaTargetId,
        caption,
        firstComment,
        scheduledAt,
        scheduledTz,
        status: "DRAFT",
        publishMode: "AUTO",
        source: "owner",
        approvedAt: null,
        media: media.length
          ? { create: media.map((generationId, position) => ({ id: newId(), generationId, position })) }
          : undefined,
      },
    });
    revalidatePath("/", "layout");
    return { ok: true, id };
  } catch {
    return { error: "Couldn't save that — please try again." };
  }
}

/** Patch a DRAFT/queued post — ONLY if it belongs to the session owner. The owner scope +
 *  deletedAt:null live in the updateMany WHERE, so a forged id touching another owner's row
 *  matches zero rows → "not found". */
export async function updateScheduledPost(
  id: string,
  patch: UpdateScheduledPostPatch,
): Promise<{ ok: true } | { error: string }> {
  if (typeof id !== "string" || !id) return { error: "Invalid request." };
  const gate = await requireOwner();
  if ("error" in gate) return gate;

  const data: Record<string, unknown> = {};
  // A MATERIAL edit changes what would be published (caption/scheduledAt/firstComment/metaTargetId).
  // scheduledTz alone is a display detail, not material. Tracked so an edit to an already-approved
  // (SCHEDULED) post can revoke consent below — approval = consent to publish (spec §五).
  let material = false;
  if (patch?.caption !== undefined) {
    const c = typeof patch.caption === "string" ? patch.caption.trim() : "";
    if (!c) return { error: "A post needs a caption." };
    data.caption = c;
    material = true;
  }
  if (patch?.scheduledAt !== undefined) {
    const d = typeof patch.scheduledAt === "string" ? toDate(patch.scheduledAt) : null;
    if (!d) return { error: "Pick a valid date and time." };
    data.scheduledAt = d;
    material = true;
  }
  if (patch?.scheduledTz !== undefined) {
    const tz = typeof patch.scheduledTz === "string" ? patch.scheduledTz.trim() : "";
    if (!tz) return { error: "Pick a time zone." };
    data.scheduledTz = tz;
  }
  if (patch?.firstComment !== undefined) {
    data.firstComment = typeof patch.firstComment === "string" && patch.firstComment.trim() ? patch.firstComment : null;
    material = true;
  }
  if (patch?.metaTargetId !== undefined) {
    data.metaTargetId = typeof patch.metaTargetId === "string" && patch.metaTargetId ? patch.metaTargetId : null;
    material = true;
  }
  if (Object.keys(data).length === 0) return { error: "Nothing to update." };

  // Re-consent gate: a material edit to an approved (SCHEDULED) post revokes its approval —
  // it drops back to DRAFT with approvedAt cleared, so the owner must re-approve before it
  // re-enters the publish queue. Edits stay allowed; they just require fresh consent.
  if (material) {
    const current = await prisma.scheduledPost.findFirst({
      where: { id, ownerId: gate.ownerId, deletedAt: null },
      select: { status: true },
    });
    if (!current) return { error: "Post not found." };
    if (current.status === "SCHEDULED") {
      data.status = "DRAFT";
      data.approvedAt = null;
    }
  }

  try {
    const { count } = await prisma.scheduledPost.updateMany({
      where: { id, ownerId: gate.ownerId, deletedAt: null },
      data,
    });
    if (!count) return { error: "Post not found." };
  } catch {
    return { error: "Couldn't save that — please try again." };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Approve = consent to publish (spec §五). Requires: a non-null metaTargetId that BELONGS to
 *  the owner's own connected channels, AND at least one media row. Gates DRAFT→SCHEDULED through
 *  the shared state machine. Sets approvedAt. Owner-scoped end to end — the target is validated
 *  against fetchOwnerPages(ownerId) (which reads the owner's OWN MetaConnection), never a client
 *  id, so one org can never queue a post onto another org's page. */
export async function approveScheduledPost(id: string): Promise<{ ok: true } | { error: string }> {
  if (typeof id !== "string" || !id) return { error: "Invalid request." };
  const gate = await requireOwner();
  if ("error" in gate) return gate;

  const post = await prisma.scheduledPost.findFirst({
    where: { id, ownerId: gate.ownerId, deletedAt: null },
    select: { id: true, status: true, metaTargetId: true, media: { select: { id: true }, take: 1 } },
  });
  if (!post) return { error: "Post not found." };

  // State-machine gate: only a legal transition into SCHEDULED may proceed.
  if (!canTransition(post.status as ScheduledPostStatus, "SCHEDULED")) {
    return { error: "This post can't be approved from its current state." };
  }
  // Consent needs a resolved target that the owner actually owns.
  if (!post.metaTargetId) return { error: "Pick which account to post to before approving." };
  if (!post.media.length) return { error: "Add at least one image or video before approving." };

  const pages = await fetchOwnerPages(gate.ownerId);
  if (!("pages" in pages)) return { error: "Connect your account before approving." };
  if (!pages.pages.some((p) => p.id === post.metaTargetId)) {
    return { error: "That account isn't one of your connected channels." };
  }

  try {
    const { count } = await prisma.scheduledPost.updateMany({
      where: { id, ownerId: gate.ownerId, deletedAt: null },
      data: { status: "SCHEDULED", approvedAt: new Date() },
    });
    if (!count) return { error: "Post not found." };
  } catch {
    return { error: "Couldn't approve that — please try again." };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Cancel (owner-scoped). Gates the transition through the shared state machine — a terminal
 *  post (PUBLISHED/CANCELLED) can't be cancelled. */
export async function cancelScheduledPost(id: string): Promise<{ ok: true } | { error: string }> {
  if (typeof id !== "string" || !id) return { error: "Invalid request." };
  const gate = await requireOwner();
  if ("error" in gate) return gate;

  const post = await prisma.scheduledPost.findFirst({
    where: { id, ownerId: gate.ownerId, deletedAt: null },
    select: { id: true, status: true },
  });
  if (!post) return { error: "Post not found." };
  if (!canTransition(post.status as ScheduledPostStatus, "CANCELLED")) {
    return { error: "This post can't be cancelled from its current state." };
  }

  try {
    const { count } = await prisma.scheduledPost.updateMany({
      where: { id, ownerId: gate.ownerId, deletedAt: null },
      data: { status: "CANCELLED" },
    });
    if (!count) return { error: "Post not found." };
  } catch {
    return { error: "Couldn't cancel that — please try again." };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Owner-scoped list feeding the Schedule views (Plan+Queue / calendar / queue). Excludes
 *  soft-deleted rows, ordered by scheduledAt. An optional [from,to] window filters scheduledAt. */
export async function listScheduledPosts(
  range?: { from?: string; to?: string },
): Promise<ScheduledPostRow[]> {
  const gate = await requireOwner();
  if ("error" in gate) return [];

  const where: Record<string, unknown> = { ownerId: gate.ownerId, deletedAt: null };
  const from = typeof range?.from === "string" ? toDate(range.from) : null;
  const to = typeof range?.to === "string" ? toDate(range.to) : null;
  if (from || to) {
    where.scheduledAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  }

  const rows = await prisma.scheduledPost.findMany({
    where,
    orderBy: { scheduledAt: "asc" },
    select: LIST_SELECT,
  });
  return rows as unknown as ScheduledPostRow[];
}

export type OwnerTarget = { id: string; name: string; channel: ChannelId };

/** Owner-scoped list of connectable publish targets for the composer's account picker.
 *  Derives from the owner's OWN connected pages (fetchOwnerPages(gate.ownerId), the same
 *  owner-scoped source the approve path validates against) and cross-joins with each
 *  supported channel via the registry. $0 read. Returns [] (never throws) when the owner
 *  isn't connected / needs a reconnect / needs the page scope, so the UI shows a Connect
 *  prompt instead of an error. */
export async function listOwnerTargets(): Promise<OwnerTarget[]> {
  const gate = await requireOwner();
  if ("error" in gate) return [];

  const out: OwnerTarget[] = [];
  for (const channel of Object.values(channelRegistry)) {
    const targets = await channel.listTargets(gate.ownerId);
    for (const t of targets) out.push({ id: t.id, name: t.name, channel: channel.id });
  }
  return out;
}
