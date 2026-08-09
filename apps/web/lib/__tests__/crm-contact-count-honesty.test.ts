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
const { listContacts, searchContacts } = await import("@/lib/crm-view-data");
const { contactPageForOtto } = await import("@/lib/otto-contact-view");
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
      // Seven contacts share each lastSeenAt. Read newest-first that lays out as 2, then
      // 7, 7, 7, 7, 7, 7, 7 — so rows 45..51 are one tie group and the 50-row page boundary
      // falls INSIDE it. The second page can only resume without losing rows 51 if the
      // cursor breaks the tie by id. (Group size must not divide 50: with 5 per group the
      // boundary lands between groups and the tie-break is never exercised.)
      lastSeenAt: new Date(base + Math.floor(index / 7) * 60_000),
      // #726: the known opt-out is expressed the only way that counts now — the legacy column
      // stays "unknown" for everyone, and the projection below is what excludes contact 0.
    })),
  });
  const optedOut = await prisma.contact.findFirstOrThrow({
    where: { ownerId, name: "Bulk Contact 000" },
    select: { id: true },
  });
  await prisma.consentStateProjection.create({
    data: {
      ownerId,
      contactId: optedOut.id,
      channel: "whatsapp",
      purpose: "marketing",
      state: "effective_revoke",
      lastEventId: `evt_${randomUUID()}`,
      lastReceivedAt: new Date(base),
      stateActorKind: "customer",
      stateSourceKind: "unsubscribe_link",
      evidenceStatus: "verified",
    },
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
  // Bootstrapping two orgs and inserting 68 rows is past vitest's 10s default hook budget on
  // a loaded runner.
}, 60_000);

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

    // The seeding is only a real tie-break test if the boundary sits inside a tie group:
    // last row of page one and first row of page two share a lastSeenAt, so only the id
    // comparison keeps row 51 from being skipped.
    expect(second.contacts[0].lastSeenAt.getTime())
      .toBe(first.contacts.at(-1)!.lastSeenAt.getTime());
  });

  it("refuses a cursor it did not issue instead of silently restarting at row one", async () => {
    await asUser(OWNER_EMAIL);

    await expect(listContacts({ cursor: "not-a-cursor" })).resolves.toEqual({
      error: "Refresh the contact list and try again.",
    });
    await expect(listContacts({ cursor: "not-a-date|con_1" })).resolves.toEqual({
      error: "Refresh the contact list and try again.",
    });
    await expect(listContacts({ cursor: 42 })).resolves.toEqual({
      error: "Refresh the contact list and try again.",
    });
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

/**
 * #742 — the same truncation, told to the other mouth.
 *
 * The page stopped lying in #715. Otto kept doing it: its contact port forwarded the 50 rows
 * and dropped the counts, so "how many customers do I have" was answered from a list that had
 * already been cut, and nothing in what Otto held said so. These run the REAL owner-scoped
 * read over the 65 seeded contacts and check the payload Otto is handed — not a mock of it.
 */
describe("#742 what Otto is handed admits the same cut the page admits", () => {
  it("states the page size and the owner-scoped total, not the page alone", async () => {
    await asUser(OWNER_EMAIL);
    const page = contactPageForOtto(await listContacts());
    if (!("ok" in page)) throw new Error(page.error);

    expect(page.contacts).toHaveLength(50);
    expect(page.returned).toBe(50);
    expect(page.totalCount).toBe(SEEDED);
    expect(page.hasMore).toBe(true);
  });

  it("publishes the very number the page prints, from the one read behind both", async () => {
    await asUser(OWNER_EMAIL);
    const result = await listContacts();
    if (!("ok" in result)) throw new Error(result.error);
    const page = contactPageForOtto(result);
    if (!("ok" in page)) throw new Error(page.error);

    const markup = renderToStaticMarkup(createElement(ContactsPage, {
      initialState: result,
    } as ComponentProps<typeof ContactsPage>));

    expect(markup).toContain(`Showing ${page.returned} of ${page.totalCount} contacts`);
  });

  it("says so out loud when nothing was cut, instead of going quiet either way", async () => {
    await asUser(OWNER_EMAIL);
    const page = contactPageForOtto(await listContacts({ query: "Bulk Contact 06" }));
    if (!("ok" in page)) throw new Error(page.error);

    expect(page.returned).toBe(5); // 060..064
    expect(page.totalCount).toBe(5);
    expect(page.hasMore).toBe(false);
  });

  it("truncates search the same way and owns it the same way", async () => {
    await asUser(OWNER_EMAIL);
    const page = contactPageForOtto(await searchContacts({ query: "Bulk Contact" }));
    if (!("ok" in page)) throw new Error(page.error);

    expect(page.returned).toBe(50);
    expect(page.totalCount).toBe(SEEDED);
    expect(page.hasMore).toBe(true);
  });

  it("counts inside the tenant fence — the total Otto quotes is this owner's own", async () => {
    await asUser(OTHER_EMAIL);
    const page = contactPageForOtto(await listContacts());
    if (!("ok" in page)) throw new Error(page.error);

    expect(page.totalCount).toBe(3);
    expect(page.returned).toBe(3);
    expect(page.hasMore).toBe(false);
    expect(page.contacts.every((contact) => contact.name.startsWith("Other tenant"))).toBe(true);
  });

  it("hands over dates as text without losing the counts on the way", async () => {
    await asUser(OWNER_EMAIL);
    const page = contactPageForOtto(await listContacts());
    if (!("ok" in page)) throw new Error(page.error);

    expect(page.contacts[0]!.lastSeenAt).toEqual(expect.any(String));
    expect(page.contacts[0]!.createdAt).toEqual(expect.any(String));
    expect(page.totalCount).toBe(SEEDED);
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
    // #819 — and it says so IN THE PAYLOAD, not only in the rendered sentence. Otto reads this
    // shape through the same action; without these two fields the ten rows it receives look
    // exactly like a complete answer to "who is in this segment".
    expect(preview.returned).toBe(10);
    expect(preview.hasMore).toBe(true);

    const markup = renderToStaticMarkup(createElement(ContactPreview, { preview }));
    expect(markup).toContain("64 of 65 contacts matched");
    expect(markup).toContain("Showing the first 10 of 64 matched contacts");
  });

  it("says a short match was NOT cut, instead of staying silent either way", async () => {
    // #819 — `hasMore: false` is the half that makes the fact worth trusting. A field that is
    // only ever true when it happens to be true carries no information when it is absent.
    await asUser(OWNER_EMAIL);
    const preview = await previewSegment({
      match: "all",
      rules: [{ kind: "contactability", value: "not_contactable" }],
    });
    if (!("ok" in preview)) throw new Error(preview.error);

    expect(preview.matchedCount).toBe(SEEDED - CONTACTABLE);
    expect(preview.returned).toBe(preview.matchedCount);
    expect(preview.hasMore).toBe(false);

    const markup = renderToStaticMarkup(createElement(ContactPreview, { preview }));
    expect(markup).not.toContain("Showing the first");
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
