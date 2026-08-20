/**
 * suggestPostTimes — $0 internal-read skill (B0-103, B4 block spec §2.2; 宪法 7 "读的对等").
 *
 * Gate: cost:"free" + effect:"read" + reach:"internal" → needsApproval = false.
 *
 * Reads the cold-start posting-time seed (best windows to post per channel) so Otto can suggest good
 * times BEFORE the user has any history of their own. Reaches the seed ONLY via
 * ctx.schedule.suggestTimes (injected) — never Prisma directly (B9 read-parity port rule). Read-only:
 * there is no write path.
 */
import type { RunContext } from "@openai/agents";
import { z } from "zod";
import { defineOttoSkill } from "../skill.js";
import type { OttoContext } from "../context.js";

const params = z.object({
  channel: z
    .string()
    .min(1)
    .describe('The channel to suggest posting times for, e.g. "instagram" or "facebook".'),
  limit: z
    .number()
    .int()
    .positive()
    .max(20)
    .optional()
    .describe("How many suggestions to return (default a handful, best-first)."),
});
type Input = z.infer<typeof params>;

export async function executeSuggestPostTimes(
  input: Input,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<unknown> {
  const ctx = runContext.context as OttoContext;
  if (!ctx?.schedule?.suggestTimes) return { error: "Scheduling isn't available right now." };
  const suggestions = await ctx.schedule.suggestTimes({ channel: input.channel, limit: input.limit });
  return { suggestions };
}

export const suggestPostTimesSkill = defineOttoSkill({
  name: "suggestPostTimes",
  cost: "free",
  effect: "read",
  reach: "internal",
  description:
    "Suggest good times to publish on a channel (Instagram/Facebook) using known best-window craft " +
    "knowledge — use it to warm the composer's time picker before the user has history of their own. " +
    "$0 read-only. Give the channel; optionally a limit. Returns day-of-week + hour (UTC) slots, best first.",
  parameters: params,
  execute: executeSuggestPostTimes,
});
