/**
 * #710 / #712 — the Campaign container must have exits, and every exit must be honest.
 *
 * These are REAL-DATABASE behaviour tests: two real organizations, the real Prisma client,
 * the real server actions. Two properties matter more than "the call returned ok":
 *
 *   1. PERSISTENCE — after every write the row is re-read straight from the database, so an
 *      action that only pretends (optimistic UI, revalidate-and-hope) fails here. A delete
 *      must still be gone after a fresh read; a rename must still be renamed.
 *   2. MONEY / TRACEABILITY — deleting a campaign is a SOFT delete: the row survives with
 *      deletedAt set and everything already charged (Generation, GenJob) keeps pointing at it.
 *      Un-approving an entry is refused once that entry has been dispatched for generation.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";

const mockAuth = vi.fn();
vi.mock("@/lib/better-auth/compat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/better-auth/compat")>()),
  auth: mockAuth,
  isImpersonating: async () => false,
}));
vi.mock("@/lib/allowlist", () => {
  function allowed(email: string | null | undefined): boolean {
    if (!email) return false;
    const list = `${process.env.FOUNDER_ADMIN_EMAILS ?? ""},${process.env.AUTH_ALLOWED_EMAILS ?? ""}`
      .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    return list.includes(email.toLowerCase());
  }
  function isFounderAdmin(email: string | null | undefined): boolean {
    if (!email) return false;
    const list = (process.env.FOUNDER_ADMIN_EMAILS ?? "")
      .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    return list.includes(email.toLowerCase());
  }
  return { allowed, isFounderAdmin, isAllowedEmail: allowed };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const A_EMAIL = `cmpA-${randomUUID()}@fikirtive.test`;
const B_EMAIL = `cmpB-${randomUUID()}@fikirtive.test`;
beforeAll(() => {
  process.env.AUTH_ALLOWED_EMAILS = `${A_EMAIL},${B_EMAIL}`;
  process.env.FOUNDER_ADMIN_EMAILS = "noone@fikirtive.test";
  process.env.BETTER_AUTH_SECRET ||= "campaign-lifecycle-test-secret";
});

const { requireOwner } = await import("@/lib/auth-guard");
const { prisma } = await import("@fikirtive/db");
const {
  deleteCampaign,
  setCampaignStatus,
  unapproveCampaignEntry,
  updateCampaign,
} = await import("@/lib/campaign-actions");
const { getCampaign, listCampaigns } = await import("@/lib/campaign-view-data");
const { quoteCampaignGeneration } = await import("@/lib/campaign-generation-confirm");
const { campaignEntryLogicalPrefix, deriveCampaignBatchId } = await import("@/lib/campaign-gen-identity");
const { orchestrateBatch } = await import("@/lib/factory-batch");

function asUser(email: string) { mockAuth.mockResolvedValue({ user: { email } }); }
async function ensureUser(email: string) {
  return prisma.user.upsert({ where: { email }, update: {}, create: { id: `usr_${randomUUID()}`, email } });
}

/** ULID alphabet — the actions only accept 26-char Crockford base32 ids. */
let idSeq = 0;
function testId(): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const seed = `${Date.now()}${idSeq++}${Math.floor(Math.random() * 1e9)}`;
  let out = "";
  for (let i = 0; i < 26; i++) {
    out += alphabet[(Number(seed[i % seed.length]) * 7 + i * 11 + idSeq) % 32];
  }
  return out;
}

let orgA: string, orgB: string;

beforeAll(async () => {
  await ensureUser(A_EMAIL); await ensureUser(B_EMAIL);
  asUser(A_EMAIL); const a = await requireOwner(); if ("error" in a) throw new Error(a.error); orgA = a.ownerId;
  asUser(B_EMAIL); const b = await requireOwner(); if ("error" in b) throw new Error(b.error); orgB = b.ownerId;
  expect(orgA).not.toBe(orgB);
});

type SeedOptions = {
  status?: string;
  entries?: Array<{ id: string; date: string; status: "proposed" | "approved"; format?: string }>;
};

async function seedCampaign(ownerId: string, options: SeedOptions = {}) {
  const id = testId();
  await prisma.campaign.create({
    data: {
      id,
      ownerId,
      name: "Merdeka gift-box launch",
      status: options.status ?? "DRAFT",
      goal: "Drive Merdeka gift-box pre-orders",
      startAt: new Date("2026-08-23T16:00:00.000Z"),   // 2026-08-24 in Asia/Kuala_Lumpur
      endAt: new Date("2026-08-31T15:59:59.999Z"),     // 2026-08-31 in Asia/Kuala_Lumpur
      planJson: {
        theme: "Local pride, freshly baked",
        rationale: null,
        ideas: [],
        entries: (options.entries ?? []).map((entry) => ({
          id: entry.id,
          date: entry.date,
          platform: "instagram",
          format: entry.format ?? "image",
          hook: "The box that sells out every Merdeka",
          brief: "Show the gift box opening on a bakery counter in warm morning light.",
          estCredits: 12,
          status: entry.status,
        })),
      },
    },
  });
  return id;
}

