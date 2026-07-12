/**
 * approveScheduledPost — GATED external-write skill (debt-70, B4 block spec §五 5.1).
 *
 * Gate: cost:"free" + effect:"write" + reach:"external" → deriveNeedsApproval = TRUE.
 * This is MACHINE-derived (skill.ts:66 — `effect === "write" && reach === "external"`), not
 * a hand-annotated flag, so Otto can never turn it off or route around it. Every call therefore
 * PARKS as an approval interruption and executes NOTHING until a human confirms the approval card.
 *
 * Why this is not "Otto self-approves" (闸不失义):
 *   - The human clicking the card IS the consent (Meta policy 1.7 "explicit consent") — the SAME
 *     act as pressing Approve in the schedule UI.
 *   - On resume, execute() runs the SAME owner-scoped approveScheduledPost server action the human
 *     button uses (owner CAS + state machine + media check). Otto gets the hand to RAISE the
 *     request, never the power to grant it.
 *
 * Reaches the schedule ONLY via ctx.schedule.approve (injected, owner-closed) — never Prisma /
 * schedule-service directly (single-action-layer rule, same as the draft port).
 */
import type { RunContext } from "@openai/agents";
import { z } from "zod";
import { defineOttoSkill } from "../skill.js";
import type { OttoContext } from "../context.js";

const params = z.object({
  scheduledPostId: z.string().min(1).describe("Id of the DRAFT scheduled post the user wants to approve for publishing."),
});
type Input = z.infer<typeof params>;

export async function executeApproveScheduledPost(
  input: Input,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<unknown> {
  const ctx = runContext.context as OttoContext;
  if (!ctx?.schedule?.approve) return { error: "Scheduling isn't available right now." };
  return ctx.schedule.approve({ scheduledPostId: input.scheduledPostId });
}

export const approveScheduledPostSkill = defineOttoSkill({
  name: "approveScheduledPost",
  cost: "free",
  effect: "write",
  reach: "external",
  description:
    "Approve a DRAFT scheduled post so it can publish to Instagram/Facebook at its scheduled time. " +
    "Approving is consent to a real, irreversible external publish, so this ALWAYS needs the user's " +
    "explicit approval — you propose it on their behalf and they confirm on the approval card. Use only " +
    "when the user asks you to approve/publish a specific post they have already reviewed. Give the " +
    "scheduledPostId. Nothing publishes until the user confirms.",
  parameters: params,
  execute: executeApproveScheduledPost,
});

export const approveScheduledPost = approveScheduledPostSkill.tool;
