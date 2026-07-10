/**
 * Integration tests for the L0 量测原语 DB-level uniqueness invariants
 * (migration 20260710111648_l0_measurement_primitives, PR-L0a).
 *
 * Three load-bearing indexes are exercised against a REAL *_test Postgres (enforced by
 * test/setup.ts) with migrations deployed — the only guardian of the two hand-appended
 * partial-unique indexes (invisible to typecheck AND to the schema-drift gate, so they
 * "stay owned by tests" per the drift-gate comment in .github/workflows/ci.yml):
 *
 *   1. TrackedLink_domain_slug_live   — UNIQUE (domain, slug) WHERE deletedAt IS NULL.
 *      Redirect resolves (domain, slug) → link regardless of owner (clicker is anonymous),
 *      so the slug namespace is global-per-domain (server mints/validates unique — 防跨租户
 *      枚举, spec §四.4). Soft-deleted rows free the slug for re-mint.
 *   2. VoucherToken_owner_code_live   — UNIQUE (ownerId, code) WHERE deletedAt IS NULL.
 *      每 owner 一个活码; two owners may share a code, soft-delete frees it (spec §2.3).
 *   3. AttributionEvent_ownerId_idempotencyKey_key — UNIQUE (ownerId, idempotencyKey),
 *      non-partial (idempotencyKey NOT NULL), Prisma-modeled @@unique mirroring
 *      CreditLedger. 精确一次 / 防重放: a duplicate webhook/scan lands exactly one row
 *      (spec §四.5, acceptance #6). Per-owner, so two owners may reuse a key.
 *
 * The global beforeEach in test/setup.ts truncates Organization CASCADE, which cascades
 * to every L0 table (all FK → Organization), so each test starts clean.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "./index.js";

const ORG_A = "l0-uniq-org-a";
const ORG_B = "l0-uniq-org-b";

async function seedOrgs(): Promise<void> {
  await prisma.organization.create({ data: { id: ORG_A } });
  await prisma.organization.create({ data: { id: ORG_B } });
}

beforeEach(async () => {
  await seedOrgs();
});

function createLink(
  id: string,
  ownerId: string,
  domain: string,
  slug: string,
  deletedAt: Date | null = null,
) {
  return prisma.trackedLink.create({
    data: {
      id,
      ownerId,
      domain,
      slug,
      targetUrl: "https://wa.me/60123456789",
      targetKind: "wa",
      source: "owner",
      deletedAt,
    },
  });
}

function createVoucher(
  id: string,
  ownerId: string,
  code: string,
  deletedAt: Date | null = null,
) {
  return prisma.voucherToken.create({
    data: { id, ownerId, code, source: "owner", deletedAt },
  });
}

function createEvent(id: string, ownerId: string, idempotencyKey: string) {
  return prisma.attributionEvent.create({
    data: { id, ownerId, kind: "scan", evidence: "observed", idempotencyKey },
  });
}

describe("TrackedLink live (domain, slug) uniqueness index", () => {
  it("rejects a second LIVE link with the same (domain, slug) — even across owners (global-per-domain slug)", async () => {
    // Redirect resolves by (domain, slug) with the clicker anonymous, so the namespace is
    // owner-agnostic: a second live link with the same domain+slug collides regardless of
    // which owner mints it (防跨租户枚举 / no ambiguous redirect target).
    await createLink("tl1", ORG_A, "r.fkrtv.co", "raya-h7");
    await expect(createLink("tl2", ORG_B, "r.fkrtv.co", "raya-h7")).rejects.toMatchObject({
      code: "P2002",
    });
  });

  it("allows the same slug on a different domain (multi-domain ready)", async () => {
    await createLink("tl1", ORG_A, "r.fkrtv.co", "raya-h7");
    await expect(createLink("tl2", ORG_A, "go.fkrtv.co", "raya-h7")).resolves.toMatchObject({
      id: "tl2",
    });
  });

  it("does NOT block re-minting a slug after the prior link was soft-deleted (partial WHERE)", async () => {
    await createLink("tl1", ORG_A, "r.fkrtv.co", "raya-h7", new Date());
    await expect(createLink("tl2", ORG_A, "r.fkrtv.co", "raya-h7")).resolves.toMatchObject({
      id: "tl2",
    });
  });
});

describe("VoucherToken live (ownerId, code) uniqueness index", () => {
  it("rejects a second LIVE voucher with the same code for the same owner (每 owner 一个活码)", async () => {
    await createVoucher("v1", ORG_A, "RAYA-9F3K");
    await expect(createVoucher("v2", ORG_A, "RAYA-9F3K")).rejects.toMatchObject({ code: "P2002" });
  });

  it("allows two owners to hold the same code (per-owner scope, not global)", async () => {
    await createVoucher("v1", ORG_A, "RAYA-9F3K");
    await expect(createVoucher("v2", ORG_B, "RAYA-9F3K")).resolves.toMatchObject({ id: "v2" });
  });

  it("does NOT block re-issuing a code after the prior voucher was soft-deleted (partial WHERE)", async () => {
    await createVoucher("v1", ORG_A, "RAYA-9F3K", new Date());
    await expect(createVoucher("v2", ORG_A, "RAYA-9F3K")).resolves.toMatchObject({ id: "v2" });
  });
});

describe("AttributionEvent (ownerId, idempotencyKey) exactly-once index (防重放)", () => {
  it("rejects a duplicate idempotencyKey for the same owner with P2002 (double webhook / double scan lands one row)", async () => {
    await createEvent("ae1", ORG_A, "scan:dedup-abc");
    await expect(createEvent("ae2", ORG_A, "scan:dedup-abc")).rejects.toMatchObject({
      code: "P2002",
    });
  });

  it("allows the same idempotencyKey for a different owner (per-owner scope — no cross-tenant collision)", async () => {
    await createEvent("ae1", ORG_A, "redeem:voucher-1");
    await expect(createEvent("ae2", ORG_B, "redeem:voucher-1")).resolves.toMatchObject({
      id: "ae2",
    });
  });
});