async function readCampaign(id: string, ownerId: string) {
  return prisma.campaign.findFirst({
    where: { id, ownerId },
    select: { name: true, goal: true, status: true, startAt: true, endAt: true, planJson: true, deletedAt: true },
  });
}

function entryStatuses(planJson: unknown): Record<string, string> {
  const entries = (planJson as { entries?: Array<{ id: string; status: string }> }).entries ?? [];
  return Object.fromEntries(entries.map((entry) => [entry.id, entry.status]));
}

beforeEach(() => { asUser(A_EMAIL); });

// ────────────────────────────────────────────────────────────────────────────
describe("#710 campaign details are editable — and the edit reaches the database", () => {
  it("renames a campaign and the new name survives a fresh read", async () => {
    const id = await seedCampaign(orgA);

    const result = await updateCampaign({ campaignId: id, patch: { name: "Merdeka gift-box relaunch" } });
    expect(result).toMatchObject({ ok: true });

    // 反 #738 假删除形状:断言持久层真变了,不是界面自己改了个字。
    const row = await readCampaign(id, orgA);
    expect(row?.name).toBe("Merdeka gift-box relaunch");

    const detail = await getCampaign(id);
    expect("ok" in detail && detail.campaign.name).toBe("Merdeka gift-box relaunch");
  });

  it("edits the goal and moves the campaign period", async () => {
    const id = await seedCampaign(orgA, { entries: [{ id: testId(), date: "2026-08-25", status: "proposed" }] });

    const result = await updateCampaign({
      campaignId: id,
      patch: {
        goal: "Drive Merdeka gift-box pre-orders and walk-ins",
        period: { start: "2026-08-20", end: "2026-09-05", tz: "Asia/Kuala_Lumpur" },
      },
    });
    expect(result).toMatchObject({ ok: true });

    const row = await readCampaign(id, orgA);
    expect(row?.goal).toBe("Drive Merdeka gift-box pre-orders and walk-ins");
    expect(row?.startAt.toISOString()).toBe("2026-08-19T16:00:00.000Z");
    expect(row?.endAt.toISOString()).toBe("2026-09-05T15:59:59.999Z");
  });

  it("refuses a period that would strand an existing plan entry outside the campaign", async () => {
    const entryId = testId();
    const id = await seedCampaign(orgA, { entries: [{ id: entryId, date: "2026-08-30", status: "proposed" }] });

    const result = await updateCampaign({
      campaignId: id,
      patch: { period: { start: "2026-08-24", end: "2026-08-26", tz: "Asia/Kuala_Lumpur" } },
    });
    expect(result).toEqual({
      error: "Move or remove the plan entries outside these dates first — every entry must stay inside the campaign period.",
    });

    const row = await readCampaign(id, orgA);
    expect(row?.startAt.toISOString()).toBe("2026-08-23T16:00:00.000Z");
  });

  it("repeating the same edit is idempotent and does not error", async () => {
    const id = await seedCampaign(orgA);
    await updateCampaign({ campaignId: id, patch: { name: "Steady name" } });
    const again = await updateCampaign({ campaignId: id, patch: { name: "Steady name" } });
    expect(again).toMatchObject({ ok: true, idempotent: true });
  });

  it("refuses to edit a closed campaign until it is reopened", async () => {
    const id = await seedCampaign(orgA, { status: "DONE" });

    const blocked = await updateCampaign({ campaignId: id, patch: { name: "Late rename" } });
    expect(blocked).toEqual({ error: "Reopen this campaign before editing its name, goal, or dates." });

    expect(await setCampaignStatus({ campaignId: id, status: "ACTIVE" })).toMatchObject({ ok: true });
    expect(await updateCampaign({ campaignId: id, patch: { name: "Late rename" } })).toMatchObject({ ok: true });
    expect((await readCampaign(id, orgA))?.name).toBe("Late rename");
  });
});

