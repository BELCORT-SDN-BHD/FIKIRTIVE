/**
 * cancelScheduledPost — $0 internal-write skill (debt-71, B4 block spec §五 5.2).
 *
 * Gate: cost:"free" + effect:"write" + reach:"internal" → needsApproval = false (cancelling is
 * not an external write; it only moves an OWNED post to CANCELLED through the shared state machine).
 *
 * Reaches the schedule ONLY via ctx.schedule.cancel (injected, owner-closed) — the SAME owner-scoped
 * cancelScheduledPost server action the human uses (state-machine gate: a terminal post cannot cancel).
 */
import type { RunContext } from "@openai/agents";
import { z } from "zod";
import { ottoPublishTruth } from "@fikirtive/core/schedule-draft";
import { defineOttoSkill } from "../skill.js";
import type { OttoContext } from "../context.js";

const params = z.object({
  scheduledPostId: z.string().min(1).describe("Id of the scheduled post to cancel."),
});
type Input = z.infer<typeof params>;

export async function executeCancelScheduledPost(
  input: Input,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<unknown> {
  const ctx = runContext.context as OttoContext;
  if (!ctx?.schedule?.cancel) return { error: "Scheduling isn't available right now." };
  return ctx.schedule.cancel({ scheduledPostId: input.scheduledPostId });
}

export const cancelScheduledPostSkill = defineOttoSkill({
  name: "cancelScheduledPost",
  cost: "free",
  effect: "write",
  reach: "internal",
  description:
    "Cancel a scheduled post so it will not publish. $0 and reversible only by re-creating the post. " +
    "Use when the user asks you to call off / remove a specific scheduled or draft post. Give the " +
    "scheduledPostId. A post already marked as published, or in the middle of that move, cannot be cancelled. " +
    `${ottoPublishTruth()}`,
  parameters: params,
  execute: executeCancelScheduledPost,
});
