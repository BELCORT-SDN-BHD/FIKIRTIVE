/**
 * #734 / #755 judge r1 P1-1 + P2-1 — the roster and the gate, checked against each other.
 *
 * WHY THIS FILE EXISTS SEPARATELY. `app/admin/__tests__/admin-identity-truth.test.ts` mocks
 * `@/lib/auth-guard` wholesale, so any "display matches authorization" claim made there is the
 * read model agreeing with itself. Here the ONLY things mocked are the two inputs that need a
 * live HTTP request — the session (`better-auth/compat`) and the invite allowlist. `requireRole`
 * itself is the real function, reading the real `UserRole` rows out of a real database and
 * running the real capability check. So the two sides of every assertion below come from
 * genuinely different code paths:
 *
 *   display side  →  getAdminV2Data().staff.rows        (what the founder is shown)
 *   gate side     →  await requireRole(section, action) (what actually happens when they act)
 *
 * The coverage the previous round was missing: every one of the 8 sections × both actions, for
 * each of the 5 roles held alone, a two-role holder, an unknown-value holder, and a merchant
 * with no assignment at all.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { ROLES, SECTION_MATRIX, type Role, type Section } from "@fikirtive/core";

/**
 * The eight admin sections, written out rather than imported.
 *
 * Two reasons. First, this test is meant to state its expectation independently of the code under
 * test (#755 judge r1, P2-1). Second, `@fikirtive/core`'s barrel exports `SECTIONS` from
 * `memory-sections.ts`, NOT from `roles.ts` — the role-section list of the same name is shadowed,
 * so importing it here silently yields memory sections. The staleness risk of writing the list
 * out is closed by `covers every admin section` below.
 */
const ALL_SECTIONS = [
  "model", "cost", "content", "team", "system", "knowledge", "credits", "tenants",
] as const satisfies readonly Section[];

/** The signed-in address for the request under test. Set per assertion. */
let sessionEmail: string | null = null;

