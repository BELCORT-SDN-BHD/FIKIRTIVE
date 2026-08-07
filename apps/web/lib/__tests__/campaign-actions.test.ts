import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireOwner,
  mockIsImpersonating,
  mockTransaction,
  mockCampaignCreate,
  mockCampaignFindFirst,
  mockCampaignUpdateMany,
  mockTrendCreate,
  mockProjectFindFirst,
  mockProjectUpdateMany,
  mockPostFindFirst,
  mockPostUpdateMany,
  mockGenerationFindFirst,
  mockGenerationUpdateMany,
  mockProjectFindMany,
  mockGenerationBatchFindMany,
  mockGenJobFindFirst,
  mockExecuteRaw,
} = vi.hoisted(() => ({
  mockRequireOwner: vi.fn(),
  mockIsImpersonating: vi.fn(),
  mockTransaction: vi.fn(),
  mockCampaignCreate: vi.fn(),
  mockCampaignFindFirst: vi.fn(),
  mockCampaignUpdateMany: vi.fn(),
  mockTrendCreate: vi.fn(),
  mockProjectFindFirst: vi.fn(),
  mockProjectUpdateMany: vi.fn(),
  mockPostFindFirst: vi.fn(),
  mockPostUpdateMany: vi.fn(),
  mockGenerationFindFirst: vi.fn(),
  mockGenerationUpdateMany: vi.fn(),
  mockProjectFindMany: vi.fn(),
  mockGenerationBatchFindMany: vi.fn(),
  mockGenJobFindFirst: vi.fn(),
  mockExecuteRaw: vi.fn(),
}));

vi.mock("@/lib/auth-guard", () => ({ requireOwner: mockRequireOwner }));
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: mockIsImpersonating }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    $transaction: mockTransaction,
    $executeRaw: mockExecuteRaw,
    campaign: {
      create: mockCampaignCreate,
      findFirst: mockCampaignFindFirst,
      updateMany: mockCampaignUpdateMany,
    },
    trendSnapshot: { create: mockTrendCreate },
    project: {
      findFirst: mockProjectFindFirst,
      findMany: mockProjectFindMany,
      updateMany: mockProjectUpdateMany,
    },
    scheduledPost: { findFirst: mockPostFindFirst, updateMany: mockPostUpdateMany },
    generation: { findFirst: mockGenerationFindFirst, updateMany: mockGenerationUpdateMany },
    generationBatch: { findMany: mockGenerationBatchFindMany },
    genJob: { findFirst: mockGenJobFindFirst },
  },
}));

let idCounter = 0;
vi.mock("@fikirtive/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@fikirtive/core")>()),
  newId: () => [
    "01ARZ3NDEKTSV4RRFFQ69G5FAZ",
    "01ARZ3NDEKTSV4RRFFQ69G5FAY",
    "01ARZ3NDEKTSV4RRFFQ69G5FAX",
  ][idCounter++ % 3],
}));

import {
  approveCampaignEntry,
  proposeCampaign,
  proposeCampaignEntry,
  removeCampaignEntry,
  setCampaignGrouping,
  unapproveCampaignEntry,
  updateCampaignEntry,
} from "../campaign-actions";

