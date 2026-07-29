/**
 * listChannelScopes — $0 internal-read skill (#495/#500 parity; 宪法 7 "读的对等").
 *
 * Gate: cost:"free" + effect:"read" + reach:"internal" → needsApproval = false.
 *
 * Lists the workspace's connected messaging channel accounts (channel + scope key) — the SAME
 * owner-scoped rows the Inbox templates page and broadcast composer show a human. Reaches the
 * data ONLY via ctx.channelScopes (injected, owner-closed: the web caller wires the same
 * customer-inbox gateway read the human pages use — single-action-layer rule, no Prisma here).
 * An empty list means no channel is connected yet — tell the user to connect one, never guess.
 */
import type { RunContext } from "@openai/agents";
import { z } from "zod";
import { defineOttoSkill } from "../skill.js";
import type { OttoContext } from "../context.js";

const params = z.object({});
type Input = z.infer<typeof params>;

export async function executeListChannelScopes(
  _input: Input,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<unknown> {
  const ctx = runContext.context as OttoContext;
  if (!ctx?.channelScopes?.list) return { error: "Channel accounts aren't available right now." };
  return ctx.channelScopes.list();
}

export const listChannelScopesSkill = defineOttoSkill({
  name: "listChannelScopes",
  cost: "free",
  effect: "read",
  reach: "internal",
  description:
    "List the workspace's connected messaging channel accounts (channel + scope key) — the same rows " +
    "a human sees in the Inbox template and broadcast channel pickers. $0 read-only. An empty list " +
    "means no channel is connected yet — tell the user to connect one instead of guessing an id.",
  parameters: params,
  execute: executeListChannelScopes,
});

export const listChannelScopes = listChannelScopesSkill.tool;
