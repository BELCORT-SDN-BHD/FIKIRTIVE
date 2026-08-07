/**
 * #743 judge r1 (P1) — "read-only system frame" must be a MECHANISM, not a comment.
 *
 * The first cut of `admin:platform-read` claimed read-only and pointed at the guard's
 * `SYSTEM_SCAN_OPS`. That check lives inside the tenant layer, which returns early for every
 * model outside TENANT_MODELS — so the frame could still write `CreditAccount` / `CreditLedger`,
 * `RuntimeConfig` and the deliberately exempt models, and raw SQL was never inspected at all.
 * Nothing was actually mis-written (the admin block only reads), but "we looked and it only
 * reads" is an audit, not an invariant.
 *
 * These tests are the invariant. Each one FAILS on the commit that introduced the frame.
 *
 * They run against the real Prisma client with the real extension chain — the guard cannot be
 * unit-tested off the client, because being ON the client is the whole claim.
 */
import { describe, it, expect } from "vitest";
import { prisma } from "../index.js";
import { runAsSystem, runAsTenant, runAsUser, type UserPrincipal } from "../principal.js";

const ADMIN = "admin:platform-read";
/** The message every refusal carries, so a test cannot pass on some unrelated throw. */
const REFUSED = /refused under the read-only system frame/;

function merchantPrincipal(ownerId: string): UserPrincipal {
  return {
    kind: "user",
    subjectUserId: `usr_${ownerId}`,
    subjectEmail: `${ownerId}@fikirtive.test`,
    ownerId,
    orgRole: "owner",
    membershipId: `mem_${ownerId}`,
    impersonating: false,
    impersonatedByBaUserId: null,
  };
}

describe("#743 — a read-only system frame writes NOTHING, whatever the model", () => {
  it("refuses a write to a TENANT_MODELS table", async () => {
    await expect(
      runAsSystem(ADMIN, async () =>
        prisma.project.updateMany({ where: { id: "p1" }, data: { name: "renamed" } }),
      ),
    ).rejects.toThrow(REFUSED);
  });

  it("refuses a create on a GUARD-EXEMPT model (ActionEvent)", async () => {
    // The audit log is exempt from tenant scoping by design — which is exactly why the old
    // check could never see it. An exempt model is exempt from SCOPING, not from read-only.
    await expect(
      runAsSystem(ADMIN, async () =>
        prisma.actionEvent.create({
          data: { id: "evt_readonly_probe", ownerId: "founder", type: "probe" },
        }),
      ),
    ).rejects.toThrow(REFUSED);
  });

  it("refuses a write to a model the tenant guard never inspects (RuntimeConfig)", async () => {
    await expect(
      runAsSystem(ADMIN, async () =>
        prisma.runtimeConfig.upsert({
          where: { key: "cowork_provider" },
          create: { key: "cowork_provider", valueJson: { probe: true } },
          update: { valueJson: { probe: true } },
        }),
      ),
    ).rejects.toThrow(REFUSED);
  });

  it("refuses a write to the money tables (CreditAccount / CreditLedger)", async () => {
    await expect(
      runAsSystem(ADMIN, async () =>
        prisma.creditAccount.updateMany({ where: { orgId: "founder" }, data: { balance: 999999 } }),
      ),
    ).rejects.toThrow(REFUSED);
    await expect(
      runAsSystem(ADMIN, async () =>
        prisma.creditLedger.deleteMany({ where: { orgId: "founder" } }),
      ),
    ).rejects.toThrow(REFUSED);
  });

  it("refuses raw SQL — reads included, because a raw string is opaque", async () => {
    await expect(
      runAsSystem(ADMIN, async () => prisma.$executeRawUnsafe(`UPDATE "CreditAccount" SET balance = 0`)),
    ).rejects.toThrow(REFUSED);
    await expect(
      runAsSystem(ADMIN, async () => prisma.$queryRaw`SELECT 1`),
    ).rejects.toThrow(REFUSED);
  });

  it("refuses a write nested in the DATA of an outer write verb", async () => {
    // A nested relation write has no verb of its own — it rides inside `update`/`create`.
    // Refusing the outer verb is what makes the nest unreachable; this pins that reasoning.
    await expect(
      runAsSystem(ADMIN, async () =>
        prisma.organization.update({
          where: { id: "founder" },
          data: { memberships: { create: { id: "mem_probe", userId: "usr_probe", role: "owner" } } },
        }),
      ),
    ).rejects.toThrow(REFUSED);
  });

  it("refuses a write smuggled inside an interactive transaction", async () => {
    await expect(
      runAsSystem(ADMIN, async () =>
        prisma.$transaction(async (tx) => {
          await tx.runtimeConfig.updateMany({ where: {}, data: { valueJson: { probe: true } } });
        }),
      ),
    ).rejects.toThrow(REFUSED);
  });

  it("keeps refusing after the frame names a tenant (runAsTenant inherits the reason)", async () => {
    // Naming a tenant inside the admin frame must not launder the restriction away.
    await expect(
      runAsSystem(ADMIN, async () =>
        runAsTenant("org_a", async () =>
          prisma.project.updateMany({ where: { id: "p1" }, data: { name: "renamed" } }),
        ),
      ),
    ).rejects.toThrow(REFUSED);
  });

  it("refuses to open a writable USER frame from inside itself", async () => {
    await expect(
      runAsSystem(ADMIN, async () =>
        runAsUser(merchantPrincipal("org_a"), async () =>
          prisma.project.updateMany({ where: { id: "p1" }, data: { name: "renamed" } }),
        ),
      ),
    ).rejects.toThrow(/read-only system frame cannot open a user frame/);
  });
});

