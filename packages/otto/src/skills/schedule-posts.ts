/**
 * schedulePosts — $0 skill (Schedule UI-first slice, block C).
 *
 * Drafts OTTO-proposed IG/FB posts: creates ScheduledPost rows (status DRAFT, source "otto",
 * approvedAt NULL, metaTargetId NULL) plus ordered ScheduledPostMedia rows for reused,
 * already-paid Generation media. Spends NO money, creates NO GenJob, NEVER publishes.
 * It DRAFTS ONLY — the owner approves each post/batch later (approvedAt = consent to publish),
 * and the real publish worker is slice 2. Identity (ownerId/projectId) comes from ctx, never
 * the model. Persists via direct prisma the same way _brand-record.ts does (the CI fence only
 * blocks @fikirtive/generation + reserveCredits; prisma is allowed for internal $0 writes).
 */
import { defineOttoSkill } from "../skill.js";
import type { RunContext } from "@openai/agents";
import { z } from "zod";
import { newId } from "@fikirtive/core";
import { prisma } from "@fikirtive/db";
import type { OttoContext } from "../context.js";

const post = z.object({
  channel: z.enum(["instagram", "facebook"]),
  caption: z.string().min(1).max(2200),
  // UTC instant the post should publish at, ISO-8601 (e.g. "2026-07-10T09:00:00Z").
  scheduledAt: z.string().min(1),
  // IANA time zone the user picked (e.g. "Asia/Kuala_Lumpur"), stored alongside UTC.
  scheduledTz: z.string().min(1).max(60),
  // Ids of ALREADY-generated media (canvas / My Stuff) to reuse in carousel order. Never regenerated.
  mediaGenerationIds: z.array(z.string().min(1)).max(10).optional(),
  firstComment: z.string().max(2200).optional(),
});

const params = z.object({
  posts: z.array(post).min(1).max(30),
});

type SchedulePostsInput = z.infer<typeof params>;

export async function executeSchedulePosts(
  input: SchedulePostsInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<{ ok: true; draftedIds: string[] }> {
  if (!runContext) throw new Error("OttoContext required");
  const ctx = runContext.context as OttoContext;

  const draftedIds: string[] = [];
  for (const p of input.posts) {
    const id = newId();
    // DRAFTS ONLY: status DRAFT, source "otto", approvedAt/metaTargetId/metaPostId NULL.
    // Never sets approvedAt, never advances status, never publishes, never spends.
    await prisma.scheduledPost.create({
      data: {
        id,
        ownerId: ctx.orgId, // from ctx — never a client-supplied owner
        projectId: ctx.projectId,
        channel: p.channel,
        metaTargetId: null,
        caption: p.caption,
        firstComment: p.firstComment ?? null,
        scheduledAt: new Date(p.scheduledAt),
        scheduledTz: p.scheduledTz,
        status: "DRAFT",
        publishMode: "AUTO",
        source: "otto",
        approvedAt: null,
        media: p.mediaGenerationIds?.length
          ? {
              create: p.mediaGenerationIds.map((generationId, position) => ({
                id: newId(),
                generationId,
                position,
              })),
            }
          : undefined,
      },
    });
    draftedIds.push(id);
  }

  return { ok: true, draftedIds };
}

export const schedulePostsSkill = defineOttoSkill({
  name: "schedulePosts",
  cost: "free",
  effect: "write",
  reach: "internal",
  description:
    "Draft one or more Instagram/Facebook posts onto the user's schedule as DRAFTS for them to review — " +
    "nothing is published until the user approves. $0. Use when the user asks you to plan/schedule content " +
    "(e.g. 'post 3 times a week', 'draft next week's posts'). For each post give channel ('instagram' or 'facebook'), " +
    "a caption, scheduledAt (UTC ISO-8601 instant, e.g. '2026-07-10T09:00:00Z'), and scheduledTz (the user's IANA time " +
    "zone, e.g. 'Asia/Kuala_Lumpur'). Optionally attach mediaGenerationIds — ids of ALREADY-generated media from the " +
    "user's canvas / My Stuff, in carousel order (never generate new media here). Optionally add a firstComment. " +
    "Base captions on brand memory / the user's input; if you lack something, ask — do not invent it.",
  parameters: params,
  execute: executeSchedulePosts,
});

export const schedulePosts = schedulePostsSkill.tool;
