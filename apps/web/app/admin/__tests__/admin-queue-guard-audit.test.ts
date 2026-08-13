/**
 * #779 judge r1, P2-3 — what `/admin/queue` really does to the database.
 *
 * The PR claimed "zero database access". That was true of the METRICS layer and false of the
 * complete call chain: `requireRole` reads `UserRole`, and on a refusal it writes an
 * `rbac.deny` row to `ActionEvent` (`auth-guard.ts`). The route test next door mocks
 * `@/lib/auth-guard` wholesale, so it could never have caught the difference — it was the
 * claim agreeing with itself.
 *
 * Here the guard is REAL. Only the two inputs that need a live HTTP request are mocked — the
 * session and the invite allowlist — following `lib/__tests__/admin-role-authority.test.ts`.
 * So the refusal below travels the real capability check into the real database, and the audit
 * row it leaves behind is observed rather than assumed.
 *
 * This test does not ask for the write to change. The audit trail is the platform's existing
 * security behaviour, shared by every gated admin surface; #779 only has to describe it
 * honestly.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

const TAG = "queue-audit";
const DENIED = `${TAG}-viewer@fikirtive.test`;

/** The signed-in address for the request under test. */
let sessionEmail: string | null = null;

vi.mock("@/lib/better-auth/compat", () => ({
  auth: async () => (sessionEmail ? { user: { email: sessionEmail, name: null, image: null, role: "viewer" } } : null),
  isImpersonating: async () => false,
}));
vi.mock("@/lib/allowlist", () => ({
  allowed: async (email: string | null | undefined) => Boolean(email),
  isFounderAdmin: () => false,
}));

const { prisma } = await import("@fikirtive/db");

/** Audit rows this file caused, matched on the address every fixture here tags. */
async function ownAuditRows() {
  const rows = await prisma.actionEvent.findMany({
    where: { ownerId: "founder", type: "rbac.deny" },
    select: { id: true, payload: true },
  });
  return rows.filter((row) => {
    const bag = row.payload as { email?: unknown } | null;
    return typeof bag?.email === "string" && bag.email.startsWith(`${TAG}-`);
  });
}

beforeAll(async () => {
  await prisma.organization.upsert({
    where: { id: "founder" },
    update: {},
    create: { id: "founder", name: "Fikirtive" },
  });
  // "moderator" holds content.* and nothing else — so `system.read` is a genuine refusal by the
  // real capability matrix, not by an absent user row.
  const user = await prisma.user.create({ data: { email: DENIED, name: TAG, role: "super-admin" }, select: { id: true } });
  await prisma.userRole.create({ data: { userId: user.id, role: "moderator" } });
});

afterAll(async () => {
  const mine = await ownAuditRows();
  if (mine.length > 0) await prisma.actionEvent.deleteMany({ where: { id: { in: mine.map((row) => row.id) } } });
  await prisma.userRole.deleteMany({ where: { user: { email: DENIED } } });
  await prisma.user.deleteMany({ where: { email: DENIED } });
});

describe("#779 /admin/queue against the real capability gate", () => {
  it("refuses a session without system.read, and the refusal writes the platform audit row", async () => {
    sessionEmail = DENIED;
    const before = (await ownAuditRows()).length;
    const page = (await import("../queue/page")).default;

    let redirectedTo: string | null = null;
    try {
      await page();
    } catch (error) {
      const parts = ((error as { digest?: string }).digest ?? "").split(";");
      redirectedTo = parts.length > 2 ? parts[2] : null;
    }

    expect(redirectedTo).toBe("/login?from=/admin/queue");
    // The write is the EXISTING security audit trail. Named, not silently inherited.
    expect((await ownAuditRows()).length).toBe(before + 1);
  });

  it("records the section and action that were refused, so the trail is readable", async () => {
    sessionEmail = DENIED;
    const page = (await import("../queue/page")).default;
    await page().catch(() => {});

    const latest = (await ownAuditRows()).at(-1);
    const payload = latest?.payload as { section?: string; action?: string; roles?: string[] };

    expect(payload.section).toBe("system");
    expect(payload.action).toBe("read");
    expect(payload.roles).toEqual(["moderator"]);
  });
});
