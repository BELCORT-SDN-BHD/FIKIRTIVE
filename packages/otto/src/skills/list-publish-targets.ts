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
import { CONNECTION_BLOCKER_COPY, SCHEDULE_CHANNELS, type ChannelReadState } from "@fikirtive/core";
import { ottoPublishTruth } from "@fikirtive/core/schedule-draft";
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

  // The list is PER CHANNEL (#741 r5 P1). A channel that could not be read — or that is connected
  // but expired — contributes nothing to `targets`, and handing Otto the bare list would let it
  // report that silence as "you have nothing connected there". Every channel that did not answer
  // "ok" is named, with the same words the human screens use for the same state.
  // The channel set comes from core's ONE closed list — a second handwritten array here would be
  // the same "second source of truth" this ticket has been closing all along.
  const states = res.channelStates ?? {};
  const incomplete: Record<string, Exclude<ChannelReadState, "ok">> = {};
  for (const channel of SCHEDULE_CHANNELS) {
    const state: ChannelReadState = states[channel] ?? "unreadable";
    if (state !== "ok") incomplete[channel] = state;
  }
  if (Object.keys(incomplete).length === 0) return { targets: res.targets };

  const described = Object.entries(incomplete).map(([channel, state]) =>
    state === "unreadable"
      ? `${channel}: couldn't be checked just now`
      : `${channel}: connected, but ${CONNECTION_BLOCKER_COPY[state].status}`,
  );
  return {
    targets: res.targets,
    incomplete,
    message:
      `This list is incomplete — ${described.join("; ")}. ` +
      "Do NOT tell the user those channels have no connected account; say what is listed above and offer to check again.",
  };
}

export const listPublishTargetsSkill = defineOttoSkill({
  name: "listPublishTargets",
  cost: "free",
  effect: "read",
  reach: "internal",
  description:
    // #851 r2 — "the accounts the user can publish to" is a send promise in another word form; it
    // sat one line above the authority sentence saying nothing is sent. What the list IS — the
    // connected accounts a post can be aimed at — is true in both states.
    "List the user's connected Instagram business / Facebook page accounts " +
    "so you can choose a valid target when drafting or editing a post. $0 read-only. " +
    // #851 — an empty list used to be answered with "tell them to connect one". While publishing is
    // off that sends the user at a door that does not open, so the authority answers it instead.
    `${ottoPublishTruth()} ` +
    "An empty list means they have no publishable account on record. If the result carries " +
    "`incomplete`, the list is NOT the whole picture: those channels could not be checked or are connected " +
    "but unusable, so never tell the user they have no account there — repeat the reason given and offer " +
    "to check again.",
  parameters: params,
  execute: executeListPublishTargets,
});
