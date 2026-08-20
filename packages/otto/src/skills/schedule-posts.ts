/**
 * schedulePosts — $0 skill (Schedule UI-first slice, block C).
 *
 * Drafts OTTO-proposed IG/FB posts as DRAFTS for the owner to review — nothing is published until
 * the owner approves. Spends NO money, creates NO GenJob, NEVER publishes.
 *
 * Single write authority (#123): each post goes through the injected `ctx.schedule.draft` port —
 * the SAME server function (draftScheduledPost) the human createScheduledPost action uses. So
 * validation (channel caps / caption / STRICT datetime + IANA timezone) and the owner-scoped media
 * check live in ONE place; this skill no longer touches Prisma or re-implements validation.
 * A post the shared path rejects (bad datetime, foreign media, channel-cap violation) is reported
 * per-post — the batch drafts the valid posts instead of hard-failing on one bad entry.
 */
import { navLabel } from "@fikirtive/core";
import { ottoPublishTruth } from "@fikirtive/core/schedule-draft";
import { defineOttoSkill } from "../skill.js";
import type { RunContext } from "@openai/agents";
import { z } from "zod";
import type { OttoContext } from "../context.js";

// UTC/offset ISO-8601 instant, e.g. "2026-07-10T09:00:00Z". A regex (version-stable across zod)
// gives the model an early, clear constraint; the shared server validator re-checks before writing.
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

const post = z.object({
  channel: z.enum(["instagram", "facebook", "x"]),
  caption: z.string().min(1).max(2200),
  scheduledAt: z
    .string()
    .regex(ISO_INSTANT, "A UTC/offset ISO-8601 instant, e.g. 2026-07-10T09:00:00Z (never a naive local time)."),
  // IANA time zone the user picked (e.g. "Asia/Kuala_Lumpur"); the server validates it via Intl.
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
): Promise<
  | { ok: true; draftedIds: string[]; failures: { index: number; error: string }[] }
  | { ok: false; error: string }
> {
  if (!runContext) throw new Error("OttoContext required");
  const ctx = runContext.context as OttoContext;
  if (!ctx.schedule) {
    return { ok: false, error: "Scheduling isn't available right now." };
  }

  const draftedIds: string[] = [];
  const failures: { index: number; error: string }[] = [];
  for (let i = 0; i < input.posts.length; i++) {
    const p = input.posts[i]!;
    const res = await ctx.schedule.draft({
      channel: p.channel,
      caption: p.caption,
      scheduledAt: p.scheduledAt,
      scheduledTz: p.scheduledTz,
      media: p.mediaGenerationIds,
      firstComment: p.firstComment ?? null,
      // metaTargetId stays null — the owner picks the target when they approve (consent step).
    });
    if ("error" in res) failures.push({ index: i, error: res.error });
    else draftedIds.push(res.id);
  }

  return { ok: true, draftedIds, failures };
}

export const schedulePostsSkill = defineOttoSkill({
  name: "schedulePosts",
  cost: "free",
  effect: "write",
  reach: "internal",
  description:
    "Draft one or more Instagram/Facebook/X posts onto the user's schedule as DRAFTS for them to review. " +
    // #851 — the same sentence the Schedule screen and the approval card show, from one authority.
    `${ottoPublishTruth()} ` +
    "$0. Use when the user asks you to plan/schedule content " +
    "(e.g. 'post 3 times a week', 'draft next week's posts'). For each post give channel ('instagram', 'facebook', or 'x'), " +
    "a caption, scheduledAt (UTC/offset ISO-8601 instant, e.g. '2026-07-10T09:00:00Z'), and scheduledTz (the user's IANA time " +
    "zone, e.g. 'Asia/Kuala_Lumpur'). Optionally attach mediaGenerationIds — ids of ALREADY-generated media from the " +
    `user's canvas / ${navLabel("library")}, in carousel order (never generate new media here; Facebook takes a single item). ` +
    "Optionally add a firstComment (Instagram only). Base captions on brand memory / the user's input; if you lack " +
    "something, ask — do not invent it. Any post the schedule rejects (bad time, media that isn't the user's) comes " +
    "back in `failures` with a reason; relay it and offer to fix.",
  parameters: params,
  execute: executeSchedulePosts,
});
