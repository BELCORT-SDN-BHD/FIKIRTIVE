// 本面自 PR #1152 起无路由挂载(/library 改画 components/library/LibraryView.tsx),围栏仅护组件本身；tidy 待登记。
/**
 * library-failure-copy-read-path — CREATE-A2, Codex QA-CRE-007, PR #1171 判官 P1-2 落修.
 *
 * `library-failure-human-copy.test.ts` mounts the CARD with an already-mapped `error` string
 * handed to it by a mock, and its own header (until this PR) claimed "data.ts has its own
 * coverage that it calls `merchantGenFailureCopy`" — a claim the judge's variant (b) disproved:
 * reverting `apps/web/lib/refgen-actions.ts:611` to `error: j.error ?? ""` left every existing
 * test green (`gh` comment 5532937549, 变异 (c)). Nothing had ever called the two DATA LAYER
 * functions — `getMyAdJobs` (`lib/data.ts:323`) and `getRefGenJobs` (`refgen-actions.ts:611`) —
 * against a REAL row and read back what they actually return.
 *
 * This file is that missing coverage: a real tenant, a real Postgres row with `status: "FAILED"`
 * (via `@fikirtive/db`'s Prisma client, guarded by `setup-db-guard.ts` to `*_test` databases
 * only — same recipe as `isolation.test.ts`), read through the real `getMyAdJobs` / real
 * `getRefGenJobs` — no mock on either. Two shapes of stored `error`, per function:
 *   - a STALE/legacy row whose `GenJob.error`/`RefGenJob.error` is still the pre-#765 raw ops
 *     diagnostic (what a job written before this fix, or by a worker throw site the fix missed,
 *     would have) — must map to the honest generic sentence, never leak the raw string;
 *   - a row written the way the fixed worker throw sites write it now — the reason code
 *     `REFERENCE_ASSET_UNREACHABLE` verbatim — must map to ITS specific sentence, not the generic
 *     fallback (proves the whitelist lookup actually fires, not just "didn't leak").
 * Every expected sentence is asserted via `merchantGenFailureCopy`/`GENERATION_DID_NOT_GO_THROUGH`
 * imported from `@fikirtive/core` — never retyped as a literal (Codex QA-CRE-007 P2: a retyped
 * literal silently stops asserting anything the day the sentence's wording changes).
 *
 * `ElementVariantsDialog.tsx:577` renders `problem.error` straight through with no card-level
 * fallback of its own (unlike `OttoStuff.tsx`'s `AdJobCard`) — `getRefGenJobs`'s mapping is the
 * ONLY guard on that surface, which is exactly why the judge flagged it P1-2 rather than the
 * lower-severity P1-1.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/lib/better-auth/compat", () => ({ auth: mockAuth, isImpersonating: () => false }));
vi.mock("@/lib/allowlist", () => {
  function allowed(email: string | null | undefined): boolean {
    if (!email) return false;
    const list = `${process.env.FOUNDER_ADMIN_EMAILS ?? ""},${process.env.AUTH_ALLOWED_EMAILS ?? ""}`.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    return list.includes(email.toLowerCase());
  }
  function isFounderAdmin(email: string | null | undefined): boolean {
    if (!email) return false;
    const list = (process.env.FOUNDER_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    return list.includes(email.toLowerCase());
  }
  return { allowed, isFounderAdmin, isAllowedEmail: allowed };
});

const OWNER_EMAIL = `library-failure-copy-${randomUUID()}@fikirtive.test`;
beforeAll(() => {
  process.env.AUTH_ALLOWED_EMAILS = OWNER_EMAIL;
  process.env.FOUNDER_ADMIN_EMAILS = "noone@fikirtive.test";
});

const { requireOwner } = await import("@/lib/auth-guard");
const { prisma } = await import("@fikirtive/db");
const data = await import("@/lib/data");
const refgen = await import("@/lib/refgen-actions");
const { REFERENCE_ASSET_UNREACHABLE, GENERATION_DID_NOT_GO_THROUGH, merchantGenFailureCopy } = await import("@fikirtive/core");

async function asOwner() { mockAuth.mockResolvedValue({ user: { email: OWNER_EMAIL } }); }

// A row written before #765 shipped (or by a worker throw site the fix missed) — the raw ops
// diagnostic that used to reach the merchant verbatim. Byte-identical to the string the judge's
// probe used (gh comment 5532937549, 第三节).
const STALE_RAW_DIAGNOSTIC = "conditioning refs unreachable (0/2) — refusing to spend";

let ownerId: string;
let projectId: string;
let entityId: string;
let genJobStaleId: string, genJobMappedId: string;
let refGenJobStaleId: string, refGenJobMappedId: string;

beforeAll(async () => {
  await prisma.user.upsert({ where: { email: OWNER_EMAIL }, update: {}, create: { id: `usr_${randomUUID()}`, email: OWNER_EMAIL } });
  await asOwner();
  const gate = await requireOwner();
  if ("error" in gate) throw new Error(gate.error);
  ownerId = gate.ownerId;

  projectId = `prj_${randomUUID()}`;
  await prisma.project.create({ data: { id: projectId, ownerId, name: "P1-2 read-path project" } });
  const entity = await prisma.entity.create({ data: { id: `ent_${randomUUID()}`, ownerId, name: "P1-2 read-path entity", type: "CHARACTER" } });
  entityId = entity.id;

  genJobStaleId = `gj_${randomUUID()}`;
  await prisma.genJob.create({
    data: {
      id: genJobStaleId, ownerId, projectId, threadId: `thr_${randomUUID()}`,
      prompt: "x", model: "seedream", kind: "IMAGE", count: 1, status: "FAILED",
      error: STALE_RAW_DIAGNOSTIC,
    },
  });
  genJobMappedId = `gj_${randomUUID()}`;
  await prisma.genJob.create({
    data: {
      id: genJobMappedId, ownerId, projectId, threadId: `thr_${randomUUID()}`,
      prompt: "x", model: "seedream", kind: "IMAGE", count: 1, status: "FAILED",
      error: REFERENCE_ASSET_UNREACHABLE,
    },
  });

  refGenJobStaleId = `rg_${randomUUID()}`;
  await prisma.refGenJob.create({
    data: { id: refGenJobStaleId, ownerId, entityId, prompt: "x", model: "seedream", mode: "BASE", count: 1, status: "FAILED", error: STALE_RAW_DIAGNOSTIC },
  });
  refGenJobMappedId = `rg_${randomUUID()}`;
  await prisma.refGenJob.create({
    data: { id: refGenJobMappedId, ownerId, entityId, prompt: "x", model: "seedream", mode: "BASE", count: 1, status: "FAILED", error: REFERENCE_ASSET_UNREACHABLE },
  });
});

afterAll(async () => {
  await prisma.refGenJob.deleteMany({ where: { ownerId, id: { in: [refGenJobStaleId, refGenJobMappedId] } } });
  await prisma.genJob.deleteMany({ where: { ownerId, id: { in: [genJobStaleId, genJobMappedId] } } });
  await prisma.entity.deleteMany({ where: { ownerId, id: entityId } });
  await prisma.project.deleteMany({ where: { ownerId, id: projectId } });
});

describe("CREATE-A2: lib/data.ts getMyAdJobs — real row, real read path (Codex QA-CRE-007, PR #1171 判官 P1-2)", () => {
  it("a stale row (pre-fix raw diagnostic) maps to the honest generic sentence, never the raw string", async () => {
    const jobs = await data.getMyAdJobs(ownerId, 50);
    const job = jobs.find((j) => j.id === genJobStaleId);
    expect(job, "seeded stale GenJob must come back from getMyAdJobs").toBeTruthy();
    expect(job!.error).toBe(merchantGenFailureCopy(STALE_RAW_DIAGNOSTIC));
    expect(job!.error).toBe(GENERATION_DID_NOT_GO_THROUGH);
    expect(job!.error).not.toContain("refusing to spend");
    expect(job!.error).not.toContain("unreachable (");
  });

  it("a REFERENCE_ASSET_UNREACHABLE row maps to its specific sentence, not the generic fallback", async () => {
    const jobs = await data.getMyAdJobs(ownerId, 50);
    const job = jobs.find((j) => j.id === genJobMappedId);
    expect(job, "seeded mapped GenJob must come back from getMyAdJobs").toBeTruthy();
    expect(job!.error).toBe(merchantGenFailureCopy(REFERENCE_ASSET_UNREACHABLE));
    expect(job!.error).toBe(REFERENCE_ASSET_UNREACHABLE);
    expect(job!.error).not.toBe(GENERATION_DID_NOT_GO_THROUGH);
  });
});

describe("CREATE-A2: lib/refgen-actions.ts getRefGenJobs — real row, real read path (Codex QA-CRE-007, PR #1171 判官 P1-2)", () => {
  it("a stale row (pre-fix raw diagnostic) maps to the honest generic sentence, never the raw string — the only guard in front of ElementVariantsDialog's problem line", async () => {
    await asOwner();
    const jobs = await refgen.getRefGenJobs(entityId);
    const job = jobs.find((j) => j.id === refGenJobStaleId);
    expect(job, "seeded stale RefGenJob must come back from getRefGenJobs").toBeTruthy();
    expect(job!.error).toBe(merchantGenFailureCopy(STALE_RAW_DIAGNOSTIC));
    expect(job!.error).toBe(GENERATION_DID_NOT_GO_THROUGH);
    expect(job!.error).not.toContain("refusing to spend");
    expect(job!.error).not.toContain("unreachable (");
  });

  it("a REFERENCE_ASSET_UNREACHABLE row maps to its specific sentence, not the generic fallback", async () => {
    await asOwner();
    const jobs = await refgen.getRefGenJobs(entityId);
    const job = jobs.find((j) => j.id === refGenJobMappedId);
    expect(job, "seeded mapped RefGenJob must come back from getRefGenJobs").toBeTruthy();
    expect(job!.error).toBe(merchantGenFailureCopy(REFERENCE_ASSET_UNREACHABLE));
    expect(job!.error).toBe(REFERENCE_ASSET_UNREACHABLE);
    expect(job!.error).not.toBe(GENERATION_DID_NOT_GO_THROUGH);
  });
});
