"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@fikirtive/db";
import {
  canTransition,
  isValidScheduleTimeZone,
  isScheduleChannel,
  newId,
  parseScheduleInstant,
  scheduleApproveBlockers,
  ACCOUNTS_UNREADABLE_ERROR,
  SCHEDULE_CHANNEL_CAPS,
  type ConnectionBlocker,
  type ScheduledPostStatus,
} from "@fikirtive/core";
import { requireOwner } from "./auth-guard";
import { isImpersonating } from "@/lib/better-auth/compat";
import { draftScheduledPost, IG_IMAGE_ONLY_ERROR } from "./schedule-service";
import { channelRegistry } from "./channels/registry";
import type { ChannelId, ChannelTargetsResult } from "./channels/types";
import { signSharePreviewToken } from "@fikirtive/token-crypto";
import { sharePreviewTokenDigest } from "./share-preview";
import { settlePendingApprovalCards } from "./approval-card-settle";

// F15 / L1: staff impersonating a customer must never MUTATE that customer's schedule — approve in
// particular consents to a real, IRREVERSIBLE external publish on the tenant's behalf, forging their
// consent (spec §五). Impersonation is for SEEING what they see, not acting as them; reads stay open.
// Same guard + string as the money-safety spend paths (meta-write-actions.ts approveMetaActionPlan).
const IMPERSONATION_BLOCK = "Paused while impersonating a customer — exit impersonation to do this.";

// Statuses whose CONTENT the owner may still edit. DRAFT is freely editable; a material edit to an
// approved (SCHEDULED) post revokes consent (drops to DRAFT). Everything else (PUBLISHING / terminal
// PUBLISHED·CANCELLED / FAILED / NEEDS_ATTENTION) is content-frozen server-side — the UI is not the guard.
const EDITABLE_STATUSES = new Set<ScheduledPostStatus>(["DRAFT", "SCHEDULED"]);

export type CreateScheduledPostInput = {
  channel: string; // channel id; validated server-side (isScheduleChannel / validateScheduleDraft)
  caption: string;
  scheduledAt: string;   // UTC ISO-8601 instant
  scheduledTz: string;   // IANA tz (e.g. "Asia/Kuala_Lumpur")
  media?: string[];      // ids of ALREADY-generated media, carousel order — never regenerated ($0)
  firstComment?: string;
  metaTargetId?: string; // connected IG business / FB page id (validated at approve-time)
};

export type UpdateScheduledPostPatch = {
  channel?: string;
  caption?: string;
  scheduledAt?: string;
  scheduledTz?: string;
  media?: string[];
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
  // Why a post NEEDS_ATTENTION / last FAILED (set by the publish worker's six-state). Read-only
  // disclosure so a stuck post isn't a silent dead-end in the composer.
  lastError: string | null;
  media: { generationId: string; position: number }[];
  updatedAt: Date;
};

const LIST_SELECT = {
  id: true, channel: true, caption: true, firstComment: true,
  scheduledAt: true, scheduledTz: true, status: true, publishMode: true,
  source: true, metaTargetId: true, approvedAt: true, lastError: true, updatedAt: true,
  media: { select: { generationId: true, position: true }, orderBy: { position: "asc" } },
} as const;

