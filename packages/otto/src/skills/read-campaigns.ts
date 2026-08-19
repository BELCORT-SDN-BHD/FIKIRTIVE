/**
 * readCampaigns — $0 Campaign/Trend read parity (B0-51/55/56/58, C2a).
 *
 * Reads only through the injected, authenticated web action port. It never reads Prisma directly,
 * accepts identity, or infers legacy UTM authority.
 *
 * C7 —— Otto 从前说得出四个状态名(它们在 `plan-campaign.ts` 与 `context.ts` 里各被手抄了
 * 一遍),却看不见**它们之间哪一步是合法的**:转移表住在 `apps/web`,助手够不着。于是那张
 * 表搬进了 core,下面这句「合法动作」由表算出来,不是手写的 —— 表改一行,这句跟着改。
 */
import type { RunContext } from "@openai/agents";
import { z } from "zod";
import { CAMPAIGN_STATUSES, nextCampaignStatuses } from "@fikirtive/core/campaign-lifecycle";
import { defineOttoSkill } from "../skill.js";
import type { OttoContext } from "../context.js";

/** 「从哪儿能到哪儿」—— 整句由那张表生成,手里一个状态名都没写。 */
const CAMPAIGN_STATUS_MOVES = CAMPAIGN_STATUSES.map(
  (from) => `${from} to ${nextCampaignStatuses(from).join(" or ")}`,
).join("; ");

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
    "no editable UTM authority here, and missing or invalid plan data stays unavailable rather than guessed. " +
    `Statuses and the only moves between them come from one lifecycle table — ${CAMPAIGN_STATUS_MOVES}. ` +
    "Any other move is refused by the server, so never offer one.",
  parameters: params,
  execute: executeReadCampaigns,
});

export const readCampaigns = readCampaignsSkill.tool;

