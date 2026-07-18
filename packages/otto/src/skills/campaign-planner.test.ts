import type { RunContext } from "@openai/agents";
import { describe, expect, it, vi } from "vitest";
import type { OttoContext } from "../context.js";
import { campaignCardEntrySchema, executePlanCampaign, planCampaignSkill } from "./plan-campaign.js";
import { executeReadCampaigns, readCampaignsSkill } from "./read-campaigns.js";

const CAMPAIGN_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const ENTRY_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
const TARGET_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAX";
const entry = {
  date: "2026-08-24",
  platform: "instagram",
  format: "image",
  hook: "The box that sells out every Merdeka",
  brief: "Show the gift box opening on a bakery counter in warm morning light.",
  estCredits: 12,
};

function ports() {
  return {
    list: vi.fn().mockResolvedValue({ ok: true, campaigns: [] }),
    get: vi.fn().mockResolvedValue({ error: "Campaign not found." }),
    listTrends: vi.fn().mockResolvedValue({ ok: true, snapshots: [] }),
    create: vi.fn().mockResolvedValue({ ok: true, campaignId: CAMPAIGN_ID }),
    proposeEntry: vi.fn().mockResolvedValue({ ok: true }),
    updateEntry: vi.fn().mockResolvedValue({ ok: true }),
    removeEntry: vi.fn().mockResolvedValue({ ok: true }),
    approveEntry: vi.fn().mockResolvedValue({ ok: true }),
    group: vi.fn().mockResolvedValue({ ok: true }),
    saveTrend: vi.fn().mockResolvedValue({ ok: true }),
  } as NonNullable<OttoContext["campaigns"]>;
}

function runContext(campaigns?: OttoContext["campaigns"]): Pick<RunContext<OttoContext>, "context"> {
  return { context: { campaigns } as OttoContext };
}

describe("Campaign planner skills", () => {
  it("declares fail-closed free/internal read and write classifications", () => {
    expect(readCampaignsSkill).toMatchObject({
      name: "readCampaigns",
      cost: "free",
      effect: "read",
      reach: "internal",
      needsApproval: false,
    });
    expect(planCampaignSkill).toMatchObject({
      name: "planCampaign",
      cost: "free",
      effect: "write",
      reach: "internal",
      needsApproval: false,
    });
  });

  it("accepts one closed CAMPAIGN_CARD entry and rejects prose or hidden dispatch fields", () => {
    expect(campaignCardEntrySchema.safeParse(entry).success).toBe(true);
    expect(campaignCardEntrySchema.safeParse("make a Merdeka post").success).toBe(false);
    expect(campaignCardEntrySchema.safeParse({ ...entry, generate: true }).success).toBe(false);
    expect(campaignCardEntrySchema.safeParse({ ...entry, ownerId: "other" }).success).toBe(false);
  });

  it("routes list/get/trends through one injected read port and requires exact ids", async () => {
    const campaignPorts = ports();
    await executeReadCampaigns({ operation: "list" }, runContext(campaignPorts));
    await executeReadCampaigns({ operation: "get", campaignId: CAMPAIGN_ID }, runContext(campaignPorts));
    await executeReadCampaigns({ operation: "list_trends", campaignId: CAMPAIGN_ID, limit: 10 }, runContext(campaignPorts));
    expect(campaignPorts.list).toHaveBeenCalledTimes(1);
    expect(campaignPorts.get).toHaveBeenCalledWith(CAMPAIGN_ID);
    expect(campaignPorts.listTrends).toHaveBeenCalledWith({ campaignId: CAMPAIGN_ID, limit: 10 });
    await expect(executeReadCampaigns({ operation: "get" }, runContext(campaignPorts))).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("campaignId"),
    });
  });

  it("routes proposal, approval, and grouping through the shared write port without spend fields", async () => {
    const campaignPorts = ports();
    await executePlanCampaign({ operation: "propose_entry", campaignId: CAMPAIGN_ID, entry }, runContext(campaignPorts));
    await executePlanCampaign({ operation: "approve_entry", campaignId: CAMPAIGN_ID, entryId: ENTRY_ID }, runContext(campaignPorts));
    await executePlanCampaign({ operation: "group_target", campaignId: CAMPAIGN_ID, targetType: "project", targetId: TARGET_ID }, runContext(campaignPorts));
    expect(campaignPorts.proposeEntry).toHaveBeenCalledWith({ campaignId: CAMPAIGN_ID, entry });
    expect(campaignPorts.approveEntry).toHaveBeenCalledWith({ campaignId: CAMPAIGN_ID, entryId: ENTRY_ID });
    expect(campaignPorts.group).toHaveBeenCalledWith({ campaignId: CAMPAIGN_ID, targetType: "project", targetId: TARGET_ID });
    const proposalCalls = (campaignPorts.proposeEntry as unknown as { mock: { calls: unknown[] } }).mock.calls;
    expect(JSON.stringify(proposalCalls)).not.toMatch(/ownerId|generate|publish|dispatch/);
  });

  it("fails closed when the authenticated Campaign port is absent", async () => {
    await expect(executeReadCampaigns({ operation: "list" }, runContext())).resolves.toMatchObject({ ok: false });
    await expect(executePlanCampaign({ operation: "propose_entry", campaignId: CAMPAIGN_ID, entry }, runContext())).resolves.toMatchObject({ ok: false });
  });
});