function toDate(v: string): Date | null {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Create an owner-scoped DRAFT (spec §四B Composer "Save Draft"). $0 — media reuses
 *  already-paid Generation rows, never regenerates, never publishes. approvedAt stays
 *  null (no consent yet); metaTargetId is validated later, at approve-time.
 *
 *  Single write authority: this and the Otto skill both go through draftScheduledPost
 *  (shared core validation + owner-scoped media check). projectId scopes by org in this slice. */
export async function createScheduledPost(
  input: CreateScheduledPostInput,
): Promise<{ ok: true; id: string } | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (await isImpersonating()) return { error: IMPERSONATION_BLOCK };

  const res = await draftScheduledPost({
    ownerId: gate.ownerId, // from the SESSION — client-supplied owner ids are ignored
    projectId: gate.ownerId, // no per-project scoping in this slice; scope by org
    source: "owner",
    input: {
      channel: input?.channel,
      caption: input?.caption,
      scheduledAt: input?.scheduledAt,
      scheduledTz: input?.scheduledTz,
      media: input?.media,
      firstComment: input?.firstComment ?? null,
      metaTargetId: input?.metaTargetId ?? null,
    },
  });
  if ("ok" in res) revalidatePath("/", "layout");
  return res;
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
  if (await isImpersonating()) return { error: IMPERSONATION_BLOCK };

  // Read the current row FIRST: status gates editability (server-side, not just the UI), and
  // channel gates first-comment capability. A terminal / publishing / failed row is content-frozen.
  const current = await prisma.scheduledPost.findFirst({
    where: { id, ownerId: gate.ownerId, deletedAt: null },
    select: { status: true, channel: true, firstComment: true, updatedAt: true, media: { select: { generationId: true } } },
  });
  if (!current) return { error: "Post not found." };
  if (!EDITABLE_STATUSES.has(current.status as ScheduledPostStatus)) {
    return { error: "This post can no longer be edited." };
  }

  const data: Record<string, unknown> = {};
  const nextChannel = patch?.channel !== undefined ? patch.channel : current.channel;
  if (!isScheduleChannel(nextChannel)) return { error: "Pick a supported channel." };
  const caps = SCHEDULE_CHANNEL_CAPS[nextChannel];
  // A MATERIAL edit changes what would be published (caption/scheduledAt/firstComment/metaTargetId).
  // scheduledTz alone is a display detail, not material. Channel/media edits are material too.
  // Tracked so an edit to an already-approved (SCHEDULED) post can revoke consent below —
  // approval = consent to publish (spec §五).
  let material = false;
  if (patch?.channel !== undefined) {
    const existingMediaCount = current.media?.length ?? 0;
    if (patch?.media === undefined && existingMediaCount > caps.maxMediaCount) {
      return {
        error:
          caps.maxMediaCount === 1
            ? `${caps.label} supports a single image or video, not a carousel.`
            : `A carousel can have at most ${caps.maxMediaCount} items.`,
      };
    }
    data.channel = nextChannel;
    material = true;
    // Moving an Instagram draft to Facebook must not leave an impossible first comment behind.
    if (!caps.supportsFirstComment && current.firstComment) data.firstComment = null;
  }
  if (patch?.caption !== undefined) {
    const c = typeof patch.caption === "string" ? patch.caption.trim() : "";
    if (!c) return { error: "A post needs a caption." };
    data.caption = c;
    material = true;
  }
  if (patch?.scheduledAt !== undefined) {
    const d = typeof patch.scheduledAt === "string" ? parseScheduleInstant(patch.scheduledAt.trim()) : null;
    if (!d) return { error: "Pick a valid date and time (include a UTC offset)." };
    data.scheduledAt = d;
    material = true;
  }
  if (patch?.scheduledTz !== undefined) {
    const tz = typeof patch.scheduledTz === "string" ? patch.scheduledTz.trim() : "";
    if (!isValidScheduleTimeZone(tz)) return { error: "Pick a valid time zone." };
    data.scheduledTz = tz;
  }
  if (patch?.firstComment !== undefined) {
    const fc = typeof patch.firstComment === "string" && patch.firstComment.trim() ? patch.firstComment : null;
    // Channel capability (shared server enforcement): only channels that support a first comment
    // may carry a non-empty one — the UI hides the field, but this action is a callable boundary.
    if (fc && !caps.supportsFirstComment) {
      return { error: "This channel doesn't support a first comment." };
    }
    data.firstComment = fc;
    material = true;
  }
  let nextMedia: string[] | null = null;
  if (patch?.media !== undefined) {
    nextMedia = Array.isArray(patch.media) ? patch.media.filter((m) => typeof m === "string" && m) : [];
    if (nextMedia.length > caps.maxMediaCount) {
      return {
        error:
          caps.maxMediaCount === 1
            ? `${caps.label} supports a single image or video, not a carousel.`
            : `A carousel can have at most ${caps.maxMediaCount} items.`,
      };
    }
    if (nextMedia.length) {
      const owned = await prisma.generation.findMany({
        where: { id: { in: nextMedia }, ownerId: gate.ownerId, deletedAt: null },
        select: { id: true, asset: { select: { mime: true } } },
      });
      const ownedById = new Map(owned.map((g) => [g.id, g]));
      if (nextMedia.some((mediaId) => !ownedById.has(mediaId))) return { error: "Some selected media isn't yours." };
      // Same judgment as draftScheduledPost / approveScheduledPost (#229): a media swap must not
      // leave a non-image attached to an Instagram post — this callable boundary is a real gate,
      // not just the composer's affordance.
      if (nextChannel === "instagram" && nextMedia.some((mediaId) => !ownedById.get(mediaId)!.asset.mime.startsWith("image/"))) {
        return { error: IG_IMAGE_ONLY_ERROR };
      }
    }
    material = true;
  } else if (nextChannel === "instagram" && patch?.channel !== undefined && current.media?.length) {
    // Switching an existing draft's channel TO instagram without touching media: media that was
    // fine for its old channel may not be image-only — check the same contract here too, not just
    // at approve-time.
    const existingIds = current.media.map((m) => m.generationId);
    const owned = await prisma.generation.findMany({
      where: { id: { in: existingIds }, ownerId: gate.ownerId, deletedAt: null },
      select: { id: true, asset: { select: { mime: true } } },
    });
    const ownedById = new Map(owned.map((g) => [g.id, g]));
    // Fail closed, same as the media-swap path above: an attached id missing from the owner-scoped
    // read (foreign, or since soft-deleted) must not silently skip the mime check.
    if (existingIds.some((mediaId) => !ownedById.has(mediaId))) return { error: "Some selected media isn't yours." };
    if (existingIds.some((mediaId) => !ownedById.get(mediaId)!.asset.mime.startsWith("image/"))) {
      return { error: IG_IMAGE_ONLY_ERROR };
    }
  }
  if (patch?.metaTargetId !== undefined) {
    data.metaTargetId = typeof patch.metaTargetId === "string" && patch.metaTargetId ? patch.metaTargetId : null;
    material = true;
  }
  if (Object.keys(data).length === 0 && nextMedia === null) return { error: "Nothing to update." };

  // Re-consent gate: a material edit to an approved (SCHEDULED) post revokes its approval — it drops
  // back to DRAFT with approvedAt cleared, so the owner must re-approve before it re-enters the queue.
  if (material && current.status === "SCHEDULED") {
    data.status = "DRAFT";
    data.approvedAt = null;
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Atomic: the WHERE pins the status AND updatedAt we validated against (same posture as
      // approveScheduledPost's CAS) — a concurrent approve/cancel/edit that moved the row out from
      // under us (incl. a media-only swap, which bumps updatedAt without changing status) matches
      // zero rows → conflict, never a silent clobber of a channel switch validated against stale media.
      const { count } = await tx.scheduledPost.updateMany({
        where: { id, ownerId: gate.ownerId, deletedAt: null, status: current.status, updatedAt: current.updatedAt },
        data: Object.keys(data).length ? data : { updatedAt: new Date() },
      });
      if (!count) throw new Error("stale");
      if (nextMedia !== null) {
        await tx.scheduledPostMedia.deleteMany({ where: { scheduledPostId: id } });
        if (nextMedia.length) {
          await tx.scheduledPostMedia.createMany({
            data: nextMedia.map((generationId, position) => ({ id: newId(), scheduledPostId: id, generationId, position })),
          });
        }
      }
    });
  } catch (e) {
    if (e instanceof Error && e.message === "stale") return { error: "This post just changed — please refresh and try again." };
    return { error: "Couldn't save that — please try again." };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Approve = consent to publish (spec §五). Requires: a non-null metaTargetId that BELONGS to
 *  the owner's own connected channels, AND at least one media row. Gates DRAFT→SCHEDULED through
 *  the shared state machine. Sets approvedAt. Owner-scoped end to end — the target is validated
 *  against fetchOwnerPages(ownerId) (which reads the owner's OWN MetaConnection), never a client
 *  id, so one org can never queue a post onto another org's page.
 *
 *  `opts.expectedUpdatedAt` (AR2 处方1, Otto approval-card chain ONLY): the post's updatedAt as
 *  captured server-side when the card's content hash was verified. When provided, the CAS WHERE
 *  pins THIS value instead of this call's own fresh read — so a material edit between the hash
 *  check and this re-read makes the CAS match zero rows: the old card can never approve content B.
 *  The human UI path passes no opts and keeps the existing fresh-read CAS unchanged. */
export async function approveScheduledPost(
  id: string,
  opts?: { expectedUpdatedAt?: string },
): Promise<{ ok: true } | { error: string }> {
  if (typeof id !== "string" || !id) return { error: "Invalid request." };
  let expectedUpdatedAt: Date | null = null;
  if (opts?.expectedUpdatedAt !== undefined) {
    const d = new Date(opts.expectedUpdatedAt);
    if (typeof opts.expectedUpdatedAt !== "string" || Number.isNaN(d.getTime())) {
      return { error: "Invalid request." };
    }
    expectedUpdatedAt = d;
  }
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  // Approve = consent to a real, irreversible external publish (spec §五). An impersonating admin
  // must NOT forge the tenant's consent — refuse BEFORE any Meta target lookup or DB write.
  if (await isImpersonating()) return { error: IMPERSONATION_BLOCK };

  const post = await prisma.scheduledPost.findFirst({
    where: { id, ownerId: gate.ownerId, deletedAt: null },
    select: {
      id: true, status: true, channel: true, metaTargetId: true, updatedAt: true,
      media: { select: { generationId: true } },
    },
  });
  if (!post) return { error: "Post not found." };

  // State-machine gate: only a legal transition into SCHEDULED may proceed.
  if (!canTransition(post.status as ScheduledPostStatus, "SCHEDULED")) {
    return { error: "This post can't be approved from its current state." };
  }
  // D2 — a post with an UNCONFIRMED publish attempt may already be LIVE (a prior ambiguous publish
  // crossed Meta's side-effect point but its receipt was lost, so metaPostId was never stamped).
  // Re-approving it would re-arm scanDue and risk a SECOND live post. Refuse until a person confirms;
  // cancelling (NEEDS_ATTENTION→CANCELLED) stays available, so this is not a dead end.
  const unconfirmed = await prisma.publishAttempt.findFirst({
    where: { scheduledPostId: id, state: "UNCONFIRMED" },
    select: { id: true },
  });
  if (unconfirmed) {
    return { error: "This post may already be live — please review it before publishing again." };
  }
  // Consent needs a resolved target the owner actually owns, and (outside text-only channels) at
  // least one media row. Both conditions AND both sentences come from the shared pure rule so the
  // composer's "Approve & schedule" button can gate and EXPLAIN itself with the same truth (#695).
  // The live connection list isn't read yet at this point — that costs a Graph call, so it stays
  // where it always was (below, after the cheap checks). Passing no `connectedTargetIds` says
  // exactly that: "not looked at yet", never "nothing connected".
  const approveBlockers = scheduleApproveBlockers({
    channel: post.channel,
    targetId: post.metaTargetId,
    mediaCount: post.media.length,
  });
  if (approveBlockers.length > 0) return { error: approveBlockers[0]! };
  if (!isScheduleChannel(post.channel)) return { error: "Pick a supported channel." };
  const caps = SCHEDULE_CHANNEL_CAPS[post.channel];
  if (post.media.length > caps.maxMediaCount) {
    return {
      error:
        caps.maxMediaCount === 1
          ? `${caps.label} supports a single image or video, not a carousel.`
          : `A carousel can have at most ${caps.maxMediaCount} items.`,
    };
  }
  const mediaIds = post.media.map((m) => m.generationId).filter((m): m is string => typeof m === "string" && m.length > 0);
  if (mediaIds.length !== post.media.length) return { error: "Some selected media isn't yours." };
  const ownedMedia = await prisma.generation.findMany({
    where: { id: { in: mediaIds }, ownerId: gate.ownerId, deletedAt: null },
    select: { id: true, asset: { select: { mime: true } } },
  });
  const ownedMediaIds = new Set(ownedMedia.map((m) => m.id));
  if (mediaIds.some((mediaId) => !ownedMediaIds.has(mediaId))) {
    return { error: "Some selected media isn't yours." };
  }
  // Same judgment as draftScheduledPost / the worker's #229 last-gate guard: Asset.mime
  // image/* whitelist. Stopping it here (approve = consent to publish) beats only catching it
  // at publish-time.
  if (post.channel === "instagram" && ownedMedia.some((m) => !m.asset.mime.startsWith("image/"))) {
    return { error: IG_IMAGE_ONLY_ERROR };
  }

  // The live connection re-read: the stored metaTargetId is only what the draft REMEMBERS, and a
  // merchant who disconnected still carries it. Same rule object as above, now with the real list —
  // so this stage's two refusals are the same sentences the composer shows in advance (#741 r1 P1),
  // and the order (nothing connected → that account isn't yours) is unchanged. No adapter means
  // nothing can be connected on this channel, which is exactly the empty-list case.
  const adapter = channelRegistry[post.channel];
  const liveTargets: ChannelTargetsResult = adapter
    ? await adapter.listTargets(gate.ownerId)
    : { targets: [] };
  // #741 r3/r5 P1: a read that FAILED is not an empty list, and a connection that can't publish
  // right now is not a connection that was never made. All three outcomes refuse (unchanged — we
  // never approve a publish we couldn't validate), but the reason has to be true. The blocked case
  // goes through the SAME shared rule as everything else, so the sentence the merchant heard in
  // advance is byte-for-byte the one they get here.
  if ("unavailable" in liveTargets) return { error: ACCOUNTS_UNREADABLE_ERROR };
  const liveTargetBlockers = scheduleApproveBlockers({
    channel: post.channel,
    targetId: post.metaTargetId,
    mediaCount: post.media.length,
    connectedTargetIds: "blocked" in liveTargets ? [] : liveTargets.targets.map((t) => t.id),
    connectionBlocker: "blocked" in liveTargets ? liveTargets.blocked : null,
  });
  if (liveTargetBlockers.length > 0) return { error: liveTargetBlockers[0]! };

  try {
    // Atomic transition: pin the status we read + validated (post.status) AND updatedAt in the
    // WHERE. status alone isn't enough — a concurrent updateScheduledPost can swap this DRAFT's
    // media (or channel/metaTargetId) without changing status, which would let approval sail through
    // on the media/mime snapshot we validated above instead of what's actually attached now. Pinning
    // updatedAt (bumped by any edit, incl. a media-only one — see updateScheduledPost) closes that:
    // count===0 → stale/conflict, so we never approve content we didn't just validate, and never
    // resurrect a CANCELLED post into SCHEDULED either (the read-then-write race).
    // Otto card chain (expectedUpdatedAt set): pin the HASH-TIME snapshot instead of this call's
    // fresh read — welds the hash check and the approve into one version (AR2 处方1).
    const { count } = await prisma.scheduledPost.updateMany({
      where: {
        id,
        ownerId: gate.ownerId,
        deletedAt: null,
        status: post.status,
        updatedAt: expectedUpdatedAt ?? post.updatedAt,
      },
      data: { status: "SCHEDULED", approvedAt: new Date() },
    });
    if (!count) {
      return {
        error: expectedUpdatedAt
          ? "This post changed since Otto asked — review it and ask Otto to request approval again."
          : "This post just changed — please refresh and try again.",
      };
    }
  } catch {
    return { error: "Couldn't approve that — please try again." };
  }
  // B0-29 one-approval-object weld (NODE-275 收口4): the human Approve button settles any PENDING
  // Otto APPROVAL_CARD ask for this post — both surfaces consume the SAME request object. On the
  // Otto card path the card was already CAS-consumed by ottoApprove BEFORE this action ran (this
  // finds none — no-op). Best-effort by design: the approval above already happened, and
  // ottoApprove's "ask gone but post approved" branch answers a stale card benignly regardless.
  try {
    await settlePendingApprovalCards({
      ownerId: gate.ownerId,
      toolName: "approveScheduledPost",
      ref: id,
      status: "approved",
    });
  } catch (err) {
    console.warn(`[schedule] settling pending approval cards failed (post=${id}).`, err);
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
  if (await isImpersonating()) return { error: IMPERSONATION_BLOCK };

  const post = await prisma.scheduledPost.findFirst({
    where: { id, ownerId: gate.ownerId, deletedAt: null },
    select: { id: true, status: true },
  });
  if (!post) return { error: "Post not found." };
  if (!canTransition(post.status as ScheduledPostStatus, "CANCELLED")) {
    return { error: "This post can't be cancelled from its current state." };
  }

  try {
    // Atomic transition: pin the read status so a concurrent publish/approve can't be clobbered.
    const { count } = await prisma.scheduledPost.updateMany({
      where: { id, ownerId: gate.ownerId, deletedAt: null, status: post.status },
      data: { status: "CANCELLED" },
    });
    if (!count) return { error: "This post just changed — please refresh and try again." };
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

/** What this cycle's read found for one channel. "ok" ⇒ the targets below are its whole truth. */
export type ChannelReadState = "ok" | "unreadable" | ConnectionBlocker;

/**
 * The answer is PER CHANNEL (#741 r5 P1). r4 failed the whole read whenever any single channel
 * couldn't be read, on the reasoning that a partial list reads downstream as "that channel has
 * nothing connected". The premise was right; the remedy was too blunt — one channel having a bad
 * day would blank the entire Schedule screen, including channels that answered perfectly well.
 * Carrying the per-channel state fixes both: a channel that wasn't read contributes no targets AND
 * is labelled, so no consumer can mistake its silence for an empty answer.
 */
export type OwnerTargetsResult = {
  /** Only from channels whose state is "ok". */
  targets: OwnerTarget[];
  /** Keyed by channel id. A channel absent from this map was never read — treat it as unreadable. */
  channelStates: Record<string, ChannelReadState>;
};

/** Owner-scoped list of connectable publish targets for the composer's account picker.
 *  Derives from the owner's OWN connected pages (fetchOwnerPages(gate.ownerId), the same
 *  owner-scoped source the approve path validates against) and cross-joins with each
 *  supported channel via the registry. $0 read.
 *
 *  Never throws and never omits a channel silently: an adapter that rejects is recorded as
 *  "unreadable" for that channel alone. */
export async function listOwnerTargets(): Promise<OwnerTargetsResult> {
  const gate = await requireOwner();
  // No session: we looked at nothing, so we claim nothing. An empty channelStates map reads as
  // "unread" everywhere downstream — never as "this merchant has no connected accounts".
  if ("error" in gate) return { targets: [], channelStates: {} };

  const out: OwnerTarget[] = [];
  const channelStates: Record<string, ChannelReadState> = {};
  for (const channel of Object.values(channelRegistry)) {
    const res: ChannelTargetsResult = await channel
      .listTargets(gate.ownerId)
      .catch(() => ({ unavailable: true }) as const);
    if ("unavailable" in res) {
      channelStates[channel.id] = "unreadable";
      continue;
    }
    if ("blocked" in res) {
      channelStates[channel.id] = res.blocked;
      continue;
    }
    channelStates[channel.id] = "ok";
    for (const t of res.targets) out.push({ id: t.id, name: t.name, channel: channel.id });
  }
  return { targets: out, channelStates };
}

export type PostingTimeSuggestion = { dayOfWeek: number; hourUtc: number; score: number; rationale: string };

/** B0-103: cold-start posting-time suggestions for a channel, read from the STATIC global seed table
 *  (PostingTimeSeed — NOT owner-scoped; the same craft knowledge for everyone), ordered best-first.
 *  Requires an authenticated caller (auth ≠ tenant scope — the data itself is global) but returns []
 *  for anyone unauthed. $0 read-only, no write path. Feeds both the composer's time picker and Otto's
 *  suggestPostTimes skill (via ctx.schedule.suggestTimes). */
export async function suggestPostTimes(
  input: { channel: string; limit?: number },
): Promise<PostingTimeSuggestion[]> {
  const channel = typeof input?.channel === "string" ? input.channel : "";
  if (!channel) return [];
  const gate = await requireOwner();
  if ("error" in gate) return [];
  const take = typeof input?.limit === "number" && input.limit > 0 ? Math.min(Math.floor(input.limit), 20) : 6;
  const rows = await prisma.postingTimeSeed.findMany({
    where: { channel },
    orderBy: [{ score: "desc" }, { dayOfWeek: "asc" }, { hourUtc: "asc" }],
    take,
    select: { dayOfWeek: true, hourUtc: true, score: true, rationale: true },
  });
  return rows;
}

export type SharePreviewResult = { token: string; url: string; expiresAt: string } | { error: string };

// How long a share-preview link stays valid — SERVER-FIXED (NODE-275 收口3): callers cannot pass a
// TTL, so no over-long or non-finite expiry can ever be minted. Frozen default: 7 days
// (founder ack 可调 — one-place constant).
const SHARE_PREVIEW_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** B0-28: mint a SEAT-LESS, read-only share link for ONE of the caller's OWN scheduled posts.
 *  Two layers (NODE-275 收口2, spec §2.2 "内部写一行 token 记录"):
 *   - TRANSPORT: an HMAC (ownerId+postId+exp) token — nothing is written to any external platform
 *     (internal write). Tampered/expired → verify null → the read route's fail-closed 404.
 *   - AUTHORITY: one SharePreviewToken ROW per mint (audit), storing SHA-256(token) — revocable via
 *     revokeSharePreview; verify = HMAC valid ∧ row live (apps/web/lib/share-preview.ts).
 *  Fail-closed: no SHARE_PREVIEW_SECRET → error before any DB read; a post the caller doesn't own →
 *  "Post not found." The link's target page (schedule/share-preview) lands with the A′ foundation. $0. */
export async function sharePostPreview(
  input: { scheduledPostId: string },
): Promise<SharePreviewResult> {
  const id = typeof input?.scheduledPostId === "string" ? input.scheduledPostId : "";
  if (!id) return { error: "Invalid request." };
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (await isImpersonating()) return { error: IMPERSONATION_BLOCK };

  const secret = process.env.SHARE_PREVIEW_SECRET ?? "";
  if (!secret) return { error: "Sharing isn't set up on this server yet." };

  const post = await prisma.scheduledPost.findFirst({
    where: { id, ownerId: gate.ownerId, deletedAt: null },
    select: { id: true },
  });
  if (!post) return { error: "Post not found." };

  const expMs = Date.now() + SHARE_PREVIEW_TTL_MS;
  const token = signSharePreviewToken(gate.ownerId, post.id, expMs, secret);
  try {
    // The AUTHORITY row — without it the token verifies to null (row-live check), so a failed
    // write means NO working link is handed out (fail-closed, not fail-open).
    await prisma.sharePreviewToken.create({
      data: {
        id: newId(),
        ownerId: gate.ownerId,
        scheduledPostId: post.id,
        tokenDigest: sharePreviewTokenDigest(token),
        expiresAt: new Date(expMs),
      },
    });
  } catch {
    return { error: "Couldn't create that link — please try again." };
  }
  const base = process.env.BETTER_AUTH_URL ?? "";
  return {
    token,
    url: `${base}/schedule/share-preview?t=${encodeURIComponent(token)}`,
    expiresAt: new Date(expMs).toISOString(),
  };
}

/** B0-28: revoke every ACTIVE share link for one of the caller's OWN posts (owner-scoped, $0).
 *  Sets revokedAt on all live rows; a revoked row fails the verify's row-live check, so already-
 *  shared links die immediately (the HMAC alone no longer grants access — row is the authority). */
export async function revokeSharePreview(
  input: { scheduledPostId: string },
): Promise<{ ok: true; revoked: number } | { error: string }> {
  const id = typeof input?.scheduledPostId === "string" ? input.scheduledPostId : "";
  if (!id) return { error: "Invalid request." };
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (await isImpersonating()) return { error: IMPERSONATION_BLOCK };

  const { count } = await prisma.sharePreviewToken.updateMany({
    where: { ownerId: gate.ownerId, scheduledPostId: id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return { ok: true, revoked: count };
}
