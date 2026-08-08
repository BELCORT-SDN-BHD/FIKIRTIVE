/**
 * #718 / #717 — a segment a merchant can build must be a segment the merchant can remove,
 * rename away from, and tell apart from its neighbours.
 *
 * REAL-DATABASE behaviour tests: two real organizations, the real Prisma client, the real
 * server actions. Every write is re-read straight from the database, so an action that only
 * pretends (optimistic list update, revalidate-and-hope) fails here — a deleted segment must
 * still be gone after a fresh list, and the soft-deleted row must really carry deletedAt.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

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

const A_EMAIL = `segA-${randomUUID()}@fikirtive.test`;
const B_EMAIL = `segB-${randomUUID()}@fikirtive.test`;
beforeAll(() => {
  process.env.AUTH_ALLOWED_EMAILS = `${A_EMAIL},${B_EMAIL}`;
  process.env.FOUNDER_ADMIN_EMAILS = "noone@fikirtive.test";
  process.env.BETTER_AUTH_SECRET ||= "segment-lifecycle-test-secret";
});

const { requireOwner } = await import("@/lib/auth-guard");
const { prisma } = await import("@fikirtive/db");
const { buildSegment, deleteSegment, getSegment, listSegments } = await import("@/lib/segment-actions");

function asUser(email: string) { mockAuth.mockResolvedValue({ user: { email } }); }
async function ensureUser(email: string) {
  return prisma.user.upsert({ where: { email }, update: {}, create: { id: `usr_${randomUUID()}`, email } });
}

const RULES = {
  match: "all" as const,
  rules: [{ kind: "contactability" as const, value: "contactable" as const }],
};

let orgA: string, orgB: string;

beforeAll(async () => {
  await ensureUser(A_EMAIL); await ensureUser(B_EMAIL);
  asUser(A_EMAIL); const a = await requireOwner(); if ("error" in a) throw new Error(a.error); orgA = a.ownerId;
  asUser(B_EMAIL); const b = await requireOwner(); if ("error" in b) throw new Error(b.error); orgB = b.ownerId;
  expect(orgA).not.toBe(orgB);
});

/** Create through the real action, so the draft proof path is exercised too. */
async function createSegment(name: string): Promise<string> {
  const list = await listSegments();
  if (!("ok" in list)) throw new Error(list.error);
  const result = await buildSegment({
    operation: "create",
    segmentId: list.nextSegmentId,
    segmentProof: list.nextSegmentProof,
    name,
    rules: RULES,
  });
  if (!("ok" in result)) throw new Error(`seed failed: ${result.error}`);
  return list.nextSegmentId;
}

async function readSegment(id: string, ownerId: string) {
  return prisma.segment.findFirst({
    where: { id, ownerId },
    select: { name: true, kind: true, deletedAt: true },
  });
}

async function listedIds(): Promise<string[]> {
  const list = await listSegments();
  if (!("ok" in list)) throw new Error(list.error);
  return list.segments.map((segment) => segment.id);
}

beforeEach(() => { asUser(A_EMAIL); });

