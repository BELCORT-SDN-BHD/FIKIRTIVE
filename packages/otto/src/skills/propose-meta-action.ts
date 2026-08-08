/**
 * proposeMetaAction — $0 write skill (G7)
 *
 * Thin ungated wrapper that calls ctx.metaPropose(input) and returns a friendly message.
 * ALL build/persist/money logic lives in the web port (apps/web/lib/meta-propose.ts).
 *
 * Gate: cost:"free" + effect:"write" + reach:"internal" → needsApproval = false.
 *
 * This skill MUST NOT import meta-graph, prisma, or any web code — enforced by
 * scripts/check-skill-imports.sh (CI fence).
 */
import type { RunContext } from "@openai/agents";
import { z } from "zod";
import { defineOttoSkill } from "../skill.js";
import type { OttoContext } from "../context.js";
import { isConnectionBlocked, ottoConnectionBlockedAnswer } from "../connection-copy.js";

const NOT_CONNECTED =
  "Meta isn't connected yet. Ask the user to open Connections and connect Instagram or Facebook, then try again.";
const META_UNREACHABLE =
  "I couldn't reach Meta just now — a temporary hiccup on Meta's side, not a connection problem. Try again in a moment.";

export const proposeMetaActionInput = z.object({
  planTitle: z.string().describe("Short title summarising the plan (e.g. 'Pause underperforming ad sets')."),
  steps: z
    .array(
      z.object({
        op: z
          .enum(["pause", "resume", "set_budget", "reschedule"])
          .describe("The operation to perform on the target ad object."),
        targetId: z.string().describe("The Meta ad object id (campaign, ad set, or ad) to act on."),
        intent: z
          .object({
            dailyBudgetMinor: z
              .number()
              .optional()
              .describe("New daily budget in minor currency units (e.g. cents). Required for set_budget."),
            startTime: z
              .string()
              .optional()
              .describe("New start time ISO-8601. For reschedule only."),
            endTime: z
              .string()
              .optional()
              .describe("New end time ISO-8601. For reschedule only."),
          })
          .describe("The intended new values. Only include the fields relevant to the op."),
      }),
    )
    .min(1)
    .describe("One or more steps in the action plan."),
});

type ProposeMetaActionInput = z.infer<typeof proposeMetaActionInput>;

// ---------------------------------------------------------------------------
// Execute function — exported for direct unit-testing
// ---------------------------------------------------------------------------

export async function executeProposeMetaAction(
  input: ProposeMetaActionInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<unknown> {
  const ctx = runContext.context as OttoContext;
  if (!ctx?.metaPropose) return { message: NOT_CONNECTED };

  const res = await ctx.metaPropose(input);

  // #741 r5 P1: "connected but expired" is not "never connected" — ask the shared
  // authority first, so this skill cannot answer both with the same sentence.
  if (isConnectionBlocked(res)) return ottoConnectionBlockedAnswer(res);
  if ("notConnected" in res) {
    return { message: NOT_CONNECTED };
  }

  if ("transientError" in res) {
    return { message: META_UNREACHABLE };
  }

  if ("unknownTargets" in res) {
    const ids = res.unknownTargets.join(", ");
    return {
      message: `I couldn't find the following ad objects in your Meta account: ${ids}. Please use meta-list-objects to get valid ids and try again.`,
    };
  }

  if ("invalidSteps" in res) {
    // A set_budget step was rejected (money-safety): either no positive amount was given, or the
    // target isn't a daily-budget object (an ad, or a lifetime-budget campaign/ad set).
    const needsAmount = res.invalidSteps.some((s) => s.reason === "missing-amount");
    const wrongTarget = res.invalidSteps.some((s) => s.reason === "not-a-daily-budget-object");
    const parts: string[] = [];
    if (needsAmount) parts.push("I need a positive daily budget amount to change that ad set's budget.");
    if (wrongTarget) parts.push("I can't set a daily budget on that object — it isn't a daily-budget ad set or campaign.");
    return { message: parts.join(" ") || "I couldn't set a budget on one of those targets." };
  }

  return {
    message: `Plan "${input.planTitle}" prepared and ready for review (card id: ${res.cardId}).${res.autoEligible ? " This plan is eligible for auto-execution." : ""}`,
    cardId: res.cardId,
    autoEligible: res.autoEligible,
  };
}

// ---------------------------------------------------------------------------
// SDK tool definition
// ---------------------------------------------------------------------------

export const proposeMetaActionSkill = defineOttoSkill({
  name: "propose-meta-action",
  cost: "free",
  effect: "write",
  reach: "internal",
  description:
    "Build a Meta ad action plan (ACTION_CARD) the user can review and confirm. " +
    "Use this when the user wants to pause, resume, adjust budgets, or reschedule Meta campaigns, ad sets, or ads. " +
    "Provide a short planTitle and a list of steps (op, targetId, intent). Server builds the full plan with enriched metadata. " +
    "Always call meta-list-objects first to get valid targetIds. This is $0 and ungated.",
  parameters: proposeMetaActionInput,
  execute: executeProposeMetaAction,
});

export const proposeMetaAction = proposeMetaActionSkill.tool;
