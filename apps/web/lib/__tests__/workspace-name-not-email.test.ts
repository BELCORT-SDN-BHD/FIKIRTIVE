/**
 * #680 — the magic-link door never asks for a shop name, so it must not invent one.
 *
 * Two doors, one of which asked: `/signup` has a Shop name field, `/login` (magic link and
 * invites) has nothing of the kind. The workspace was still given a name either way — for the
 * silent door, the merchant's own EMAIL ADDRESS — and /profile then rendered that address in
 * the "Workspace" field under the label "Your shop name — shown across Fikirtive." The merchant
 * read back, as a fact about their shop, a string they had never given.
 *
 * Proven against the real database, because the claim is about what a real bootstrap writes and
 * what a real read gives back — not about which arguments a function was called with.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";

const mockAuth = vi.fn();
vi.mock("@/lib/better-auth/compat", () => ({
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
    const list = (process.env.FOUNDER_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    return list.includes(email.toLowerCase());
  }
  return { allowed, isFounderAdmin, isAllowedEmail: allowed };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const MAGIC_LINK_EMAIL = `p680-magic-${randomUUID()}@fikirtive.test`;
const SIGNUP_EMAIL = `p680-signup-${randomUUID()}@fikirtive.test`;
const LEGACY_EMAIL = `p680-legacy-${randomUUID()}@fikirtive.test`;
const NEIGHBOUR_EMAIL = `p680-neighbour-${randomUUID()}@fikirtive.test`;
const ALL_EMAILS = [MAGIC_LINK_EMAIL, SIGNUP_EMAIL, LEGACY_EMAIL, NEIGHBOUR_EMAIL];

beforeAll(() => {
  process.env.AUTH_ALLOWED_EMAILS = ALL_EMAILS.join(",");
  process.env.FOUNDER_ADMIN_EMAILS = "noone@fikirtive.test";
});

const { bootstrapPersonalOrg } = await import("@/lib/auth-guard");
const { prisma } = await import("@fikirtive/db");
const { getMyProfileNames, workspaceNameOrUnset } = await import("@/lib/profile-names");
const { updateWorkspaceName } = await import("@/lib/profile-actions");

async function asUser(email: string | null) {
  mockAuth.mockResolvedValue(email ? { user: { email } } : null);
}
const ensureUser = (email: string, name?: string) =>
  prisma.user.upsert({
    where: { email },
    update: {},
    create: { id: `usr_${randomUUID()}`, email, name: name ?? null },
  });
const orgName = (id: string) =>
  prisma.organization.findUnique({ where: { id }, select: { name: true } }).then((o) => o?.name);

let magicOrg: string, signupOrg: string, legacyOrg: string, neighbourOrg: string;

beforeAll(async () => {
  // The silent door: an identity with no name at all, exactly what a magic-link sign-in makes.
  const magicUser = await ensureUser(MAGIC_LINK_EMAIL);
  magicOrg = (await bootstrapPersonalOrg(magicUser.id, MAGIC_LINK_EMAIL))!;

  // The door that asks: /signup carries the shop name on the account name.
  const signupUser = await ensureUser(SIGNUP_EMAIL, "Bunga Bakery");
  signupOrg = (await bootstrapPersonalOrg(signupUser.id, SIGNUP_EMAIL))!;

  // A workspace created BEFORE this fix, still carrying the address bootstrap used to write.
  const legacyUser = await ensureUser(LEGACY_EMAIL);
  legacyOrg = (await bootstrapPersonalOrg(legacyUser.id, LEGACY_EMAIL))!;
  await prisma.organization.update({ where: { id: legacyOrg }, data: { name: LEGACY_EMAIL } });

  const neighbourUser = await ensureUser(NEIGHBOUR_EMAIL, "Kopi Corner");
  neighbourOrg = (await bootstrapPersonalOrg(neighbourUser.id, NEIGHBOUR_EMAIL))!;
});

// ───────────────────────────────────────────────────────────────────────────────
describe("#680 — a workspace is never named after the merchant's address", () => {
  it("the magic-link door leaves the workspace name unset instead of writing the email", async () => {
    // RED before this fix: the row held MAGIC_LINK_EMAIL.
    expect(await orgName(magicOrg)).toBe("");
  });

  it("the signup door still names the workspace after the shop the merchant typed", async () => {
    expect(await orgName(signupOrg)).toBe("Bunga Bakery");
  });

  it("/profile shows an unset workspace as empty, so its placeholder asks for the shop name", async () => {
    await asUser(MAGIC_LINK_EMAIL);
    const names = await getMyProfileNames();
    expect(names).toEqual({ displayName: "", workspaceName: "", email: MAGIC_LINK_EMAIL });
    // The address is nowhere in what the page renders as a name.
    expect(JSON.stringify(names)).not.toContain(`"workspaceName":"${MAGIC_LINK_EMAIL}"`);
  });

  it("a workspace created before the fix reads back as unset, without rewriting the row", async () => {
    await asUser(LEGACY_EMAIL);
    const names = await getMyProfileNames();
    expect(names).toEqual({ displayName: "", workspaceName: "", email: LEGACY_EMAIL });
    // Read honestly, not migrated: the stored row is untouched by the read.
    expect(await orgName(legacyOrg)).toBe(LEGACY_EMAIL);
  });

  it("the merchant can set the shop name from /profile, and it reads back as given", async () => {
    await asUser(MAGIC_LINK_EMAIL);
    expect(await updateWorkspaceName("  Warung Nurul  ")).toEqual({ ok: true, name: "Warung Nurul" });
    expect(await getMyProfileNames()).toEqual({
      displayName: "",
      workspaceName: "Warung Nurul",
      email: MAGIC_LINK_EMAIL,
    });
  });

  it("renaming stays inside the caller's own tenant", async () => {
    await asUser(MAGIC_LINK_EMAIL);
    await updateWorkspaceName("Warung Nurul");
    expect(await orgName(neighbourOrg)).toBe("Kopi Corner"); // the neighbour never moved
    await asUser(NEIGHBOUR_EMAIL);
    expect(await getMyProfileNames()).toEqual({
      displayName: "Kopi Corner",
      workspaceName: "Kopi Corner",
      email: NEIGHBOUR_EMAIL,
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe("#680 — workspaceNameOrUnset only hides THIS account's own address", () => {
  const MINE = "owner@kopicorner.test";
  it.each([
    ["the account's own address", MINE, ""],
    ["the same address in a different case", "OWNER@KopiCorner.test", ""],
    ["the same address with stray whitespace", `  ${MINE}  `, ""],
    ["a real shop name", "Kopi Corner", "Kopi Corner"],
    ["a shop name the merchant chose that happens to be another address", "hello@kopicorner.test", "hello@kopicorner.test"],
    ["never set", "", ""],
    ["missing row", null, ""],
  ])("%s → %p", (_case, stored, expected) => {
    expect(workspaceNameOrUnset(stored as string | null, MINE)).toBe(expected);
  });
});

afterAll(async () => {
  const orgs = [magicOrg, signupOrg, legacyOrg, neighbourOrg].filter(Boolean);
  const purge = async (step: (id: string) => Promise<unknown>) => {
    for (const id of orgs) {
      try { await step(id); } catch { /* best-effort cleanup */ }
    }
  };
  await purge((ownerId) => prisma.actionEvent.deleteMany({ where: { ownerId } }));
  await purge((orgId) => prisma.creditLedger.deleteMany({ where: { orgId } }));
  await purge((orgId) => prisma.creditAccount.deleteMany({ where: { orgId } }));
  await purge((orgId) => prisma.membership.deleteMany({ where: { orgId } }));
  await purge((orgId) => prisma.organization.deleteMany({ where: { id: orgId } }));
  try {
    await prisma.user.deleteMany({ where: { email: { in: ALL_EMAILS } } });
  } catch { /* best-effort cleanup */ }
});
