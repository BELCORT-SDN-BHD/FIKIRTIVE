/**
 * planCampaign — $0 Campaign proposal/edit/grouping parity (B0-51..58, C2a).
 *
 * This is the proposal segment only. It can change internal planning rows through the shared action
 * port, but cannot generate, charge credits, schedule a send, publish, or call a provider.
 */
import type { RunContext } from "@openai/agents";
import { z } from "zod";
import { CAMPAIGN_STATUSES } from "@fikirtive/core/campaign-lifecycle";
import { ottoPublishTruth } from "@fikirtive/core/schedule-draft";
import { defineOttoSkill } from "../skill.js";
import type { OttoContext } from "../context.js";

const idSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const slugSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/);

export const campaignCardEntrySchema = z.object({
  date: dateSchema,
  platform: slugSchema,
  format: slugSchema,
  hook: z.string().trim().min(1).max(300),
  brief: z.string().trim().min(1).max(2_000),
  estCredits: z.number().int().min(0).max(1_000_000).describe(
    "Display-only planning estimate. This never authorizes or dispatches spend.",
  ),
}).strict();

const trendEvidence = z.object({
  summary: z.string().trim().min(1).max(1_000),
  sources: z.array(z.object({
    title: z.string().trim().min(1).max(200),
    domain: z.string().trim().min(1).max(253),
  }).strict()).min(1).max(20),
  capturedAt: z.string().optional(),
}).strict();

const params = z.object({
  operation: z.enum([
    "create_campaign",
    "propose_entry",
    "update_entry",
    "remove_entry",
    "approve_entry",
    "group_target",
    "clear_target",
    "save_trend",
  ]),
  campaignId: idSchema.nullable().optional().describe("Exact Campaign id from readCampaigns; never guess."),
  entryId: idSchema.optional().describe("Exact plan entry id from readCampaigns get; never guess."),
  name: z.string().trim().min(1).max(120).optional(),
  goal: z.string().trim().min(1).max(500).optional(),
  // C7 —— 手抄的第三份状态词汇改成读那一张表(`@fikirtive/core/campaign-lifecycle`)。
  // 值与顺序一字未变,所以工具参数的形状零变化;变的只是它从哪儿来。
  status: z.enum(CAMPAIGN_STATUSES).optional(),
  period: z.object({
    start: dateSchema,
    end: dateSchema,
    tz: z.literal("Asia/Kuala_Lumpur"),
  }).strict().optional(),
  theme: z.string().trim().min(1).max(300).optional(),
  entry: campaignCardEntrySchema.optional(),
  patch: campaignCardEntrySchema.partial().strict().optional(),
  targetType: z.enum(["project", "scheduled_post", "generation"]).optional(),
  targetId: idSchema.optional(),
  evidence: trendEvidence.optional(),
}).strict();

type PlanCampaignInput = z.infer<typeof params>;

export async function executePlanCampaign(
  input: PlanCampaignInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<unknown> {
  const campaigns = runContext?.context?.campaigns;
  if (!campaigns) return { ok: false, error: "Campaign planning isn't available right now." };

  switch (input.operation) {
    case "create_campaign":
      if (!input.name || !input.goal || !input.status || !input.period) {
        return { ok: false, error: "create_campaign needs `name`, `goal`, `status`, and structured `period`." };
      }
      return campaigns.create({
        name: input.name,
        goal: input.goal,
        status: input.status,
        period: input.period,
        theme: input.theme,
      });
    case "propose_entry":
      if (!input.campaignId || !input.entry) {
        return { ok: false, error: "propose_entry needs exact `campaignId` and structured `entry`." };
      }
      return campaigns.proposeEntry({ campaignId: input.campaignId, entry: input.entry });
    case "update_entry":
      if (!input.campaignId || !input.entryId || !input.patch || Object.keys(input.patch).length === 0) {
        return { ok: false, error: "update_entry needs at least one structured field in `patch`." };
      }
      return campaigns.updateEntry({
        campaignId: input.campaignId,
        entryId: input.entryId,
        patch: input.patch,
      });
    case "remove_entry":
      if (!input.campaignId || !input.entryId) {
        return { ok: false, error: "remove_entry needs exact `campaignId` and `entryId`." };
      }
      return campaigns.removeEntry({ campaignId: input.campaignId, entryId: input.entryId });
    case "approve_entry":
      if (!input.campaignId || !input.entryId) {
        return { ok: false, error: "approve_entry needs exact `campaignId` and `entryId`." };
      }
      return campaigns.approveEntry({ campaignId: input.campaignId, entryId: input.entryId });
    case "group_target":
      if (!input.campaignId || !input.targetType || !input.targetId) {
        return { ok: false, error: "group_target needs exact `campaignId`, `targetType`, and `targetId`." };
      }
      return campaigns.group({
        campaignId: input.campaignId,
        targetType: input.targetType,
        targetId: input.targetId,
      });
    case "clear_target":
      if (!input.targetType || !input.targetId) {
        return { ok: false, error: "clear_target needs exact `targetType` and `targetId`." };
      }
      return campaigns.group({ campaignId: null, targetType: input.targetType, targetId: input.targetId });
    case "save_trend":
      if (!input.evidence) return { ok: false, error: "save_trend needs structured `evidence`." };
      return campaigns.saveTrend({ campaignId: input.campaignId ?? null, evidence: input.evidence });
  }
}

export const planCampaignSkill = defineOttoSkill({
  name: "planCampaign",
  cost: "free",
  effect: "write",
  reach: "internal",
  description:
    "Create a Campaign container; propose, update, remove, or mark approved a structured CAMPAIGN_CARD plan entry; " +
    "group existing owned Projects, Scheduled Posts, or Generations; or save one source-labelled Trend conclusion. " +
    "$0 internal planning writes through the same owner-scoped actions the merchant's own screens use. Inputs are structured only. " +
    "Approval records entry-level planning status only: it NEVER dispatches generation, credits, scheduling, sending, " +
    "publishing, provider calls, or standing outbound authorization. estCredits is display-only. Never invent ids; read " +
    "them with readCampaigns first. Campaign does not own editable UTM data. " +
    `${ottoPublishTruth()}`,
  parameters: params,
  execute: executePlanCampaign,
});
