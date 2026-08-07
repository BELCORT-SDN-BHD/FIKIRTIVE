/**
 * #715 — the contacts list and the segments page must never give a merchant two different
 * answers to "how many customers do I have", and neither surface may truncate in silence.
 *
 * Real-database behaviour test: seeds 65 contacts (one of them a known opt-out) for a fresh
 * owner, then reads through the same code paths the two pages use.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const mockAuth = vi.fn();
vi.mock("@/lib/better-auth/compat", () => ({
  auth: mockAuth,
  isImpersonating: async () => false,
}));
vi.mock("@/lib/allowlist", () => {
  function allowed(email: string | null | undefined): boolean {
    if (!email) return false;
    const list = `${process.env.FOUNDER_ADMIN_EMAILS ?? ""},${process.env.AUTH_ALLOWED_EMAILS ?? ""}`
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
    return list.includes(email.toLowerCase());
  }
  function isFounderAdmin(email: string | null | undefined): boolean {
    if (!email) return false;
    const list = (process.env.FOUNDER_ADMIN_EMAILS ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
    return list.includes(email.toLowerCase());
  }
  return { allowed, isFounderAdmin, isAllowedEmail: allowed };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const OWNER_EMAIL = `crm-count-a-${randomUUID()}@fikirtive.test`;
const OTHER_EMAIL = `crm-count-b-${randomUUID()}@fikirtive.test`;
beforeAll(() => {
  process.env.AUTH_ALLOWED_EMAILS = `${OWNER_EMAIL},${OTHER_EMAIL}`;
  process.env.FOUNDER_ADMIN_EMAILS = "noone@fikirtive.test";
  process.env.BETTER_AUTH_SECRET ??= "crm-count-honesty-test-secret";
});

const { requireOwner } = await import("@/lib/auth-guard");
const { prisma } = await import("@fikirtive/db");
const { listContacts } = await import("@/lib/crm-view-data");
const { listSegments, previewSegment } = await import("@/lib/segment-actions");
const ContactsPage = (await import("@/components/crm/contacts-page")).default;
const segmentsModule = await import("@/components/crm/segments-page");
const SegmentsPage = segmentsModule.default;
const { ContactPreview } = segmentsModule;

/** 65 live contacts: 64 reachable + a single known opt-out. */
const SEEDED = 65;
const CONTACTABLE = 64;

async function asUser(email: string) {
  mockAuth.mockResolvedValue({ user: { email } });
}

async function ensureOwner(email: string): Promise<string> {
  await prisma.user.upsert({
    where: { email },
    update: {},
    create: { id: `usr_${randomUUID()}`, email },
  });
  await asUser(email);
  const gate = await requireOwner();
  if ("error" in gate) throw new Error(gate.error);
  return gate.ownerId;
}

let ownerId: string;
let otherOwnerId: string;

beforeAll(async () => {
  ownerId = await ensureOwner(OWNER_EMAIL);
  otherOwnerId = await ensureOwner(OTHER_EMAIL);
  expect(ownerId).not.toBe(otherOwnerId);

  const base = Date.parse("2026-08-01T00:00:00.000Z");
  await prisma.contact.createMany({
    data: Array.from({ length: SEEDED }, (_, index) => ({
      id: `con_${randomUUID()}`,
      ownerId,
      name: `Bulk Contact ${String(index).padStart(3, "0")}`,
      lifecycleStage: "Active",
      source: "manual",
      firstTouchAt: new Date(base),
      // Five contacts share each lastSeenAt, so the 50-row page boundary lands inside a tie
      // group — the position the second page resumes from has to break ties by id.
      lastSeenAt: new Date(base + Math.floor(index / 5) * 60_000),
      marketingConsent: index === 0 ? "opt_out" : "unknown",
    })),
  });
  // A second tenant's contacts must never leak into either number.
  await prisma.contact.createMany({
    data: Array.from({ length: 3 }, (_, index) => ({
      id: `con_${randomUUID()}`,
      ownerId: otherOwnerId,
      name: `Other tenant ${index}`,
      lifecycleStage: "Active",
      source: "manual",
      firstTouchAt: new Date(base),
      lastSeenAt: new Date(base + index * 60_000),
    })),
  });
});