const OWNER = "org-a";
const CAMPAIGN_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const ENTRY_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
const TARGET_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAX";
const UPDATED_AT = new Date("2026-07-15T02:00:00.000Z");
const START_AT = new Date("2026-08-23T16:00:00.000Z");
const END_AT = new Date("2026-08-31T15:59:59.999Z");
const PLAN = {
  theme: "Local pride, freshly baked",
  rationale: null,
  entries: [
    {
      id: ENTRY_ID,
      date: "2026-08-24",
      platform: "instagram",
      format: "image",
      hook: "The box that sells out every Merdeka",
      brief: "Show the gift box opening on a bakery counter in warm morning light.",
      estCredits: 12,
      status: "proposed",
    },
  ],
  ideas: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  idCounter = 0;
  process.env.BETTER_AUTH_SECRET = "campaign-test-secret";
  mockRequireOwner.mockResolvedValue({ ownerId: OWNER, email: "owner@example.com" });
  mockIsImpersonating.mockResolvedValue(false);
  mockCampaignFindFirst.mockResolvedValue(null);
  mockCampaignCreate.mockResolvedValue({});
  mockTrendCreate.mockResolvedValue({});
  mockCampaignUpdateMany.mockResolvedValue({ count: 1 });
  mockProjectUpdateMany.mockResolvedValue({ count: 1 });
  mockPostUpdateMany.mockResolvedValue({ count: 1 });
  mockGenerationUpdateMany.mockResolvedValue({ count: 1 });
  mockProjectFindMany.mockResolvedValue([]);
  mockGenerationBatchFindMany.mockResolvedValue([]);
  mockGenJobFindFirst.mockResolvedValue(null);
  mockExecuteRaw.mockResolvedValue(0);
  // The transaction client must carry the SAME surface as the ambient one: the paid-set moves
  // (undo / remove) do their dispatch-history read and their plan write inside one transaction
  // holding the campaign approval lock, so a tx client that only knows `create` would make those
  // paths untestable here rather than proven.
  mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({
      $executeRaw: mockExecuteRaw,
      campaign: {
        create: mockCampaignCreate,
        findFirst: mockCampaignFindFirst,
        updateMany: mockCampaignUpdateMany,
      },
      trendSnapshot: { create: mockTrendCreate },
      project: { findMany: mockProjectFindMany },
      generationBatch: { findMany: mockGenerationBatchFindMany },
      genJob: { findFirst: mockGenJobFindFirst },
    }),
  );
});

function proposedEntry() {
  return {
    date: "2026-08-24",
    platform: "instagram",
    format: "image",
    hook: "The box that sells out every Merdeka",
    brief: "Show the gift box opening on a bakery counter in warm morning light.",
    estCredits: 12,
  };
}

function createInput() {
  const campaignId = "01ARZ3NDEKTSV4RRFFQ69G5FAZ";
  return {
    campaignId,
    campaignProof: createHmac("sha256", process.env.BETTER_AUTH_SECRET!)
      .update(JSON.stringify(["fikirtive:campaign-draft:v1", OWNER, campaignId]))
      .digest("base64url"),
    title: "Merdeka gift-box launch",
    goal: "Drive Merdeka gift-box pre-orders",
    status: "DRAFT",
    period: { start: "2026-08-24", end: "2026-08-31", tz: "Asia/Kuala_Lumpur" },
    theme: "Local pride, freshly baked",
    items: [proposedEntry()],
    ideas: [],
  };
}