describe("#743 — reads under the read-only frame still work", () => {
  it("scans across tenants, which is the whole point of the frame", async () => {
    await expect(
      runAsSystem(ADMIN, async () => prisma.genJob.groupBy({ by: ["status"], _count: { _all: true } })),
    ).resolves.toBeDefined();
    await expect(
      runAsSystem(ADMIN, async () => prisma.creditAccount.findMany({ take: 1 })),
    ).resolves.toBeDefined();
    await expect(
      runAsSystem(ADMIN, async () => prisma.chatThread.findUnique({ where: { id: "missing" } })),
    ).resolves.toBeNull();
  });
});

describe("#743 REGRESSION PINBOARD — every other system frame still writes", () => {
  /** The worker lives on these. If this block ever goes red, the fix has broken production
   *  background work, not tightened it. */
  it("a worker reaper's tenant-scoped write is untouched", async () => {
    await prisma.organization.upsert({
      where: { id: "org_readonly_regression" },
      update: {},
      create: { id: "org_readonly_regression", name: "regression" },
    });

    await expect(
      runAsSystem("gen-reaper", async () =>
        runAsTenant("org_readonly_regression", async () =>
          prisma.project.updateMany({ where: { id: "nope" }, data: { name: "x" } }),
        ),
      ),
    ).resolves.toEqual({ count: 0 });
  });

  it("a tenant-less system frame's raw SQL and exempt-model write are untouched", async () => {
    await expect(
      runAsSystem("worker-reaper-tick", async () => prisma.$queryRaw`SELECT 1`),
    ).resolves.toBeDefined();
    await expect(
      runAsSystem("worker-job-dispatch", async () =>
        prisma.actionEvent.deleteMany({ where: { id: "never_exists" } }),
      ),
    ).resolves.toEqual({ count: 0 });
  });

  it("an unframed caller is unaffected — the old backstop is the only thing judging it", async () => {
    await expect(prisma.$queryRaw`SELECT 1`).resolves.toBeDefined();
    await expect(
      prisma.project.updateMany({ where: { id: "p1" }, data: { name: "x" } }),
    ).rejects.toThrow(/has no ownerId filter/);
  });
});
