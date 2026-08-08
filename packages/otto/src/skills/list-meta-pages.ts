/**
 * listMetaPages — $0 external-read skill (G7 v2)
 *
 * Lists the owner's connected Facebook Pages so Otto can pick one when building an ad.
 *
 * Gate: cost:"free" + effect:"read" + reach:"external" → needsApproval = false.
 *
 * The skill reaches Meta ONLY through ctx.metaPages (the injected port). It never
 * imports meta-pages.ts or calls any API directly — ctx-port rule enforced.
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

// #741 r5 P1 — this skill was the second mouth the judge named: it reads the SAME fetchOwnerPages
// the Schedule screen does, and answered `needsReconnect` with NOT_CONNECTED. A merchant whose Meta
// connection merely expired was told by Otto that they had never connected, while the Connections
// page in front of them said "Reconnect needed". The blocked states now come from the shared
// helper (../connection-copy.js → @fikirtive/core), which every other Meta skill also runs.

const listMetaPagesInput = z.object({});

type ListMetaPagesInput = z.infer<typeof listMetaPagesInput>;

// ---------------------------------------------------------------------------
// Execute function — exported for direct unit-testing (same pattern as meta-list-objects)
// ---------------------------------------------------------------------------

export async function executeListMetaPages(
  _input: ListMetaPagesInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<unknown> {
  const ctx = runContext.context as OttoContext;
  if (!ctx?.metaPages) return { message: NOT_CONNECTED };
  const res = await ctx.metaPages.list();
  if ("pages" in res) return { pages: res.pages };
  if (isConnectionBlocked(res)) return ottoConnectionBlockedAnswer(res);
  if ("transientError" in res) return { message: META_UNREACHABLE };
  return { message: NOT_CONNECTED };
}

// ---------------------------------------------------------------------------
// SDK tool definition
// ---------------------------------------------------------------------------

export const listMetaPagesSkill = defineOttoSkill({
  name: "list-meta-pages",
  cost: "free",
  effect: "read",
  reach: "external",
  description:
    "List the user's connected Facebook Pages so you can pick one when building an ad. " +
    "Use this when the user wants to create or target a Facebook ad post to a specific Page. " +
    "Read-only — this is $0 and does not require approval.",
  parameters: listMetaPagesInput,
  execute: executeListMetaPages,
});

export const listMetaPages = listMetaPagesSkill.tool;