describe("#710 the four database statuses are all reachable, in both directions", () => {
  it("walks draft → active → done and reopens it", async () => {
    const id = await seedCampaign(orgA);

    expect(await setCampaignStatus({ campaignId: id, status: "ACTIVE" })).toMatchObject({ ok: true });
    expect((await readCampaign(id, orgA))?.status).toBe("ACTIVE");

    expect(await setCampaignStatus({ campaignId: id, status: "DONE" })).toMatchObject({ ok: true });
    expect((await readCampaign(id, orgA))?.status).toBe("DONE");

    // No one-way doors: the bug being fixed IS the one-way door.
    expect(await setCampaignStatus({ campaignId: id, status: "ACTIVE" })).toMatchObject({ ok: true });
    expect((await readCampaign(id, orgA))?.status).toBe("ACTIVE");
  });

  it("cancels a draft and reopens it", async () => {
    const id = await seedCampaign(orgA);
    expect(await setCampaignStatus({ campaignId: id, status: "CANCELLED" })).toMatchObject({ ok: true });
    expect((await readCampaign(id, orgA))?.status).toBe("CANCELLED");
    expect(await setCampaignStatus({ campaignId: id, status: "ACTIVE" })).toMatchObject({ ok: true });
    expect((await readCampaign(id, orgA))?.status).toBe("ACTIVE");
  });

  it("refuses a transition that is not on the lifecycle, and leaves the row alone", async () => {
    const id = await seedCampaign(orgA);
    expect(await setCampaignStatus({ campaignId: id, status: "DONE" })).toEqual({
      error: "This campaign can't move from draft to done. Set it to active first.",
    });
    expect((await readCampaign(id, orgA))?.status).toBe("DRAFT");
  });

  it("setting the status it already has is idempotent", async () => {
    const id = await seedCampaign(orgA, { status: "ACTIVE" });
    expect(await setCampaignStatus({ campaignId: id, status: "ACTIVE" })).toMatchObject({ ok: true, idempotent: true });
  });
});

describe("#710 delete is a soft delete: gone from the merchant's view, intact in the record", () => {
  it("leaves the list, stays gone after a refresh, and keeps every charged artefact traceable", async () => {
    const id = await seedCampaign(orgA);
    const projectId = `prj_${randomUUID()}`;
    await prisma.project.create({ data: { id: projectId, ownerId: orgA, name: "Merdeka project", campaignId: id } });
    const asset = await prisma.asset.create({
      data: {
        id: `ast_${randomUUID()}`, ownerId: orgA, contentHash: randomUUID().replace(/-/g, "").repeat(2),
        ext: "png", mime: "image/png", sizeBytes: BigInt(10), source: "GENERATED",
      },
    });
    const generationId = `gen_${randomUUID()}`;
    await prisma.generation.create({
      data: {
        id: generationId, ownerId: orgA, projectId, assetId: asset.id,
        source: "GENERATED", entitySnapshot: {}, campaignId: id,
      },
    });

    const before = await listCampaigns();
    expect("ok" in before && before.campaigns.some((campaign) => campaign.id === id)).toBe(true);

    expect(await deleteCampaign({ campaignId: id })).toMatchObject({ ok: true });

    // 1. the merchant's list really shrank …
    const after = await listCampaigns();
    expect("ok" in after && after.campaigns.some((campaign) => campaign.id === id)).toBe(false);
    // 2. … and a fresh read does not resurrect it (no zombie on refresh) …
    expect(await getCampaign(id)).toEqual({ error: "Campaign not found." });
    // 3. … while the row itself survives with deletedAt set, so nothing charged loses its home.
    const row = await readCampaign(id, orgA);
    expect(row).not.toBeNull();
    expect(row?.deletedAt).toBeInstanceOf(Date);
    // 4. no cascade: the generation still exists and still points at this campaign.
    const generation = await prisma.generation.findFirst({
      where: { id: generationId, ownerId: orgA },
      select: { campaignId: true, deletedAt: true },
    });
    expect(generation).toEqual({ campaignId: id, deletedAt: null });
  });

  it("deleting twice is idempotent", async () => {
    const id = await seedCampaign(orgA);
    expect(await deleteCampaign({ campaignId: id })).toMatchObject({ ok: true, idempotent: false });
    expect(await deleteCampaign({ campaignId: id })).toMatchObject({ ok: true, idempotent: true });
  });
});

