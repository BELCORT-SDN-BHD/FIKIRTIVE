/**
 * listPublishTargets — $0 internal-read skill (debt-74, B4 block spec §五 5.2; 宪法 7 "读的对等").
 *
 * Gate: cost:"free" + effect:"read" + reach:"internal" → needsApproval = false.
 *
 * Lists the owner's connectable publish targets (their OWN connected IG business / FB pages) so Otto
 * can pick a valid metaTargetId when drafting/editing. Reaches the schedule ONLY via
 * ctx.schedule.listTargets (injected, owner-closed) — an owner with only ads scope (no page scope)
 * gets an empty list, so Otto tells them to connect rather than guessing an id.
 */
import type { RunContext } from "@openai/agents";
import { z } from "zod";
import { ACCOUNTS_UNREADABLE_ERROR } from "@fikirtive/core";
import { defineOttoSkill } from "../skill.js";
import type { OttoContext } from "../context.js";

const params = z.object({});
type Input = z.infer<typeof params>;

export async function executeListPublishTargets(
  _input: Input,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<unknown> {
  const ctx = runContext.context as OttoContext;
  if (!ctx?.schedule?.listTargets) return { error: "Scheduling isn't available right now." };
  const res = await ctx.schedule.listTargets();
  // "Couldn't look" is never reported as "nothing connected" (#741 r3 P1). Same sentence the
  // approve action refuses with, so Otto and the Schedule screen cannot tell different stories.
  if ("unavailable" in res) return { unavailable: true, message: ACCOUNTS_UNREADABLE_ERROR };
  return { targets: res.targets };
}

export const listPublishTargetsSkill = defineOttoSkill({
  name: "listPublishTargets",
  cost: "free",
  effect: "read",
  reach: "internal",
  description:
    "List the accounts the user can publish to (their connected Instagram business / Facebook pages) " +
    "so you can choose a valid target when drafting or editing a post. $0 read-only. An empty list means " +
    "they have not connected a publishable account yet — tell them to connect one. A result with " +
    "unavailable:true means the connection could NOT be read this time — say you couldn't check and " +
    "offer to try again; never tell them they have no connected accounts.",
  parameters: params,
  execute: executeListPublishTargets,
});

export const listPublishTargets = listPublishTargetsSkill.tool;
