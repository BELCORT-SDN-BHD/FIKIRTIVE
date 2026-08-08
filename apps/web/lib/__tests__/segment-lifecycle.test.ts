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

const DUPLICATE = "You already have a segment with this name. Choose a different name.";

async function draft() {
  const list = await listSegments();
  if (!("ok" in list)) throw new Error(list.error);
  return { segmentId: list.nextSegmentId, segmentProof: list.nextSegmentProof };
}

/**
 * #746 — #718's check reads first and writes second, so two requests can both be told the name
 * is free before either one writes. The unique index closes that window; these cases are about
 * what the merchant HEARS when it does, because a database constraint error is not a sentence.
 *
 * THE BARRIER (judge r1, P3). `Promise.all` alone does not prove the race: the first request can
 * finish outright before the second even reads, and then the second is refused by its own
 * pre-check — the assertions below pass without the index ever being consulted. So both writes
 * are held at a two-party gate: no create reaches the database until BOTH requests have arrived
 * at one. Arriving there is itself the proof that both pre-checks read zero — a pre-check that
 * saw the clash returns the sentence and never gets to a write. `arrived` is asserted, so a run
 * where only one request made it is a failure with a plain reason, not a quiet pass.
 */
function holdBothWrites() {
  let release!: () => void;
  const open = new Promise<void>((resolve) => (release = resolve));
  const state = { arrived: 0, releasedBy: "" };
  // Fail-safe: if the second request never arrives, let the first through anyway so the suite
  // reports a failed assertion instead of hanging until the runner's timeout.
  const failSafe = setTimeout(() => {
    if (!state.releasedBy) state.releasedBy = "fail-safe";
    release();
  }, 10_000);

  const original = prisma.segment.create;
  const patched = async (args: Parameters<typeof original>[0]) => {
    if (++state.arrived === 2) {
      state.releasedBy = "barrier";
      release();
    }
    await open;
    return original.call(prisma.segment, args);
  };
  // Prisma types `create` as a generic that infers its return shape from `args`; a wrapper that
  // only delays and delegates cannot restate that, so the stub goes back through `unknown`.
  prisma.segment.create = patched as unknown as typeof original;

  return {
    state,
    release() {
      clearTimeout(failSafe);
      prisma.segment.create = original;
    },
  };
}

describe("#746 two saves at once still leave one segment, and the loser is told plainly", () => {
  it("two concurrent creates of one name: one segment saved, one plain refusal, no raw error", async () => {
    const name = `Race ${randomUUID()}`;
    const [one, two] = [await draft(), await draft()];
    const gate = holdBothWrites();

    let results;
    try {
      results = await Promise.all([
        buildSegment({ operation: "create", ...one, name, rules: RULES }),
        buildSegment({ operation: "create", ...two, name, rules: RULES }),
      ]);
    } finally {
      gate.release();
    }

    // The race really happened: both pre-checks read zero, and only then was either write let go.
    expect(gate.state.arrived, "both saves must reach the write for this to be the index's race").toBe(2);
    expect(gate.state.releasedBy).toBe("barrier");

    expect(results.filter((result) => "ok" in result)).toHaveLength(1);
    expect(results.filter((result) => "error" in result)).toEqual([{ error: DUPLICATE }]);
    await expect(
      prisma.segment.count({ where: { ownerId: orgA, name, deletedAt: null } }),
    ).resolves.toBe(1);
  });

  it("a concurrent create that differs only by case is refused too", async () => {
    const name = `Case race ${randomUUID()}`;
    const [one, two] = [await draft(), await draft()];
    const gate = holdBothWrites();

    let results;
    try {
      results = await Promise.all([
        buildSegment({ operation: "create", ...one, name, rules: RULES }),
        buildSegment({ operation: "create", ...two, name: name.toUpperCase(), rules: RULES }),
      ]);
    } finally {
      gate.release();
    }

    expect(gate.state.arrived, "both saves must reach the write for this to be the index's race").toBe(2);
    expect(gate.state.releasedBy).toBe("barrier");

    expect(results.filter((result) => "ok" in result)).toHaveLength(1);
    expect(results.filter((result) => "error" in result)).toEqual([{ error: DUPLICATE }]);
    await expect(
      prisma.segment.count({
        where: { ownerId: orgA, name: { equals: name, mode: "insensitive" }, deletedAt: null },
      }),
    ).resolves.toBe(1);
  });
});

/**
 * #746 judge r1, P2 — the pre-check asks the database "is this name taken?" through Prisma's
 * `{ equals, mode: "insensitive" }`, which compiles to `name ILIKE $n`. ILIKE is a PATTERN match,
 * so `%` and `_` typed by the merchant were read as wildcards: with "VIP buyers 4f2…" on file,
 * the name "VIP %4f2…" matched it and was refused although nobody held it. Names are data, not
 * patterns, and the index compares them literally — so the pre-check must too.
 *
 * Both directions are asserted on purpose. The "allowed" half is the bug being fixed; the
 * "still refused" half is what pins the fix to reality — if Prisma ever stopped emitting ILIKE,
 * the escaping would start corrupting exact comparisons, and that half would go red.
 */
describe("#746 a name containing % or _ is compared literally, never as a pattern", () => {
  it("allows a name that only clashes when read as a wildcard pattern", async () => {
    const token = randomUUID();
    await createSegment(`VIP buyers ${token}`);

    // As a pattern this matches the row above; as a name it is nobody's.
    const wildcard = await buildSegment({ operation: "create", ...(await draft()), name: `VIP %${token}`, rules: RULES });
    expect(wildcard).toMatchObject({ ok: true });

    await createSegment(`AXC ${token}`);
    const underscore = await buildSegment({ operation: "create", ...(await draft()), name: `A_C ${token}`, rules: RULES });
    expect(underscore).toMatchObject({ ok: true });
  });

  it("allows a plain name that an existing wildcard-looking name would match", async () => {
    const token = randomUUID();
    await createSegment(`A_C ${token}`);

    const plain = await buildSegment({ operation: "create", ...(await draft()), name: `AXC ${token}`, rules: RULES });
    expect(plain).toMatchObject({ ok: true });
  });

  it("still refuses a real duplicate of a name made of %, _ and a backslash", async () => {
    const name = `50% off A_C back\\slash ${randomUUID()}`;
    await createSegment(name);

    const clash = await buildSegment({ operation: "create", ...(await draft()), name, rules: RULES });
    expect(clash).toEqual({ error: DUPLICATE });
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
