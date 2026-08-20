/**
 * editScheduledPost — $0 internal-write skill (debt-72, B4 block spec §五 5.2).
 *
 * Gate: cost:"free" + effect:"write" + reach:"internal" → needsApproval = false.
 *
 * FROZEN INVARIANT (debt-72): a MATERIAL edit (caption / media / channel / target / time) to an
 * already-approved (SCHEDULED) post revokes consent — it drops back to DRAFT with approvedAt cleared,
 * so the owner must re-approve before it re-enters the queue. This skill does NOT re-implement that
 * rule: it goes through ctx.schedule.update → the SAME updateScheduledPost server action, which owns
 * the re-consent gate. Single action layer — the invariant lives in exactly one place.
 *
 * Reaches the schedule ONLY via ctx.schedule.update (injected, owner-closed) — never Prisma directly.
 */
import type { RunContext } from "@openai/agents";
import { z } from "zod";
import { defineOttoSkill } from "../skill.js";
import type { OttoContext, ScheduleUpdatePatch } from "../context.js";

// Same STRICT instant shape the schedule validator enforces (UTC/offset ISO-8601, never naive local).
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

const params = z.object({
  scheduledPostId: z.string().min(1).describe("Id of the DRAFT/queued post to edit."),
  channel: z.enum(["instagram", "facebook"]).optional(),
  caption: z.string().min(1).max(2200).optional(),
  scheduledAt: z
    .string()
    .regex(ISO_INSTANT, "A UTC/offset ISO-8601 instant, e.g. 2026-07-10T09:00:00Z.")
    .optional(),
  scheduledTz: z.string().min(1).max(60).optional(),
  mediaGenerationIds: z.array(z.string().min(1)).max(10).optional(),
  firstComment: z.string().max(2200).nullable().optional(),
  metaTargetId: z.string().nullable().optional(),
});
type Input = z.infer<typeof params>;

export async function executeEditScheduledPost(
  input: Input,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<unknown> {
  const ctx = runContext.context as OttoContext;
  if (!ctx?.schedule?.update) return { error: "Scheduling isn't available right now." };

  // Only forward fields the user actually gave — an absent field means "leave it as is" (the shared
  // action treats `media: undefined` as untouched vs `media: []` as cleared). mediaGenerationIds maps
  // to the action's `media` patch key.
  const patch: ScheduleUpdatePatch = {};
  if (input.channel !== undefined) patch.channel = input.channel;
  if (input.caption !== undefined) patch.caption = input.caption;
  if (input.scheduledAt !== undefined) patch.scheduledAt = input.scheduledAt;
  if (input.scheduledTz !== undefined) patch.scheduledTz = input.scheduledTz;
  if (input.mediaGenerationIds !== undefined) patch.media = input.mediaGenerationIds;
  if (input.firstComment !== undefined) patch.firstComment = input.firstComment;
  if (input.metaTargetId !== undefined) patch.metaTargetId = input.metaTargetId;

  if (Object.keys(patch).length === 0) return { error: "Tell me what to change (caption, time, media, channel, or target)." };
  return ctx.schedule.update({ scheduledPostId: input.scheduledPostId, patch });
}

export const editScheduledPostSkill = defineOttoSkill({
  name: "editScheduledPost",
  cost: "free",
  effect: "write",
  reach: "internal",
  description:
    "Edit a DRAFT or queued scheduled post — change its caption, scheduled time (UTC/offset ISO-8601 " +
    "instant + IANA timezone), channel, attached media (mediaGenerationIds, already-generated ids in " +
    "carousel order), first comment, or target account. $0. Only send the fields you want to change. " +
    // #851 r2 — "before it can publish again" is the same promise as "will publish" in another word
    // form, and it slipped the fence because the fence only knew the "will" form. The fact it needs
    // to carry is the re-approval, not a send.
    "NOTE: a material edit to an already-approved post sends it back to DRAFT and it must be re-approved " +
    "before it holds its slot again — tell the user when that happens.",
  parameters: params,
  execute: executeEditScheduledPost,
});
