/**
 * metaInsights — $0 external-read skill (G6b)
 *
 * Reads the owner's connected Meta (Facebook/Instagram) ad-account performance
 * (spend, reach, CTR, CPC, ROAS) so Otto can analyse and report on it.
 *
 * Gate: cost:"free" + effect:"read" + reach:"external" → needsApproval = false.
 *
 * The skill reaches Meta ONLY through ctx.metaInsights (the injected port). It never
 * imports meta-insights.ts or calls any API directly — ctx-port rule enforced.
 */
import type { RunContext } from "@openai/agents";
import { z } from "zod";
import { defineOttoSkill } from "../skill.js";
import type { OttoContext } from "../context.js";
import { MONEY_RULE } from "../money-rule.js";
import { isConnectionBlocked, metaNotConnectedMessage, ottoConnectionBlockedAnswer } from "../connection-copy.js";

const NOT_CONNECTED = metaNotConnectedMessage();
const META_UNREACHABLE =
  "I couldn't reach Meta just now — a temporary hiccup on Meta's side, not a connection problem. Try again in a moment.";

export const metaInsightsInput = z.object({
  datePreset: z
    .enum(["last_7d", "last_14d", "last_30d", "last_90d"])
    .default("last_30d")
    .describe("The reporting window for the ad performance numbers."),
});

type MetaInsightsInput = z.infer<typeof metaInsightsInput>;

// ---------------------------------------------------------------------------
// Execute function — exported for direct unit-testing (same pattern as research-web)
// ---------------------------------------------------------------------------

export async function executeMetaInsights(
  input: MetaInsightsInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<unknown> {
  const ctx = runContext.context as OttoContext;
  if (!ctx?.metaInsights) return { message: NOT_CONNECTED };
  const res = await ctx.metaInsights.get(input.datePreset);
  // #741 r5 P1: "connected but expired" is not "never connected" — ask the shared
  // authority first, so this skill cannot answer both with the same sentence.
  if (isConnectionBlocked(res)) return ottoConnectionBlockedAnswer(res);
  if ("notConnected" in res) return { message: NOT_CONNECTED };
  if ("transientError" in res) return { message: META_UNREACHABLE };
  if (res.accounts.length === 0) {
    return { message: "Meta is connected but no ad accounts returned data for this window." };
  }
  // #692 r3: the rule travels WITH the data, as text the model actually reads. The amounts in
  // `money` are already finished strings — there is nothing here to add up in the first place.
  return { datePreset: input.datePreset, moneyRule: MONEY_RULE, accounts: res.accounts };
}

// ---------------------------------------------------------------------------
// SDK tool definition
// ---------------------------------------------------------------------------

export const metaInsightsSkill = defineOttoSkill({
  name: "meta-insights",
  cost: "free",
  effect: "read",
  reach: "external",
  description:
    "Read the user's connected Meta (Facebook/Instagram) ad-account performance (spend, reach, CTR, CPC, ROAS) " +
    "so you can analyse it. Use this when the user asks about their ad performance or Meta results. " +
    MONEY_RULE +
    " Read-only — this is $0 and does not require approval.",
  parameters: metaInsightsInput,
  execute: executeMetaInsights,
});

export const metaInsights = metaInsightsSkill.tool;