describe("#712 approval can be undone — but never after the money has moved", () => {
  it("un-approves an entry and the confirm page's quote shrinks to match", async () => {
    const keep = testId();
    const undo = testId();
    const id = await seedCampaign(orgA, {
      entries: [
        { id: keep, date: "2026-08-25", status: "approved" },
        { id: undo, date: "2026-08-26", status: "approved" },
      ],
    });

    const before = await quoteCampaignGeneration(id);
    expect("ok" in before && before.quote.lines.map((line) => line.entryId).sort()).toEqual([keep, undo].sort());
    const beforeTotal = "ok" in before ? before.quote.totalDisplayCredits : 0;
    expect(beforeTotal).toBeGreaterThan(0);

    expect(await unapproveCampaignEntry({ campaignId: id, entryId: undo })).toMatchObject({ ok: true });

    // The plan really changed in the database — not just in the browser.
    expect(entryStatuses((await readCampaign(id, orgA))?.planJson)).toEqual({
      [keep]: "approved",
      [undo]: "proposed",
    });

    // …and the money surface follows it: one fewer priced line, a strictly smaller total.
    const after = await quoteCampaignGeneration(id);
    expect("ok" in after && after.quote.lines.map((line) => line.entryId)).toEqual([keep]);
    expect("ok" in after && after.quote.totalDisplayCredits).toBeLessThan(beforeTotal);
  });

  it("keeps the creative brief intact — un-approve is not a delete", async () => {
    const entryId = testId();
    const id = await seedCampaign(orgA, { entries: [{ id: entryId, date: "2026-08-25", status: "approved" }] });
    await unapproveCampaignEntry({ campaignId: id, entryId });
    const plan = (await readCampaign(id, orgA))?.planJson as { entries: Array<{ id: string; brief: string }> };
    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0].brief).toBe("Show the gift box opening on a bakery counter in warm morning light.");
  });

  it("un-approving an entry that was never approved is idempotent", async () => {
    const entryId = testId();
    const id = await seedCampaign(orgA, { entries: [{ id: entryId, date: "2026-08-25", status: "proposed" }] });
    expect(await unapproveCampaignEntry({ campaignId: id, entryId })).toMatchObject({ ok: true, idempotent: true });
  });

  it("refuses to un-approve an entry that has already been dispatched for generation", async () => {
    const entryId = testId();
    const id = await seedCampaign(orgA, { entries: [{ id: entryId, date: "2026-08-25", status: "approved" }] });
    const projectId = `prj_${randomUUID()}`;
    await prisma.project.create({ data: { id: projectId, ownerId: orgA, name: "Paid project", campaignId: id } });
    await prisma.genJob.create({
      data: {
        id: `gj_${randomUUID()}`, ownerId: orgA, projectId, prompt: "already paid",
        model: "seedream", kind: "IMAGE", count: 1,
        idempotencyKey: `${campaignEntryLogicalPrefix(id, projectId, entryId)}${"a".repeat(32)}`,
      },
    });

    expect(await unapproveCampaignEntry({ campaignId: id, entryId })).toEqual({
      error: "This entry has already been sent for generation, so its approval can't be undone. Its generation and credits stay in your history.",
    });
    expect(entryStatuses((await readCampaign(id, orgA))?.planJson)).toEqual({ [entryId]: "approved" });
  });

  it("the dispatcher writes exactly the key the un-approve guard looks for", async () => {
    // Without this the guard above could be checking a prefix nothing ever writes — green,
    // and blind. One derivation, two readers: the dispatcher and the guard.
    const entryId = testId();
    const campaignId = testId();
    const projectId = `prj_${randomUUID()}`;
    await prisma.project.create({ data: { id: projectId, ownerId: orgA, name: "Dispatch probe" } });

    const seen: string[] = [];
    const result = await orchestrateBatch(
      { startGen: async (req) => { seen.push(String(req.idempotencyKey)); return { id: `gj_${randomUUID()}`, disposition: "fresh" }; }, prisma },
      {
        ownerId: orgA,
        projectId,
        batchId: deriveCampaignBatchId(campaignId, projectId),
        attemptId: randomUUID().replace(/-/g, ""),
        cells: [{ type: "gen", prompt: "probe", kind: "image", model: "seedream", count: 1, idempotencyId: entryId }],
      },
    );
    expect("error" in result).toBe(false);
    expect(seen).toHaveLength(1);
    expect(seen[0].startsWith(campaignEntryLogicalPrefix(campaignId, projectId, entryId))).toBe(true);
  });
});

describe("tenant boundary — org B cannot reach into org A's campaign", () => {
  it("refuses every lifecycle write from the other tenant and leaves org A's row untouched", async () => {
    const entryId = testId();
    const id = await seedCampaign(orgA, {
      status: "ACTIVE",
      entries: [{ id: entryId, date: "2026-08-25", status: "approved" }],
    });

    asUser(B_EMAIL);
    expect(await updateCampaign({ campaignId: id, patch: { name: "Owned by B" } })).toEqual({ error: "Campaign not found." });
    expect(await setCampaignStatus({ campaignId: id, status: "CANCELLED" })).toEqual({ error: "Campaign not found." });
    expect(await unapproveCampaignEntry({ campaignId: id, entryId })).toEqual({ error: "Campaign not found." });
    expect(await deleteCampaign({ campaignId: id })).toEqual({ error: "Campaign not found." });

    const row = await readCampaign(id, orgA);
    expect(row?.name).toBe("Merdeka gift-box launch");
    expect(row?.status).toBe("ACTIVE");
    expect(row?.deletedAt).toBeNull();
    expect(entryStatuses(row?.planJson)).toEqual({ [entryId]: "approved" });
  });
});
