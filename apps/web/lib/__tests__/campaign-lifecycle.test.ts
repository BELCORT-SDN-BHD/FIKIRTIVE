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
  removeCampaignEntry,
  setCampaignStatus,
  unapproveCampaignEntry,
  updateCampaign,
} = await import("@/lib/campaign-actions");
const { getCampaign, listCampaigns } = await import("@/lib/campaign-view-data");
const { quoteCampaignGeneration } = await import("@/lib/campaign-generation-confirm");
const {
  campaignEntryLogicalPrefix,
  campaignLegacyCellPrefixes,
  deriveCampaignBatchId,
} = await import("@/lib/campaign-gen-identity");
const { orchestrateBatch } = await import("@/lib/factory-batch");
const {
  applyCampaignApprovalGate,
  campaignApprovalGateRefusal,
  campaignApprovalLockKey,
  CAMPAIGN_APPROVAL_CHECK_UNKNOWN,
  CAMPAIGN_PLAN_CHANGED_MID_DISPATCH,
} = await import("@/lib/campaign-approval-lock");
const { dispatchedCampaignEntryIds } = await import("@/lib/campaign-dispatch-history");
const { runAsUser } = await import("@fikirtive/db/principal");

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

/** The single refusal both paid-set exits give, because the reason is the same one. */
const ALREADY_DISPATCHED =
  "This entry has already been sent for generation, so it can't be taken out of the plan. Its generation and credits stay in your history.";
const CHECK_UNKNOWN =
  "We couldn't check this entry's generation history — nothing was changed. Please retry.";

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

async function entryIds(campaignId: string): Promise<string[]> {
  const plan = (await readCampaign(campaignId, orgA))?.planJson as { entries: Array<{ id: string }> };
  return plan.entries.map((entry) => entry.id);
}

/** A project that has hosted this campaign's generation batch — grouped into the campaign
 *  unless the caller is exercising what happens after the merchant un-groups it. */
async function seedBatchProject(campaignId: string, options: { grouped?: boolean } = {}) {
  const projectId = `prj_${randomUUID()}`;
  await prisma.project.create({
    data: {
      id: projectId,
      ownerId: orgA,
      name: "Paid project",
      campaignId: options.grouped === false ? null : campaignId,
    },
  });
  // orchestrateBatch always writes this row before it dispatches a single cell, so it is the
  // durable record of "this project once ran this campaign's batch".
  await prisma.generationBatch.create({
    data: {
      id: deriveCampaignBatchId(campaignId, projectId),
      ownerId: orgA,
      projectId,
      name: "campaign batch",
    },
  });
  return projectId;
}

async function seedGenJob(projectId: string, idempotencyKey: string) {
  await prisma.genJob.create({
    data: {
      id: `gj_${randomUUID()}`, ownerId: orgA, projectId, prompt: "already paid",
      model: "seedream", kind: "IMAGE", count: 1, idempotencyKey,
    },
  });
}

