/**
 * metaListObjects — $0 external-read skill (G7)
 *
 * Lists the owner's connected Meta (Facebook/Instagram) ad objects
 * (campaigns, ad sets, ads) so Otto can propose changes to them.
 *
 * Gate: cost:"free" + effect:"read" + reach:"external" → needsApproval = false.
 *
 * The skill reaches Meta ONLY through ctx.metaAds (the injected port). It never
 * imports meta-objects.ts or calls any API directly — ctx-port rule enforced.
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

const metaListObjectsInput = z.object({});

type MetaListObjectsInput = z.infer<typeof metaListObjectsInput>;

// ---------------------------------------------------------------------------
// Execute function — exported for direct unit-testing (same pattern as meta-insights)
// ---------------------------------------------------------------------------

export async function executeMetaListObjects(
  _input: MetaListObjectsInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<unknown> {
  const ctx = runContext.context as OttoContext;
  if (!ctx?.metaAds) return { message: NOT_CONNECTED };
  const res = await ctx.metaAds.list();
  // #741 r5 P1: "connected but expired" is not "never connected" — ask the shared
  // authority first, so this skill cannot answer both with the same sentence.
  if (isConnectionBlocked(res)) return ottoConnectionBlockedAnswer(res);
  if ("notConnected" in res) return { message: NOT_CONNECTED };
  if ("transientError" in res) return { message: META_UNREACHABLE };
  return { objects: res.objects };
}

// ---------------------------------------------------------------------------
// SDK tool definition
// ---------------------------------------------------------------------------

export const metaListObjectsSkill = defineOttoSkill({
  name: "meta-list-objects",
  cost: "free",
  effect: "read",
  reach: "external",
  description:
    "List the user's connected Meta (Facebook/Instagram) ad objects " +
    "(campaigns, ad sets, ads) so you can understand what's running. " +
    "Use this when the user asks about their campaigns or wants to make changes to ads. " +
    "Read-only — this is $0 and does not require approval.",
  parameters: metaListObjectsInput,
  execute: executeMetaListObjects,
});

export const metaListObjects = metaListObjectsSkill.tool;
