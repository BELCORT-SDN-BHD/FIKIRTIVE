import { z } from "zod";
import type { RunContext } from "@openai/agents";
import { defineOttoSkill } from "../skill.js";
import type { OttoContext } from "../context.js";

const NOT_CONNECTED = "Meta isn't connected yet, so I can't read your per-ad performance. Connect Instagram or Facebook in Connections first.";
const META_UNREACHABLE =
  "I couldn't reach Meta just now — a temporary hiccup on Meta's side, not a connection problem. Try again in a moment.";

export const metaAdPerformanceInput = z.object({
  datePreset: z.enum(["last_7d", "last_14d", "last_30d", "last_90d"]).default("last_30d")
    .describe("Reporting window for the per-ad performance numbers."),
});
export type MetaAdPerformanceInput = z.infer<typeof metaAdPerformanceInput>;

export async function executeMetaAdPerformance(
  input: MetaAdPerformanceInput, runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<unknown> {
  const ctx = runContext.context as OttoContext;
  if (!ctx?.metaPerformance) return { message: NOT_CONNECTED };
  const res = await ctx.metaPerformance.getAds(input.datePreset);
  if ("notConnected" in res || "needsReconnect" in res) return { message: NOT_CONNECTED };
  if ("transientError" in res) return { message: META_UNREACHABLE };
  return { datePreset: res.datePreset, fetchedAt: res.fetchedAt, truncated: res.truncated, organic: res.organic, ads: res.ads };
}

export const metaAdPerformanceSkill = defineOttoSkill({
  name: "meta-ad-performance",
  cost: "free", effect: "read", reach: "external",
  description:
    "Read the user's PER-AD Meta performance (each ad's spend/reach/CTR/CPC/ROAS + its creative image & copy) " +
    "so you can tell which specific ads/creatives are winning vs losing. Read-only, $0, no approval. " +
    "Each ad carries its ad account's currency code — always state it with any money figure, and never rank, " +
    "add or compare spend/CPC across ads in different currencies (rate-driven, not performance). Ratio metrics " +
    "(CTR, ROAS) ARE comparable across currencies. " +
    "Numbers are point-in-time — always cite the datePreset + fetchedAt. If organic is pending_permission, " +
    "say organic post performance isn't available yet (awaiting Meta permission) — never invent organic numbers.",
  parameters: metaAdPerformanceInput,
  execute: executeMetaAdPerformance,
});