/** An entry that has been through startGen — i.e. one the merchant has already paid for. */
async function seedPaidEntry(
  campaignId: string,
  entryId: string,
  options: { grouped?: boolean; legacyPositional?: boolean } = {},
) {
  const projectId = await seedBatchProject(campaignId, options);
  await seedGenJob(
    projectId,
    options.legacyPositional
      ? `${campaignLegacyCellPrefixes(campaignId, projectId)[3]}${"b".repeat(32)}`
      : `${campaignEntryLogicalPrefix(campaignId, projectId, entryId)}${"a".repeat(32)}`,
  );
  return projectId;
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

  // #744 判官 r1 P3 — pin the whole matrix, not the one status the first test happened to use.
  // Delete is deliberately allowed from every status: it is a soft delete that keeps the record,
  // and a status that could not be deleted would be another door that only opens inwards.
  it.each(["DRAFT", "ACTIVE", "DONE", "CANCELLED"])(
    "deletes a %s campaign and leaves its row behind with deletedAt set",
    async (status) => {
      const id = await seedCampaign(orgA, { status });
      expect(await deleteCampaign({ campaignId: id })).toMatchObject({ ok: true, idempotent: false });
      const row = await readCampaign(id, orgA);
      expect(row?.status).toBe(status);
      expect(row?.deletedAt).toBeInstanceOf(Date);
      expect(await getCampaign(id)).toEqual({ error: "Campaign not found." });
    },
  );
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
    await seedPaidEntry(id, entryId);

    expect(await unapproveCampaignEntry({ campaignId: id, entryId })).toEqual({ error: ALREADY_DISPATCHED });
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

// ────────────────────────────────────────────────────────────────────────────
// #744 判官 r1 P1-1 — the guard must sit on BOTH exits from the paid set.
// Deleting an approved entry removes it from the confirm quote exactly as undoing its approval
// does, so a guard on one and not the other is a guard on nothing.
describe("#744 P1-1 remove is the same door as undo, and carries the same lock", () => {
  it("refuses to remove an entry that has already been dispatched, and the plan is untouched", async () => {
    const paid = testId();
    const other = testId();
    const id = await seedCampaign(orgA, {
      entries: [
        { id: paid, date: "2026-08-25", status: "approved" },
        { id: other, date: "2026-08-26", status: "proposed" },
      ],
    });
    await seedPaidEntry(id, paid);

    expect(await removeCampaignEntry({ campaignId: id, entryId: paid })).toEqual({ error: ALREADY_DISPATCHED });
    // Not "the call returned an error" — the persisted plan still has both entries.
    expect(await entryIds(id)).toEqual([paid, other]);
    expect(entryStatuses((await readCampaign(id, orgA))?.planJson)[paid]).toBe("approved");
  });

  it("still removes an entry nothing was ever charged for", async () => {
    const keep = testId();
    const drop = testId();
    const id = await seedCampaign(orgA, {
      entries: [
        { id: keep, date: "2026-08-25", status: "approved" },
        { id: drop, date: "2026-08-26", status: "approved" },
      ],
    });

    expect(await removeCampaignEntry({ campaignId: id, entryId: drop })).toMatchObject({ ok: true });
    expect(await entryIds(id)).toEqual([keep]);
  });

  it("greys both buttons out on the page for an entry that is already generated", async () => {
    const paid = testId();
    const free = testId();
    const id = await seedCampaign(orgA, {
      entries: [
        { id: paid, date: "2026-08-25", status: "approved" },
        { id: free, date: "2026-08-26", status: "approved" },
      ],
    });
    await seedPaidEntry(id, paid);

    const detail = await getCampaign(id);
    expect("ok" in detail && detail.campaign.dispatchedEntryIds).toEqual([paid]);
  });
});

describe("#744 P2 the dispatch check cannot be dodged by grouping, age, or a broken read", () => {
  it("still sees the charge after the project is un-grouped from the campaign", async () => {
    const entryId = testId();
    const id = await seedCampaign(orgA, { entries: [{ id: entryId, date: "2026-08-25", status: "approved" }] });
    // The merchant paid inside this project, then took the project out of the campaign. The
    // credits did not come back, so neither exit may pretend the entry is free to remove.
    await seedPaidEntry(id, entryId, { grouped: false });

    expect(await unapproveCampaignEntry({ campaignId: id, entryId })).toEqual({ error: ALREADY_DISPATCHED });
    expect(await removeCampaignEntry({ campaignId: id, entryId })).toEqual({ error: ALREADY_DISPATCHED });
    expect(entryStatuses((await readCampaign(id, orgA))?.planJson)[entryId]).toBe("approved");
  });

  it("refuses when the batch carries pre-stable-id positional history it cannot attribute", async () => {
    const entryId = testId();
    const id = await seedCampaign(orgA, { entries: [{ id: entryId, date: "2026-08-25", status: "approved" }] });
    // Old rows record a cell INDEX, not an entry id. "That charge wasn't mine" is unprovable,
    // so the honest answer is to refuse rather than to guess in the merchant's disfavour.
    await seedPaidEntry(id, entryId, { legacyPositional: true });

    expect(await unapproveCampaignEntry({ campaignId: id, entryId })).toEqual({ error: ALREADY_DISPATCHED });
    expect(await removeCampaignEntry({ campaignId: id, entryId })).toEqual({ error: ALREADY_DISPATCHED });
    expect(await entryIds(id)).toEqual([entryId]);
  });

  it("never reports a failed history read as 'nothing was charged'", async () => {
    // The rule pinned where it lives: a stubbed client whose history read throws must make the
    // helper THROW, never return an empty set. An empty set is the answer "this entry is free to
    // take back", and handing that out on a failed read is how paid history gets rewritten
    // (#656 的教训:读故障按结果不明处理).
    const broken = {
      project: { findMany: async () => [{ id: "prj_1" }] },
      generationBatch: { findMany: async () => { throw new Error("history read unavailable"); } },
      genJob: { findFirst: async () => null },
    } as unknown as Parameters<typeof dispatchedCampaignEntryIds>[0];

    await expect(dispatchedCampaignEntryIds(broken, orgA, testId(), ["01ARZ3NDEKTSV4RRFFQ69G5FAV"]))
      .rejects.toThrow("history read unavailable");
  });

  it("refuses — and changes nothing — when a read inside the guarded transaction throws", async () => {
    const entryId = testId();
    const id = await seedCampaign(orgA, { entries: [{ id: entryId, date: "2026-08-25", status: "approved" }] });

    // A real fault, no patching: the call runs inside an ambient tenant frame belonging to
    // someone else, so the tenant guard throws on the first read the guarded transaction makes.
    // This is the #738 shape — a call site that reached the database in the wrong context — and
    // both exits must answer "unknown" and leave the plan untouched rather than sail on.
    const foreignFrame = {
      kind: "user" as const,
      subjectUserId: null,
      subjectEmail: B_EMAIL,
      ownerId: orgB,
      orgRole: null,
      membershipId: null,
      impersonating: false,
      impersonatedByBaUserId: null,
    };

    expect(await runAsUser(foreignFrame, () => unapproveCampaignEntry({ campaignId: id, entryId })))
      .toEqual({ error: CHECK_UNKNOWN });
    expect(await runAsUser(foreignFrame, () => removeCampaignEntry({ campaignId: id, entryId })))
      .toEqual({ error: CHECK_UNKNOWN });

    expect(await entryIds(id)).toEqual([entryId]);
    expect(entryStatuses((await readCampaign(id, orgA))?.planJson)[entryId]).toBe("approved");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// #744 判官 r1 P1-2 / r2 P1 — the interleaving the judge named, woven by hand.
//
// These tests drive the REAL gate (`applyCampaignApprovalGate` — the call gen-actions makes as
// the FIRST statement of startGen's create+reserve+enqueue transaction) against the REAL undo
// action. What stands in for startGen is the SHAPE of that transaction: one real database
// transaction that runs the gate and then writes the GenJob whose existence IS the charge.
// Where gen-actions puts that call is pinned separately and behaviourally — gen-actions.test.ts
// proves the lock is taken inside the money transaction before the project lock and that a
// refusal reaches neither genJob.create nor reserveCredits; campaign-generation-confirm.test.ts
// pins the wiring statically.
//
// r2's finding was about PLACEMENT, not presence: the gate used to hold the lock in an OUTER
// transaction wrapped around startGen, which opens its own. That outer transaction could time
// out and release the lock while the charge was still uncommitted, and an undo could then take
// the lock, see no GenJob, and write "proposed" — `charged && !approved`. The first test asserts
// that window shut as itself: while the charge is written and NOT yet committed, the lock is
// still held and the undo is still waiting.
describe("#744 P1-2 an undo racing a dispatch has only two legal endings", () => {
  /** The gate the confirm action attaches to every paid campaign dispatch, in miniature: is
   *  this entry still approved in the plan as PERSISTED right now? */
  function approvalGate(campaignId: string, entryId: string) {
    return {
      ownerId: orgA,
      campaignId,
      stillApproved: (planJson: unknown) => entryStatuses(planJson)[entryId] === "approved",
    };
  }

  /** The charge, written by whichever transaction is passed in. */
  async function writeCharge(
    tx: Pick<typeof prisma, "genJob">,
    campaignId: string,
    projectId: string,
    entryId: string,
    salt: string,
  ) {
    await tx.genJob.create({
      data: {
        id: `gj_${randomUUID()}`, ownerId: orgA, projectId, prompt: "already paid",
        model: "seedream", kind: "IMAGE", count: 1,
        idempotencyKey: `${campaignEntryLogicalPrefix(campaignId, projectId, entryId)}${salt.repeat(32)}`,
      },
    });
  }

  async function raceState(campaignId: string, projectId: string, entryId: string) {
    const charged = await prisma.genJob.count({
      where: {
        ownerId: orgA,
        projectId,
        idempotencyKey: { startsWith: campaignEntryLogicalPrefix(campaignId, projectId, entryId) },
      },
    });
    const status = entryStatuses((await readCampaign(campaignId, orgA))?.planJson)[entryId];
    return { charged: charged > 0, approved: status === "approved" };
  }

  it("cannot be squeezed between the lock and the charge — the undo waits for the charging transaction", async () => {
    const entryId = testId();
    const id = await seedCampaign(orgA, { entries: [{ id: entryId, date: "2026-08-25", status: "approved" }] });
    const projectId = await seedBatchProject(id);

    let openWindow = () => {};
    const windowOpen = new Promise<void>((resolve) => { openWindow = resolve; });
    let closeWindow = () => {};
    const windowClosed = new Promise<void>((resolve) => { closeWindow = resolve; });

    // startGen's money transaction: gate first, then the charge, all in ONE transaction.
    const charging = prisma.$transaction(
      async (tx) => {
        await applyCampaignApprovalGate(tx, approvalGate(id, entryId));
        await writeCharge(tx, id, projectId, entryId, "c");
        // Charge written, NOT yet committed — the exact moment r2 named.
        openWindow();
        await windowClosed;
        return "charged" as const;
      },
      { timeout: 30_000 },
    );

    await windowOpen;
    let undoSettled = false;
    const undoing = unapproveCampaignEntry({ campaignId: id, entryId })
      .then((result) => { undoSettled = true; return result; });
    // Long enough for the undo to reach the lock and block on it.
    await new Promise((resolve) => setTimeout(resolve, 500));

    // THE INVARIANT, asserted at the moment it has to hold — the charge exists and is not yet
    // committed. (1) nobody else can take the campaign lock, because the transaction that will
    // commit the charge is holding it; (2) so the undo is still waiting rather than deciding on
    // a history it cannot see. With the lock in an outer transaction, both flip.
    const [{ free }] = await prisma.$queryRaw<Array<{ free: boolean }>>`
      SELECT pg_try_advisory_xact_lock(hashtextextended(${campaignApprovalLockKey(id)}, 0::bigint)) AS free`;
    expect(free).toBe(false);
    expect(undoSettled).toBe(false);

    closeWindow();
    const [dispatchResult, undoResult] = await Promise.all([charging, undoing]);
    expect(dispatchResult).toBe("charged");
    expect(undoResult).toEqual({ error: ALREADY_DISPATCHED });

    const state = await raceState(id, projectId, entryId);
    expect(state).toEqual({ charged: true, approved: true });
    // The one state that must never exist, asserted as itself.
    expect(state.charged && !state.approved).toBe(false);
  });

  it("undo arriving first wins, and the dispatch that follows spends nothing", async () => {
    const entryId = testId();
    const id = await seedCampaign(orgA, { entries: [{ id: entryId, date: "2026-08-25", status: "approved" }] });
    const projectId = await seedBatchProject(id);

    expect(await unapproveCampaignEntry({ campaignId: id, entryId })).toMatchObject({ ok: true });

    let dispatched = false;
    let refusal: unknown = null;
    try {
      await prisma.$transaction(async (tx) => {
        await applyCampaignApprovalGate(tx, approvalGate(id, entryId));
        dispatched = true;
        await writeCharge(tx, id, projectId, entryId, "d");
      });
    } catch (error) {
      refusal = campaignApprovalGateRefusal(error);
      if (refusal === null) throw error;
    }

    expect(dispatched).toBe(false);
    expect(refusal).toEqual({ error: CAMPAIGN_PLAN_CHANGED_MID_DISPATCH, disposition: "conflict" });
    const state = await raceState(id, projectId, entryId);
    expect(state).toEqual({ charged: false, approved: false });
    expect(state.charged && !state.approved).toBe(false);
  });

  it("refuses the charge — before it is written — when the plan cannot be re-read under the lock", async () => {
    const entryId = testId();
    const id = await seedCampaign(orgA, { entries: [{ id: entryId, date: "2026-08-25", status: "approved" }] });
    const projectId = await seedBatchProject(id);

    // "We could not check" is not "it was fine". The gate runs before create/reserve, so a
    // failed check stops the charge instead of guessing that the approval still stands.
    let dispatched = false;
    let refusal: unknown = null;
    try {
      await prisma.$transaction(async (tx) => {
        await applyCampaignApprovalGate(
          { $executeRaw: tx.$executeRaw.bind(tx), campaign: { findFirst: async () => { throw new Error("plan re-read unavailable"); } } } as never,
          approvalGate(id, entryId),
        );
        dispatched = true;
        await writeCharge(tx, id, projectId, entryId, "e");
      });
    } catch (error) {
      refusal = campaignApprovalGateRefusal(error);
      if (refusal === null) throw error;
    }

    expect(dispatched).toBe(false);
    expect(refusal).toEqual({ error: CAMPAIGN_APPROVAL_CHECK_UNKNOWN, disposition: "retryable" });
    const state = await raceState(id, projectId, entryId);
    expect(state).toEqual({ charged: false, approved: true });
    expect(state.charged && !state.approved).toBe(false);
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
    expect(await removeCampaignEntry({ campaignId: id, entryId })).toEqual({ error: "Campaign not found." });
    expect(await deleteCampaign({ campaignId: id })).toEqual({ error: "Campaign not found." });

    const row = await readCampaign(id, orgA);
    expect(row?.name).toBe("Merdeka gift-box launch");
    expect(row?.status).toBe("ACTIVE");
    expect(row?.deletedAt).toBeNull();
    expect(entryStatuses(row?.planJson)).toEqual({ [entryId]: "approved" });
  });
});
