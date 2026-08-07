/**
 * #679 — the getting-started card follows the SHOP, not one browser.
 *
 * It used to be gated on `localStorage["otto:onboarded"]`. A shop that had been open three
 * months met "Two quick things before your first project" again the first time it signed in on
 * a phone, and a shop that really did the two things was never told so. Neither fact was ever
 * written down anywhere the account could see.
 *
 * Proven against the real database, because the claim is "the dismissal is on the merchant's
 * own workspace row and another tenant's row never moves" — only a real read-back shows that.
 * The storage is `Organization.settings`, the tenant-scoped JSON column that already exists;
 * no schema change is involved.
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

const A_EMAIL = `p679-shopA-${randomUUID()}@fikirtive.test`;
const B_EMAIL = `p679-shopB-${randomUUID()}@fikirtive.test`;
beforeAll(() => {
  process.env.AUTH_ALLOWED_EMAILS = `${A_EMAIL},${B_EMAIL}`;
  process.env.FOUNDER_ADMIN_EMAILS = "noone@fikirtive.test";
});

const { requireOwner } = await import("@/lib/auth-guard");
const { prisma } = await import("@fikirtive/db");
const { getOwnerSettings, setOwnerSetting } = await import("@/lib/owner-settings-actions");
const { shouldShowOttoOnboarding, ottoOnboardingComplete } = await import("@/lib/otto-onboarding");

async function asUser(email: string | null) {
  mockAuth.mockResolvedValue(email ? { user: { email } } : null);
}
/** What a brand-new browser sees: nothing carried over, just the account's own server state. */
async function onNewDevice(email: string) {
  await asUser(email);
  const settings = await getOwnerSettings();
  if ("error" in settings) throw new Error(settings.error);
  return settings.ottoOnboardingDismissed;
}

let orgA: string, orgB: string;

beforeAll(async () => {
  await prisma.user.upsert({ where: { email: A_EMAIL }, update: {}, create: { id: `usr_${randomUUID()}`, email: A_EMAIL } });
  await prisma.user.upsert({ where: { email: B_EMAIL }, update: {}, create: { id: `usr_${randomUUID()}`, email: B_EMAIL } });
  await asUser(A_EMAIL); const a = await requireOwner(); if ("error" in a) throw new Error(a.error); orgA = a.ownerId;
  await asUser(B_EMAIL); const b = await requireOwner(); if ("error" in b) throw new Error(b.error); orgB = b.ownerId;
  expect(orgA).not.toBe(orgB);
});

// ───────────────────────────────────────────────────────────────────────────────
describe("#679 — dismissing the card is recorded against the merchant's workspace", () => {
  it("a workspace that has never dismissed it starts undismissed", async () => {
    expect(await onNewDevice(A_EMAIL)).toBe(false);
    expect(await onNewDevice(B_EMAIL)).toBe(false);
  });

  it("dismissing writes to the merchant's own org row", async () => {
    await asUser(A_EMAIL);
    expect(await setOwnerSetting("ottoOnboardingDismissed", true)).toEqual({ ok: true });
    const row = await prisma.organization.findUnique({ where: { id: orgA }, select: { settings: true } });
    expect((row?.settings as Record<string, unknown>).ottoOnboardingDismissed).toBe(true);
  });

  it("a brand-new device signing into the same account does NOT see the card again", async () => {
    // The reproduction from the ticket: dismiss, then come back with zero client state.
    // RED before #679: nothing was written server-side, so this read had nothing to find and
    // the card returned in every fresh browser context.
    expect(await onNewDevice(A_EMAIL)).toBe(true);
    expect(
      shouldShowOttoOnboarding({
        dismissed: await onNewDevice(A_EMAIL),
        hasStuff: false,
        hasBrandMemory: false,
        hasStartedWork: false,
      }),
    ).toBe(false);
  });

  it("the other shop is untouched — and still gets its own first run", async () => {
    expect(await onNewDevice(B_EMAIL)).toBe(false);
    const rowB = await prisma.organization.findUnique({ where: { id: orgB }, select: { settings: true } });
    expect((rowB?.settings as Record<string, unknown> | null)?.ottoOnboardingDismissed ?? false).toBe(false);
    expect(
      shouldShowOttoOnboarding({ dismissed: false, hasStuff: false, hasBrandMemory: false, hasStartedWork: false }),
    ).toBe(true);
  });

  it("shop B dismissing its own card does not un-dismiss shop A's, or vice versa", async () => {
    await asUser(B_EMAIL);
    expect(await setOwnerSetting("ottoOnboardingDismissed", true)).toEqual({ ok: true });
    expect(await onNewDevice(A_EMAIL)).toBe(true); // A still dismissed
    expect(await onNewDevice(B_EMAIL)).toBe(true); // B now dismissed too, on its own row
  });

  it("no session at all cannot dismiss anybody's card", async () => {
    await asUser(null);
    expect(await setOwnerSetting("ottoOnboardingDismissed", true)).toEqual({ error: "Not authorized." });
    expect(await getOwnerSettings()).toEqual({ error: "Not authorized." });
  });

  it("the merchant's other settings survive the dismissal write", async () => {
    await asUser(A_EMAIL);
    expect(await setOwnerSetting("timezone", "Asia/Singapore")).toEqual({ ok: true });
    expect(await setOwnerSetting("ottoOnboardingDismissed", true)).toEqual({ ok: true });
    const settings = await getOwnerSettings();
    expect(settings).toMatchObject({ timezone: "Asia/Singapore", ottoOnboardingDismissed: true });
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe("#679 — who the card is for, decided from workspace facts", () => {
  type Facts = Parameters<typeof shouldShowOttoOnboarding>[0];
  const facts = (over: Partial<Facts> = {}): Facts => ({
    dismissed: false,
    hasStuff: false,
    hasBrandMemory: false,
    hasStartedWork: false,
    ...over,
  });

  it.each([
    ["a brand-new workspace", facts(), true],
    ["one task done — the card stays, with that task ticked", facts({ hasStuff: true }), true],
    ["the other task done", facts({ hasBrandMemory: true }), true],
    ["both tasks done — the card retires itself", facts({ hasStuff: true, hasBrandMemory: true }), false],
    ["the merchant closed it", facts({ dismissed: true }), false],
    ["closed AND both done", facts({ dismissed: true, hasStuff: true, hasBrandMemory: true }), false],
    [
      "an established shop that never did either task, on a new phone",
      facts({ hasStartedWork: true }),
      false,
    ],
    [
      "an established shop that did both, on a new phone",
      facts({ hasStartedWork: true, hasStuff: true, hasBrandMemory: true }),
      false,
    ],
  ])("%s → shows card: %s", (_case, input, expected) => {
    expect(shouldShowOttoOnboarding(input as Facts)).toBe(expected);
  });

  it("completion means BOTH things, never just one", () => {
    expect(ottoOnboardingComplete({ hasStuff: true, hasBrandMemory: false })).toBe(false);
    expect(ottoOnboardingComplete({ hasStuff: false, hasBrandMemory: true })).toBe(false);
    expect(ottoOnboardingComplete({ hasStuff: true, hasBrandMemory: true })).toBe(true);
  });
});

afterAll(async () => {
  const both = [orgA, orgB].filter(Boolean);
  const purge = async (step: (id: string) => Promise<unknown>) => {
    for (const id of both) {
      try { await step(id); } catch { /* best-effort cleanup */ }
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
