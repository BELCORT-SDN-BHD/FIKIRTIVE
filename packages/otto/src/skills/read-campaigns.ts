/**
 * readCampaigns — $0 Campaign/Trend read parity (B0-51/55/56/58, C2a).
 *
 * Reads only through the injected, authenticated web action port. It never reads Prisma directly,
 * accepts identity, or infers legacy UTM authority.
 */
import type { RunContext } from "@openai/agents";
import { z } from "zod";
import { defineOttoSkill } from "../skill.js";
import type { OttoContext } from "../context.js";

const params = z.object({
  operation: z.enum(["list", "get", "list_trends"]),
  campaignId: z.string().optional().describe(
    "get/list_trends: exact Campaign id returned by list. Never guess an id.",
  ),
  limit: z.number().int().min(1).max(100).optional().describe("list_trends only; defaults to 50."),
}).strict();

type ReadCampaignsInput = z.infer<typeof params>;

export async function executeReadCampaigns(
  input: ReadCampaignsInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<unknown> {
  const campaigns = runContext?.context?.campaigns;
  if (!campaigns) return { ok: false, error: "Campaign planning isn't available right now." };

  switch (input.operation) {
    case "list":
      return campaigns.list();
    case "get":
      if (!input.campaignId) return { ok: false, error: "get needs the exact `campaignId` from list." };
      return campaigns.get(input.campaignId);
    case "list_trends":
      return campaigns.listTrends({ campaignId: input.campaignId, limit: input.limit });
  }
}

export const readCampaignsSkill = defineOttoSkill({
  name: "readCampaigns",
  cost: "free",
  effect: "read",
  reach: "internal",
  description:
    "Read the user's Campaign list, one exact Campaign with structured plan entries and grouped existing work, " +
    "or saved Trend conclusions through the same owner-scoped actions the merchant's own screens use. $0 read-only. " +
    "Use operation=list before get and never guess ids. Campaign is an intent/grouping container only: there is " +
    "no editable UTM authority here, and missing or invalid plan data stays unavailable rather than guessed.",
  parameters: params,
  execute: executeReadCampaigns,
});