// ────────────────────────────────────────────────────────────────────────────
describe("#718 a segment can be removed, and it stays removed", () => {
  it("drops out of the list, does not come back on refresh, and keeps its row for the record", async () => {
    const id = await createSegment(`Deletable ${randomUUID()}`);
    expect(await listedIds()).toContain(id);

    expect(await deleteSegment({ segmentId: id })).toMatchObject({ ok: true, idempotent: false });

    // 1. the list really shrank …
    expect(await listedIds()).not.toContain(id);
    // 2. … a fresh read does not resurrect it …
    expect(await getSegment(id)).toEqual({ error: "Segment not found." });
    // 3. … and the row survives with deletedAt set (soft delete, not a hard wipe).
    const row = await readSegment(id, orgA);
    expect(row).not.toBeNull();
    expect(row?.deletedAt).toBeInstanceOf(Date);
  });

  it("deleting twice is idempotent", async () => {
    const id = await createSegment(`Twice ${randomUUID()}`);
    expect(await deleteSegment({ segmentId: id })).toMatchObject({ ok: true, idempotent: false });
    expect(await deleteSegment({ segmentId: id })).toMatchObject({ ok: true, idempotent: true });
  });

  it("refuses an id that does not belong to this merchant", async () => {
    expect(await deleteSegment({ segmentId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" })).toEqual({ error: "Segment not found." });
  });
});

describe("#718 duplicate names are refused so the list stays readable", () => {
  it("refuses a second segment with the same name, and nothing is written", async () => {
    const name = `WhatsApp big spenders ${randomUUID()}`;
    await createSegment(name);

    const list = await listSegments();
    if (!("ok" in list)) throw new Error(list.error);
    const clash = await buildSegment({
      operation: "create",
      segmentId: list.nextSegmentId,
      segmentProof: list.nextSegmentProof,
      name,
      rules: RULES,
    });
    expect(clash).toEqual({ error: "You already have a segment with this name. Choose a different name." });
    expect(await readSegment(list.nextSegmentId, orgA)).toBeNull();
  });

  it("compares names case-insensitively and ignoring surrounding space", async () => {
    const name = `Repeat buyers ${randomUUID()}`;
    await createSegment(name);
    const list = await listSegments();
    if (!("ok" in list)) throw new Error(list.error);
    const clash = await buildSegment({
      operation: "create",
      segmentId: list.nextSegmentId,
      segmentProof: list.nextSegmentProof,
      name: `  ${name.toUpperCase()}  `,
      rules: RULES,
    });
    expect(clash).toEqual({ error: "You already have a segment with this name. Choose a different name." });
  });

  it("refuses a rename onto another segment's name but allows saving a segment under its own name", async () => {
    const takenName = `Taken ${randomUUID()}`;
    await createSegment(takenName);
    const mine = await createSegment(`Mine ${randomUUID()}`);

    const clash = await buildSegment({ operation: "update", segmentId: mine, name: takenName, rules: RULES });
    expect(clash).toEqual({ error: "You already have a segment with this name. Choose a different name." });

    const own = await buildSegment({
      operation: "update",
      segmentId: mine,
      name: (await readSegment(mine, orgA))!.name,
      rules: RULES,
    });
    expect(own).toMatchObject({ ok: true });
  });

  it("frees the name again once the clashing segment is deleted", async () => {
    const name = `Reusable ${randomUUID()}`;
    const first = await createSegment(name);
    await deleteSegment({ segmentId: first });
    const second = await createSegment(name);
    expect((await readSegment(second, orgA))?.name).toBe(name);
  });

  it("another merchant may use the same segment name", async () => {
    const name = `Shared name ${randomUUID()}`;
    await createSegment(name);
    asUser(B_EMAIL);
    const mine = await createSegment(name);
    expect((await readSegment(mine, orgB))?.name).toBe(name);
  });
});

/**
 * #746 — #718's check reads first and writes second, so two requests can both be told the name
 * is free before either one writes. The unique index closes that window; these cases are about
 * what the merchant HEARS when it does, because a database constraint error is not a sentence.
 */
describe("#746 two saves at once still leave one segment, and the loser is told plainly", () => {
  const DUPLICATE = "You already have a segment with this name. Choose a different name.";

  async function draft() {
    const list = await listSegments();
    if (!("ok" in list)) throw new Error(list.error);
    return { segmentId: list.nextSegmentId, segmentProof: list.nextSegmentProof };
  }

  it("two concurrent creates of one name: one segment saved, one plain refusal, no raw error", async () => {
    const name = `Race ${randomUUID()}`;
    const [one, two] = [await draft(), await draft()];

    const results = await Promise.all([
      buildSegment({ operation: "create", ...one, name, rules: RULES }),
      buildSegment({ operation: "create", ...two, name, rules: RULES }),
    ]);

    expect(results.filter((result) => "ok" in result)).toHaveLength(1);
    expect(results.filter((result) => "error" in result)).toEqual([{ error: DUPLICATE }]);
    await expect(
      prisma.segment.count({ where: { ownerId: orgA, name, deletedAt: null } }),
    ).resolves.toBe(1);
  });

  it("a concurrent create that differs only by case is refused too", async () => {
    const name = `Case race ${randomUUID()}`;
    const [one, two] = [await draft(), await draft()];

    const results = await Promise.all([
      buildSegment({ operation: "create", ...one, name, rules: RULES }),
      buildSegment({ operation: "create", ...two, name: name.toUpperCase(), rules: RULES }),
    ]);

    expect(results.filter((result) => "ok" in result)).toHaveLength(1);
    expect(results.filter((result) => "error" in result)).toEqual([{ error: DUPLICATE }]);
    await expect(
      prisma.segment.count({
        where: { ownerId: orgA, name: { equals: name, mode: "insensitive" }, deletedAt: null },
      }),
    ).resolves.toBe(1);
  });
});

describe("#717 the segment name is bounded on the server, not only in the browser", () => {
  it("refuses a 300-character name and writes nothing", async () => {
    const list = await listSegments();
    if (!("ok" in list)) throw new Error(list.error);
    const result = await buildSegment({
      operation: "create",
      segmentId: list.nextSegmentId,
      segmentProof: list.nextSegmentProof,
      name: "N".repeat(300),
      rules: RULES,
    });
    expect(result).toEqual({ error: "Use 200 characters or fewer for the segment name." });
    expect(await readSegment(list.nextSegmentId, orgA)).toBeNull();
  });

  it("accepts a name at the 200-character boundary", async () => {
    const id = await createSegment("B".repeat(200));
    expect((await readSegment(id, orgA))?.name).toHaveLength(200);
  });

  it("refuses an over-long rename too", async () => {
    const id = await createSegment(`Renameable ${randomUUID()}`);
    const result = await buildSegment({ operation: "update", segmentId: id, name: "N".repeat(201), rules: RULES });
    expect(result).toEqual({ error: "Use 200 characters or fewer for the segment name." });
  });

  it("the page bounds the same field and lets its existing truncate actually work", () => {
    const source = readFileSync(new URL("../../components/crm/segments-page.tsx", import.meta.url), "utf8");
    // Same bound as the contact name field — one convention, not two.
    expect(source).toContain('id="segment-name"');
    expect(source).toContain("maxLength={200}");
    // The card button had no width constraint, so the inner `truncate` could never bite and
    // one long name pushed the whole 375px page into a permanent horizontal scroll.
    expect(source).toMatch(/min-h-16 w-full min-w-0 max-w-full rounded-xl border/);
  });
});

describe("tenant boundary — org B cannot delete org A's segment", () => {
  it("refuses the delete and leaves org A's row live", async () => {
    const id = await createSegment(`Org A only ${randomUUID()}`);

    asUser(B_EMAIL);
    expect(await deleteSegment({ segmentId: id })).toEqual({ error: "Segment not found." });

    const row = await readSegment(id, orgA);
    expect(row?.deletedAt).toBeNull();

    asUser(A_EMAIL);
    expect(await listedIds()).toContain(id);
  });
});
