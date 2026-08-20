/**
 * listScheduledPosts — $0 internal-read skill (debt-73, B4 block spec §五 5.2; 宪法 7 "读的对等").
 *
 * Gate: cost:"free" + effect:"read" + reach:"internal" → needsApproval = false.
 *
 * Lets Otto SEE the same schedule queue the human sees, so it can talk truthfully about what is
 * drafted / scheduled / needs attention. Reaches the schedule ONLY via ctx.schedule.list (injected,
 * owner-closed, owner-scoped) — never Prisma directly (B9 read-parity port rule).
 */
import type { RunContext } from "@openai/agents";
import { z } from "zod";
import { ottoPublishTruth } from "@fikirtive/core/schedule-draft";
import { defineOttoSkill } from "../skill.js";
import type { OttoContext } from "../context.js";

const params = z.object({
  from: z.string().optional().describe("Optional ISO date/instant lower bound on scheduledAt."),
  to: z.string().optional().describe("Optional ISO date/instant upper bound on scheduledAt."),
});
type Input = z.infer<typeof params>;

export async function executeListScheduledPosts(
  input: Input,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<unknown> {
  const ctx = runContext.context as OttoContext;
  if (!ctx?.schedule?.list) return { error: "Scheduling isn't available right now." };
  const posts = await ctx.schedule.list({ from: input.from, to: input.to });
  return { posts };
}

export const listScheduledPostsSkill = defineOttoSkill({
  name: "listScheduledPosts",
  cost: "free",
  effect: "read",
  reach: "internal",
  description:
    "List the user's scheduled posts (drafts, queued, published, needs-attention) so you can see the " +
    "same schedule they do and answer questions about it. $0 read-only. Optionally pass from/to (ISO) " +
    "to window by scheduled time. Use before editing/approving/cancelling so you reference the right post id. " +
    `${ottoPublishTruth()}`,
  parameters: params,
  execute: executeListScheduledPosts,
});