describe("#715 contacts list tells the truth about truncation", () => {
  it("reports the real owner-scoped total next to the page it actually returned", async () => {
    await asUser(OWNER_EMAIL);
    const result = await listContacts();
    if (!("ok" in result)) throw new Error(result.error);

    expect(result.contacts).toHaveLength(50);
    expect(result.totalCount).toBe(SEEDED);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toEqual(expect.any(String));
  });

  it("hands back every remaining contact through the declared next page, with no gap or repeat", async () => {
    await asUser(OWNER_EMAIL);
    const first = await listContacts();
    if (!("ok" in first)) throw new Error(first.error);
    const second = await listContacts({ cursor: first.nextCursor });
    if (!("ok" in second)) throw new Error(second.error);

    expect(second.contacts).toHaveLength(SEEDED - 50);
    expect(second.totalCount).toBe(SEEDED);
    expect(second.hasMore).toBe(false);
    expect(second.nextCursor).toBeNull();

    const ids = [...first.contacts, ...second.contacts].map((contact) => contact.id);
    expect(new Set(ids).size).toBe(SEEDED);
  });

  it("keeps the total inside the tenant fence", async () => {
    await asUser(OTHER_EMAIL);
    const result = await listContacts();
    if (!("ok" in result)) throw new Error(result.error);

    expect(result.totalCount).toBe(3);
    expect(result.contacts.every((contact) => contact.name.startsWith("Other tenant"))).toBe(true);
  });

  it("counts only what the current filter selects", async () => {
    await asUser(OWNER_EMAIL);
    const result = await listContacts({ query: "Bulk Contact 06" });
    if (!("ok" in result)) throw new Error(result.error);

    expect(result.totalCount).toBe(5); // 060..064
    expect(result.hasMore).toBe(false);
  });

  it("says on screen how many of the total are on the page, and offers the rest", async () => {
    await asUser(OWNER_EMAIL);
    const result = await listContacts();
    if (!("ok" in result)) throw new Error(result.error);

    const markup = renderToStaticMarkup(createElement(ContactsPage, {
      initialState: result,
    } as ComponentProps<typeof ContactsPage>));

    expect(markup).toContain("Showing 50 of 65 contacts");
    expect(markup).toContain("Load more contacts");
  });
});

describe("#715 segments and contacts read one authority", () => {
  it("publishes the same owner total the contacts list publishes", async () => {
    await asUser(OWNER_EMAIL);
    const contacts = await listContacts();
    const segments = await listSegments();
    if (!("ok" in contacts)) throw new Error(contacts.error);
    if (!("ok" in segments)) throw new Error(segments.error);

    expect(segments.totalContactCount).toBe(SEEDED);
    expect(segments.totalContactCount).toBe(contacts.totalCount);
  });

  it("frames a preview match count against that same total and owns its 10-row cut", async () => {
    await asUser(OWNER_EMAIL);
    const preview = await previewSegment({
      match: "all",
      rules: [{ kind: "contactability", value: "contactable" }],
    });
    if (!("ok" in preview)) throw new Error(preview.error);

    expect(preview.matchedCount).toBe(CONTACTABLE);
    expect(preview.totalContactCount).toBe(SEEDED);
    // The preview list itself is still 10 rows — it must now be able to say so.
    expect(preview.contacts).toHaveLength(10);

    const markup = renderToStaticMarkup(createElement(ContactPreview, { preview }));
    expect(markup).toContain("64 of 65 contacts matched");
    expect(markup).toContain("Showing the first 10 of 64 matched contacts");
  });

  it("puts the same contact total on the segments page itself", async () => {
    await asUser(OWNER_EMAIL);
    const initialState = await listSegments();
    if (!("ok" in initialState)) throw new Error(initialState.error);

    const markup = renderToStaticMarkup(createElement(SegmentsPage, {
      initialState,
    } as ComponentProps<typeof SegmentsPage>));

    expect(markup).toContain("Contacts");
    expect(markup).toContain(">65<");
  });
});
