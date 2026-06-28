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

const NOT_CONNECTED =
  "Meta isn't connected yet. Ask the user to open Connections and click Connect Meta, then try again.";

const NEEDS_PAGE_SCOPE =
  "Reconnect Meta and allow Page access so I can build ads.";

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
  if ("notConnected" in res || "needsReconnect" in res) return { message: NOT_CONNECTED };
  if ("needsPageScope" in res) return { message: NEEDS_PAGE_SCOPE };
  return { pages: res.pages };
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
