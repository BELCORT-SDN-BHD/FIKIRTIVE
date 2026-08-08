/**
 * #542 — merchant self-service rename, proven against the real database.
 *
 * WHY DB-BACKED AND NOT MOCKED. The claim under test is not "the code calls prisma.update
 * with the right where clause" — it is "org B cannot rename org A, and org A's row is still
 * intact afterwards". Only a real read-back of the victim's row proves that, so this file
 * uses the same two-real-organisations harness as isolation.test.ts / cross-tenant-write.ts:
 * both orgs are bootstrapped through the REAL requireOwner(), no principal is fabricated.
 *
 * THE TENANT SHAPE HERE IS UNUSUAL, AND THAT IS THE POINT. updateDisplayName and
 * updateWorkspaceName take ONE argument: the new name. There is no userId and no orgId on
 * the wire to forge, because identity is resolved server-side from the session. The forged
 * -identity cases below therefore attack the only way an attacker actually could — by
 * passing extra arguments the signature does not declare — and assert that they are inert.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";

// Same mocks as the other two-org suites: auth() is controllable per-test, the allowlist is
// env-driven and inlined (no DB), and revalidatePath has no Next.js request context here.
const mockAuth = vi.fn();
vi.mock("@/lib/better-auth/compat", () => ({
  auth: mockAuth,
  // The rename actions block edits made while staff are impersonating a customer; these
  // tests are all real merchant sessions, so it is always false.
  isImpersonating: async () => false,
}));
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
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const A_EMAIL = `p542-orgA-${randomUUID()}@fikirtive.test`;
const B_EMAIL = `p542-orgB-${randomUUID()}@fikirtive.test`;
beforeAll(() => {
  process.env.AUTH_ALLOWED_EMAILS = `${A_EMAIL},${B_EMAIL}`;
  process.env.FOUNDER_ADMIN_EMAILS = "noone@fikirtive.test"; // neither A nor B is founder
});

const { requireOwner } = await import("@/lib/auth-guard");
const { prisma } = await import("@fikirtive/db");
const { updateDisplayName, updateWorkspaceName } = await import("@/lib/profile-actions");
// The read is a plain server-only module, not a server action (nothing in the browser calls
// it) — but it is the same authority story, so it is proven in the same suite.
const { getMyProfileNames } = await import("@/lib/profile-names");

async function asUser(email: string | null) {
  mockAuth.mockResolvedValue(email ? { user: { email } } : null);
}
async function ensureUser(email: string) {
  return prisma.user.upsert({ where: { email }, update: {}, create: { id: `usr_${randomUUID()}`, email } });
}
const orgName = (id: string) => prisma.organization.findUnique({ where: { id }, select: { name: true } }).then((o) => o?.name);
const userName = (email: string) => prisma.user.findUnique({ where: { email }, select: { name: true } }).then((u) => u?.name);

let orgA: string, orgB: string;

beforeAll(async () => {
  await ensureUser(A_EMAIL);
  await ensureUser(B_EMAIL);
  await asUser(A_EMAIL); const a = await requireOwner(); if ("error" in a) throw new Error(a.error); orgA = a.ownerId;
  await asUser(B_EMAIL); const b = await requireOwner(); if ("error" in b) throw new Error(b.error); orgB = b.ownerId;
  expect(orgA).not.toBe(orgB);
  // #680 — a merchant who came in without ever being asked for a shop name starts with NO
  // workspace name. This used to be their email address (the defect's starting state), which
  // /profile then showed back to them as "Your shop name". See workspace-name-not-email.test.ts.
  expect(await orgName(orgA)).toBe("");
});

// ───────────────────────────────────────────────────────────────────────────────
describe("#542 positive — a merchant renames themselves and their workspace", () => {
  it("updateDisplayName writes the signed-in user's OWN row", async () => {
    await asUser(A_EMAIL);
    expect(await userName(A_EMAIL)).toBeNull(); // the defect: User.name was never set
    expect(await updateDisplayName("  Aisha Rahman  ")).toEqual({ ok: true, name: "Aisha Rahman" });
    expect(await userName(A_EMAIL)).toBe("Aisha Rahman"); // trimmed, and really in the database
  });

  it("updateWorkspaceName replaces the email-address workspace name", async () => {
    await asUser(A_EMAIL);
    expect(await updateWorkspaceName("Kopi Corner")).toEqual({ ok: true, name: "Kopi Corner" });
    expect(await orgName(orgA)).toBe("Kopi Corner");
  });

  it("getMyProfileNames reads back exactly what was saved", async () => {
    await asUser(A_EMAIL);
    expect(await getMyProfileNames()).toEqual({
      displayName: "Aisha Rahman",
      workspaceName: "Kopi Corner",
      email: A_EMAIL,
    });
  });

  it("a name longer than the 80-character cap is stored trimmed to fit, and echoed back", async () => {
    await asUser(A_EMAIL);
    const long = "K".repeat(200);
    const res = await updateWorkspaceName(long);
    expect(res).toEqual({ ok: true, name: "K".repeat(80) });
    expect(await orgName(orgA)).toBe("K".repeat(80)); // the row is capped, not the 200 chars
    await updateWorkspaceName("Kopi Corner"); // restore for the isolation cases below
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe("#542 tenant isolation — org B can never reach org A's names", () => {
  it("org B renaming its workspace leaves org A's workspace untouched", async () => {
    await asUser(B_EMAIL);
    expect(await updateWorkspaceName("Bakery B")).toEqual({ ok: true, name: "Bakery B" });
    expect(await orgName(orgB)).toBe("Bakery B"); // B's own row moved …
    expect(await orgName(orgA)).toBe("Kopi Corner"); // … and A's did not
  });

  it("org B renaming itself leaves org A's user row untouched", async () => {
    await asUser(B_EMAIL);
    expect(await updateDisplayName("Ben")).toEqual({ ok: true, name: "Ben" });
    expect(await userName(B_EMAIL)).toBe("Ben");
    expect(await userName(A_EMAIL)).toBe("Aisha Rahman");
  });

  it("a FORGED orgId argument is inert — the write still lands on the caller's own org", async () => {
    // The attack a browser can actually drive: append org A's id to the action payload and
    // hope the server reads it. The signature has no such parameter, and `gate.ownerId` from
    // requireOwner() is the only id that reaches Prisma — so the extra argument does nothing.
    await asUser(B_EMAIL);
    const forge = updateWorkspaceName as unknown as (name: string, orgId: string) => Promise<unknown>;
    expect(await forge("pwned by B", orgA)).toEqual({ ok: true, name: "pwned by B" });
    expect(await orgName(orgA)).toBe("Kopi Corner"); // ← org A never moved
    expect(await orgName(orgB)).toBe("pwned by B"); // ← B renamed only itself
  });

  it("a FORGED email/userId argument is inert for the display name too", async () => {
    await asUser(B_EMAIL);
    const forge = updateDisplayName as unknown as (name: string, email: string) => Promise<unknown>;
    expect(await forge("pwned", A_EMAIL)).toEqual({ ok: true, name: "pwned" });
    expect(await userName(A_EMAIL)).toBe("Aisha Rahman"); // ← A's row never moved
    expect(await userName(B_EMAIL)).toBe("pwned"); // ← B renamed only itself
  });

  it("org B cannot read org A's names through getMyProfileNames", async () => {
    await asUser(B_EMAIL);
    const names = await getMyProfileNames();
    expect(names).toEqual({ displayName: "pwned", workspaceName: "pwned by B", email: B_EMAIL });
  });

  it("no session at all → refused, and nothing is written anywhere", async () => {
    await asUser(null);
    expect(await updateDisplayName("anonymous")).toEqual({ error: "Not authorized." });
    expect(await updateWorkspaceName("anonymous")).toEqual({ error: "Not authorized." });
    expect(await getMyProfileNames()).toEqual({ error: "Not authorized." });
    expect(await orgName(orgA)).toBe("Kopi Corner");
    expect(await orgName(orgB)).toBe("pwned by B");
    expect(await userName(A_EMAIL)).toBe("Aisha Rahman");
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe("#542 validation — an empty name is refused, and nothing is written", () => {
  it("an empty display name is refused", async () => {
    await asUser(A_EMAIL);
    expect(await updateDisplayName("")).toEqual({ error: "Name required." });
    expect(await userName(A_EMAIL)).toBe("Aisha Rahman"); // unchanged
  });

  it("a whitespace-only display name is refused (trim happens BEFORE the empty check)", async () => {
    await asUser(A_EMAIL);
    expect(await updateDisplayName("   \n\t  ")).toEqual({ error: "Name required." });
    expect(await userName(A_EMAIL)).toBe("Aisha Rahman");
  });

  it("an empty workspace name is refused", async () => {
    await asUser(A_EMAIL);
    expect(await updateWorkspaceName("")).toEqual({ error: "Workspace name required." });
    expect(await orgName(orgA)).toBe("Kopi Corner");
  });

  it("a whitespace-only workspace name is refused", async () => {
    await asUser(A_EMAIL);
    expect(await updateWorkspaceName("  ")).toEqual({ error: "Workspace name required." });
    expect(await orgName(orgA)).toBe("Kopi Corner");
  });
});

afterAll(async () => {
  // Only this run's two random identities; nothing outside them is ever touched. Credits →
  // membership → org → user, so no foreign key blocks the next step.
  const both = [orgA, orgB].filter(Boolean);
  const purge = async (step: (id: string) => Promise<unknown>) => {
    for (const id of both) {
      try { await step(id); } catch { /* best-effort cleanup — never fail the suite here */ }
    }
  };
  await purge((ownerId) => prisma.actionEvent.deleteMany({ where: { ownerId } }));
  await purge((orgId) => prisma.creditLedger.deleteMany({ where: { orgId } }));
  await purge((orgId) => prisma.creditAccount.deleteMany({ where: { orgId } }));
  await purge((orgId) => prisma.membership.deleteMany({ where: { orgId } }));
  await purge((orgId) => prisma.organization.deleteMany({ where: { id: orgId } }));
  try {
    await prisma.user.deleteMany({ where: { email: { in: [A_EMAIL, B_EMAIL] } } });
  } catch { /* best-effort cleanup */ }
});