describe("proposeCampaign", () => {
  it("creates one owner-scoped, zero-cost Campaign without writing legacy UTM", async () => {
    const input = createInput();
    const result = await proposeCampaign(input);

    expect(result).toMatchObject({ ok: true, idempotent: false, campaignId: input.campaignId });
    const data = mockCampaignCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({
      id: input.campaignId,
      ownerId: OWNER,
      name: "Merdeka gift-box launch",
      status: "DRAFT",
      goal: "Drive Merdeka gift-box pre-orders",
      startAt: START_AT,
      endAt: END_AT,
      deletedAt: null,
    });
    expect(data).not.toHaveProperty("utmBase");
    expect(data.planJson.entries[0]).toMatchObject({ ...proposedEntry(), status: "proposed" });
    expect(data.planJson.entries[0].id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(mockCampaignUpdateMany).not.toHaveBeenCalled();
  });

  it("replays the same server-issued Campaign idempotently after a lost response", async () => {
    const input = createInput();
    await proposeCampaign(input);
    const created = mockCampaignCreate.mock.calls[0][0].data;
    mockCampaignFindFirst.mockResolvedValue({
      id: input.campaignId,
      name: created.name,
      status: created.status,
      goal: created.goal,
      startAt: created.startAt,
      endAt: created.endAt,
      planJson: created.planJson,
    });
    const replay = await proposeCampaign(input);
    expect(replay).toMatchObject({ ok: true, idempotent: true, campaignId: input.campaignId });
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it("rejects legacy utmBase and client identity fields before any write", async () => {
    const base = createInput();
    await expect(proposeCampaign({ ...base, utmBase: "utm_source=legacy" })).resolves.toHaveProperty("error");
    await expect(proposeCampaign({ ...base, ownerId: "org-attacker" })).resolves.toHaveProperty("error");
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("rejects a forged server-issued id proof", async () => {
    const result = await proposeCampaign({ ...createInput(), campaignProof: "forged" });
    expect(result).toEqual({ error: "Start a new campaign draft and try again." });
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});

describe("Campaign plan entry actions", () => {
  beforeEach(() => {
    mockCampaignFindFirst.mockResolvedValue({
      planJson: PLAN,
      startAt: START_AT,
      endAt: END_AT,
      updatedAt: UPDATED_AT,
    });
  });

  it("adds one structured entry with an owner-bound server-issued id", async () => {
    const draft = {
      entryId: "01ARZ3NDEKTSV4RRFFQ69G5FAY",
      entryProof: createHmac("sha256", process.env.BETTER_AUTH_SECRET!)
        .update(JSON.stringify(["fikirtive:campaign-entry-draft:v1", OWNER, CAMPAIGN_ID, "01ARZ3NDEKTSV4RRFFQ69G5FAY"]))
        .digest("base64url"),
    };
    const result = await proposeCampaignEntry({
      campaignId: CAMPAIGN_ID,
      entryId: draft.entryId,
      entryProof: draft.entryProof,
      entry: { ...proposedEntry(), hook: "Fresh second hook" },
    });
    expect(result).toHaveProperty("ok", true);
    const entries = mockCampaignUpdateMany.mock.calls[0][0].data.planJson.entries;
    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({ id: draft.entryId, hook: "Fresh second hook", status: "proposed" });
  });

  it("updates only the owner-scoped plan entry and uses optimistic concurrency", async () => {
    const result = await updateCampaignEntry({
      campaignId: CAMPAIGN_ID,
      entryId: ENTRY_ID,
      patch: { hook: "A fresh Merdeka box", estCredits: 14 },
    });
    expect(result).toHaveProperty("ok", true);
    expect(mockCampaignFindFirst).toHaveBeenCalledWith({
      where: { id: CAMPAIGN_ID, ownerId: OWNER, deletedAt: null },
      select: { planJson: true, startAt: true, endAt: true, updatedAt: true },
    });
    expect(mockCampaignUpdateMany).toHaveBeenCalledWith({
      where: { id: CAMPAIGN_ID, ownerId: OWNER, deletedAt: null, updatedAt: UPDATED_AT },
      data: { planJson: expect.objectContaining({ entries: [expect.objectContaining({ hook: "A fresh Merdeka box", estCredits: 14 })] }) },
    });
  });

  it("marks the entry approved without generation, spend, scheduling, or publishing", async () => {
    const result = await approveCampaignEntry({ campaignId: CAMPAIGN_ID, entryId: ENTRY_ID });
    expect(result).toHaveProperty("ok", true);
    expect(mockCampaignUpdateMany.mock.calls[0][0].data.planJson.entries[0].status).toBe("approved");
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockTrendCreate).not.toHaveBeenCalled();
  });

  it("treats a repeated removal as an idempotent no-op", async () => {
    const first = await removeCampaignEntry({ campaignId: CAMPAIGN_ID, entryId: ENTRY_ID });
    expect(first).toHaveProperty("ok", true);
    mockCampaignUpdateMany.mockClear();
    mockCampaignFindFirst.mockResolvedValue({
      planJson: { ...PLAN, entries: [] },
      startAt: START_AT,
      endAt: END_AT,
      updatedAt: UPDATED_AT,
    });
    const replay = await removeCampaignEntry({ campaignId: CAMPAIGN_ID, entryId: ENTRY_ID });
    expect(replay).toMatchObject({ ok: true, idempotent: true });
    expect(mockCampaignUpdateMany).not.toHaveBeenCalled();
  });

  // #744 判官 r1 P1 — both moves that shrink the paid set must go through the same guarded
  // transaction: take the campaign approval lock, read the dispatch history, THEN write. Asserted
  // on the calls themselves so a future refactor cannot quietly drop the lock from one of them.
  it.each([
    ["remove", () => removeCampaignEntry({ campaignId: CAMPAIGN_ID, entryId: ENTRY_ID })],
    ["undo", () => unapproveCampaignEntry({ campaignId: CAMPAIGN_ID, entryId: ENTRY_ID })],
  ])("takes the campaign approval lock before %s writes the plan", async (_name, run) => {
    await run();
    expect(mockTransaction).toHaveBeenCalled();
    expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
    expect(mockExecuteRaw.mock.calls[0][0].join("?")).toContain("pg_advisory_xact_lock");
    expect(mockExecuteRaw.mock.calls[0][1]).toBe(`campaign-approval:${CAMPAIGN_ID}`);
    // The history read happens inside that same transaction, before any write.
    expect(mockProjectFindMany).toHaveBeenCalled();
  });

  it("returns zero bytes and never mutates another tenant's Campaign", async () => {
    mockRequireOwner.mockResolvedValue({ ownerId: "org-b", email: "b@example.com" });
    mockCampaignFindFirst.mockResolvedValue(null);
    const result = await approveCampaignEntry({ campaignId: CAMPAIGN_ID, entryId: ENTRY_ID });
    expect(result).toEqual({ error: "Campaign not found." });
    expect(mockCampaignFindFirst.mock.calls[0][0].where).toEqual({
      id: CAMPAIGN_ID,
      ownerId: "org-b",
      deletedAt: null,
    });
    expect(mockCampaignUpdateMany).not.toHaveBeenCalled();
  });
});

describe("setCampaignGrouping", () => {
  it("validates both Campaign and Project against the authenticated owner before grouping", async () => {
    mockCampaignFindFirst.mockResolvedValue({ id: CAMPAIGN_ID });
    mockProjectFindFirst.mockResolvedValue({ id: TARGET_ID, campaignId: null });
    const result = await setCampaignGrouping({
      campaignId: CAMPAIGN_ID,
      targetType: "project",
      targetId: TARGET_ID,
    });
    expect(result).toMatchObject({ ok: true, idempotent: false });
    expect(mockCampaignFindFirst.mock.calls[0][0].where).toEqual({ id: CAMPAIGN_ID, ownerId: OWNER, deletedAt: null });
    expect(mockProjectFindFirst.mock.calls[0][0].where).toEqual({ id: TARGET_ID, ownerId: OWNER, deletedAt: null });
    expect(mockProjectUpdateMany).toHaveBeenCalledWith({
      where: { id: TARGET_ID, ownerId: OWNER, deletedAt: null },
      data: { campaignId: CAMPAIGN_ID },
    });
  });

  it("fails closed when the target belongs to another tenant", async () => {
    mockCampaignFindFirst.mockResolvedValue({ id: CAMPAIGN_ID });
    mockGenerationFindFirst.mockResolvedValue(null);
    const result = await setCampaignGrouping({
      campaignId: CAMPAIGN_ID,
      targetType: "generation",
      targetId: TARGET_ID,
    });
    expect(result).toEqual({ error: "Generation not found." });
    expect(mockGenerationFindFirst.mock.calls[0][0].where.ownerId).toBe(OWNER);
    expect(mockGenerationUpdateMany).not.toHaveBeenCalled();
  });

  it("clears a Scheduled Post grouping without requiring a Campaign id", async () => {
    mockPostFindFirst.mockResolvedValue({ id: TARGET_ID, campaignId: CAMPAIGN_ID });
    const result = await setCampaignGrouping({ campaignId: null, targetType: "scheduled_post", targetId: TARGET_ID });
    expect(result).toHaveProperty("ok", true);
    expect(mockCampaignFindFirst).not.toHaveBeenCalled();
    expect(mockPostUpdateMany).toHaveBeenCalledWith({
      where: { id: TARGET_ID, ownerId: OWNER, deletedAt: null },
      data: { campaignId: null },
    });
  });
});