vi.mock("@/lib/better-auth/compat", () => ({
  auth: async () => (sessionEmail ? { user: { email: sessionEmail, name: null, image: null, role: "viewer" } } : null),
  isImpersonating: async () => false,
}));
// The allowlist is the INVITE gate, not the role authority — it is upstream of the subject here.
vi.mock("@/lib/allowlist", () => ({
  allowed: async (email: string | null | undefined) => Boolean(email),
  isFounderAdmin: (email: string | null | undefined) => email === "authority-super@fikirtive.test",
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { prisma } = await import("@fikirtive/db");
const { requireRole } = await import("@/lib/auth-guard");
const { getAdminV2Data } = await import("@/lib/admin-v2");
const { saveUserRole } = await import("@/lib/admin-actions");

const TAG = "authority";
const email = (name: string) => `${TAG}-${name}@fikirtive.test`;

/** One fixture per shape the roster has to describe correctly. */
const PEOPLE: { name: string; assigned: string[]; expected: Role[] }[] = [
  ...ROLES.map((role) => ({ name: role, assigned: [role], expected: [role] })),
  { name: "multi", assigned: ["ops", "finance"], expected: ["ops", "finance"] },
  // A stored value outside the vocabulary grants nothing, so the roster must not show it.
  { name: "unknown-value", assigned: ["ops", "wizard"], expected: ["ops"] },
  // A merchant: a real account with no platform assignment at all.
  { name: "merchant", assigned: [], expected: [] },
];

const userIds = new Map<string, string>();

beforeAll(async () => {
  await prisma.organization.upsert({
    where: { id: "founder" },
    update: {},
    create: { id: "founder", name: "Fikirtive" },
  });
  for (const person of PEOPLE) {
    const row = await prisma.user.create({
      // `User.role` is set to a DELIBERATELY WRONG value everywhere: if anything downstream still
      // reads the legacy column, these tests fail loudly instead of passing by coincidence.
      data: { email: email(person.name), name: person.name, role: "super-admin" },
      select: { id: true },
    });
    userIds.set(person.name, row.id);
    for (const role of person.assigned) {
      await prisma.userRole.create({ data: { userId: row.id, role } });
    }
  }
});

afterAll(async () => {
  const ids = [...userIds.values()];
  await prisma.userRole.deleteMany({ where: { userId: { in: ids } } });
  await prisma.actionEvent.deleteMany({ where: { type: "rbac.role.set", ownerId: "founder", payload: { path: ["via"], equals: email("super-admin") } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  sessionEmail = null;
});

describe("#755 P2-1 — what the roster shows is what the gate does", () => {
  it("covers every admin section", () => {
    // Closes the staleness hole in the hand-written list above: add a ninth section to the
    // product and this fails until the coverage below is extended to it.
    expect([...ALL_SECTIONS].sort()).toEqual(Object.keys(SECTION_MATRIX).sort());
  });

  it("agrees on every section and both actions, for every fixture", async () => {
    sessionEmail = email("super-admin");
    const data = await getAdminV2Data();

    let checks = 0;
    for (const person of PEOPLE) {
      const address = email(person.name);
      const shown = data.staff.rows.find((row) => row.email === address);

      // A person with no usable assignment is not staff and is not listed.
      if (person.expected.length === 0) {
        expect(shown, `${person.name} must not appear on the roster`).toBeUndefined();
      } else {
        expect(shown, `${person.name} must appear on the roster`).toBeTruthy();
        expect([...shown!.roles].sort()).toEqual([...person.expected].sort());
      }

      // Now ask the REAL gate, as that person, for every capability in the system.
      sessionEmail = address;
      for (const section of ALL_SECTIONS) {
        for (const action of ["read", "mutate"] as const) {
          const verdict = await requireRole(section, action);
          const gateAllows = !("error" in verdict);
          // The roster's own claim, read off the rendered data rather than recomputed from the
          // database: these are the roles the founder can see on the page.
          const rosterAllows = expectedAllows(shown?.roles ?? [], section, action);
          expect(
            gateAllows,
            `${person.name} · ${section}.${action}: roster says ${rosterAllows}, gate says ${gateAllows}`,
          ).toBe(rosterAllows);
          checks += 1;
        }
      }
    }
    // 8 sections × 2 actions × 9 fixtures — the previous round checked 12 cells on one user.
    expect(checks).toBe(ALL_SECTIONS.length * 2 * PEOPLE.length);
  });

  it("refuses someone whose only claim is the legacy User.role column", async () => {
    // Every fixture carries `User.role = "super-admin"`. The merchant holds no UserRole row.
    const merchant = email("merchant");
    const stored = await prisma.user.findUnique({ where: { email: merchant }, select: { role: true } });
    expect(stored?.role, "fixture precondition").toBe("super-admin");

    sessionEmail = merchant;
    expect(await requireRole("system", "read")).toEqual({ error: "You don't have access to this." });
    expect(await requireRole("team", "mutate")).toEqual({ error: "You don't have access to this." });
  });
});

describe("#755 P1-1 — a role edit applies the submitted SET", () => {
  it("keeps the role the operator did not touch", async () => {
    sessionEmail = email("super-admin");
    const targetId = userIds.get("multi")!;

    // What the staff editor now submits: the complete set, with moderator added.
    const result = await saveUserRole({ userId: targetId, roles: ["ops", "finance", "moderator"] });
    expect(result).toEqual({ ok: true });

    const after = await prisma.userRole.findMany({ where: { userId: targetId }, select: { role: true } });
    expect(after.map((r) => r.role).sort()).toEqual(["finance", "moderator", "ops"]);
  });

  it("preserves when an untouched role was granted, instead of resetting it on every save", async () => {
    sessionEmail = email("super-admin");
    const targetId = userIds.get("multi")!;
    const before = await prisma.userRole.findUnique({
      where: { userId_role: { userId: targetId, role: "finance" } },
      select: { assignedAt: true },
    });

    // Touch a DIFFERENT role. "Since when has this person held finance?" must survive it.
    await saveUserRole({ userId: targetId, roles: ["ops", "finance"] });

    const after = await prisma.userRole.findUnique({
      where: { userId_role: { userId: targetId, role: "finance" } },
      select: { assignedAt: true },
    });
    expect(after?.assignedAt).toEqual(before?.assignedAt);
  });

  it("removes exactly what the set dropped", async () => {
    sessionEmail = email("super-admin");
    const targetId = userIds.get("multi")!;
    await saveUserRole({ userId: targetId, roles: ["ops"] });
    const after = await prisma.userRole.findMany({ where: { userId: targetId }, select: { role: true } });
    expect(after.map((r) => r.role)).toEqual(["ops"]);
  });

  it("says which mistake was made when the set is empty", async () => {
    sessionEmail = email("super-admin");
    const targetId = userIds.get("ops")!;
    expect(await saveUserRole({ userId: targetId, roles: [] })).toEqual({
      error: "Select at least one role.",
    });
    // Nothing was stripped on the way to that refusal.
    const after = await prisma.userRole.findMany({ where: { userId: targetId }, select: { role: true } });
    expect(after.map((r) => r.role)).toEqual(["ops"]);
  });

  it("still rejects a value outside the role vocabulary", async () => {
    sessionEmail = email("super-admin");
    const targetId = userIds.get("ops")!;
    expect(await saveUserRole({ userId: targetId, roles: ["ops", "wizard"] })).toEqual({
      error: "Unknown role.",
    });
    const after = await prisma.userRole.findMany({ where: { userId: targetId }, select: { role: true } });
    expect(after.map((r) => r.role)).toEqual(["ops"]);
  });
});

/**
 * What the ROSTER claims, derived from the rendered role list.
 *
 * Written out as an explicit table rather than by calling `rolesAllow`, so this side of the
 * comparison does not borrow the very function the gate uses — that was the #755 judge's P2-1
 * finding: the equation proved itself. If `PLATFORM_ROLE_CAPABILITIES` and this table ever
 * disagree, one of them is wrong and the test says so.
 */
const CAPABILITIES: Record<Role, ReadonlySet<string>> = {
  "super-admin": new Set(
    ALL_SECTIONS.flatMap((s) => [`${s}.read`, `${s}.mutate`]),
  ),
  ops: new Set(["model.read", "model.mutate", "system.read", "system.mutate", "knowledge.read", "knowledge.mutate"]),
  finance: new Set(["cost.read", "credits.read", "credits.mutate"]),
  moderator: new Set(["content.read", "content.mutate"]),
  viewer: new Set(["model.read", "system.read", "knowledge.read"]),
};

function expectedAllows(roles: readonly string[], section: Section, action: "read" | "mutate"): boolean {
  return roles.some((role) => CAPABILITIES[role as Role]?.has(`${section}.${action}`));
}
