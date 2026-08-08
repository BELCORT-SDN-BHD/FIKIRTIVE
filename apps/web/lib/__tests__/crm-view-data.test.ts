import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequireOwner, mockContactFindMany, mockContactFindFirst, mockContactCount } = vi.hoisted(() => ({
  mockRequireOwner: vi.fn(),
  mockContactFindMany: vi.fn(),
  mockContactFindFirst: vi.fn(),
  mockContactCount: vi.fn(),
}));

vi.mock("@/lib/auth-guard", () => ({ requireOwner: mockRequireOwner }));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    contact: {
      findMany: mockContactFindMany,
      findFirst: mockContactFindFirst,
      count: mockContactCount,
    },
  },
}));

import { getContact, listContacts, searchContacts } from "../crm-view-data";

const OWNER = "org-a";
const NOW = new Date("2026-07-19T08:00:00.000Z");

function dbContact(overrides: Record<string, unknown> = {}) {
  return {
    id: "contact-1",
    name: "Aisha",
    lifecycleStage: "Active",
    source: "manual",
    firstTouchCampaignId: null,
    firstTouchAt: NOW,
    lastSeenAt: NOW,
    doNotDisturb: false,
    totalOrdersMyr: null,
    createdAt: NOW,
    marketingConsent: null,
    identities: [],
    consentStateProjections: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOwner.mockResolvedValue({ ownerId: OWNER });
  mockContactFindMany.mockResolvedValue([]);
  mockContactFindFirst.mockResolvedValue(null);
  mockContactCount.mockResolvedValue(0);
});

describe("listContacts", () => {
  it("reads the owner-scoped WhatsApp marketing projection and preserves missing state as unknown", async () => {
    mockContactFindMany.mockResolvedValue([
      dbContact(),
      dbContact({
        id: "contact-2",
        name: "Bo",
        consentStateProjections: [{
          state: "verified_grant",
          stateSourceKind: "whatsapp_webhook",
          evidenceStatus: "verified",
          lastReceivedAt: NOW,
        }],
      }),
    ]);

    const result = await listContacts({ lifecycleStage: "Active", limit: 200 });

    expect(result).toMatchObject({
      ok: true,
      contacts: [
        { id: "contact-1", consentState: { state: "unknown", evidenceStatus: null } },
        { id: "contact-2", consentState: { state: "verified_grant", evidenceStatus: "verified" } },
      ],
    });
    const query = mockContactFindMany.mock.calls[0][0];
    expect(query.where).toMatchObject({ ownerId: OWNER, deletedAt: null, lifecycleStage: "Active" });
    // #752 — the legacy column IS read now, for the pre-ledger fence and nothing else. What it
    // must never do is stated as behaviour below, not as the absence of a select.
    expect(query.select.marketingConsent).toBe(true);
    expect(query.select.consentStateProjections.where).toEqual({
      ownerId: OWNER,
      channel: "whatsapp",
      purpose: "marketing",
    });
    expect(query.select.identities.where).toEqual({ ownerId: OWNER, deletedAt: null });
    // One row past the page size answers "is there more" (#715); the merchant still sees 100.
    expect(query.take).toBe(101);
    // The declared total is counted through the same owner-scoped filter as the page.
    expect(mockContactCount.mock.calls[0][0].where).toMatchObject({
      ownerId: OWNER,
      deletedAt: null,
      lifecycleStage: "Active",
    });
  });

  // #752 — the legacy column may only ever hold a contact OUT. This is the guarantee the old
  // "never select marketingConsent" assertion stood in for, now stated as behaviour: reading the
  // column cannot invent consent, and it only speaks while the ledger has said nothing.
  it("lets the pre-ledger column hold a contact out and never let one in", async () => {
    mockContactFindMany.mockResolvedValue([
      dbContact({ id: "held-out", marketingConsent: "opt_out" }),
      dbContact({ id: "not-let-in", marketingConsent: "opt_in" }),
      dbContact({
        id: "ledger-decided",
        marketingConsent: "opt_out",
        consentStateProjections: [{
          state: "verified_grant",
          stateSourceKind: "explicit_inbox_optin",
          evidenceStatus: "verified",
          lastReceivedAt: NOW,
        }],
      }),
    ]);

    const result = await listContacts({ limit: 10 });

    expect(result).toMatchObject({
      ok: true,
      contacts: [
        { id: "held-out", consentState: { state: "unknown", unresolvedLegacyOptOut: true } },
        { id: "not-let-in", consentState: { state: "unknown", unresolvedLegacyOptOut: false } },
        // The customer's own verified opt-in supersedes the stale byte (R-010 §4.6.4).
        { id: "ledger-decided", consentState: { state: "verified_grant", unresolvedLegacyOptOut: false } },
      ],
    });
  });

  it("keeps identity search inside the authenticated owner fence", async () => {
    await searchContacts({ query: "+6012", lifecycleStage: "New", limit: 10 });

    const query = mockContactFindMany.mock.calls[0][0];
    expect(query.where.ownerId).toBe(OWNER);
    expect(query.where.OR[1].identities.some).toMatchObject({ ownerId: OWNER, deletedAt: null });
    expect(query.where.OR[2].identities.some).toMatchObject({ ownerId: OWNER, deletedAt: null });
    expect(JSON.stringify(query)).not.toContain("org-b");
    expect(mockContactCount.mock.calls[0][0].where.ownerId).toBe(OWNER);
    expect(JSON.stringify(mockContactCount.mock.calls[0][0])).not.toContain("org-b");
  });
});

describe("getContact", () => {
  it("scopes the profile and reads consent history newest first without legacy consent fields", async () => {
    mockContactFindFirst.mockResolvedValue(dbContact({
      consentEvents: [{
        id: "event-2",
        channel: "whatsapp",
        purpose: "marketing",
        action: "revoke",
        actorKind: "merchant",
        entryMode: "backfill",
        sourceKind: "crm_manual",
        evidenceStatus: "asserted",
        occurredAt: null,
        receivedAt: NOW,
      }],
    }));

    const result = await getContact("contact-1");

    expect(result).toMatchObject({
      ok: true,
      contact: {
        id: "contact-1",
        consentEvents: [{ id: "event-2", sourceKind: "crm_manual", evidenceStatus: "asserted" }],
      },
    });
    const query = mockContactFindFirst.mock.calls[0][0];
    expect(query.where).toEqual({ id: "contact-1", ownerId: OWNER, deletedAt: null });
    // #752 — same one fence read as the list, so the two pages cannot disagree.
    expect(query.select.marketingConsent).toBe(true);
    expect(query.select.consentEvents.where).toEqual({ ownerId: OWNER });
    expect(query.select.consentEvents.orderBy).toEqual([
      { receivedAt: "desc" },
      { id: "desc" },
    ]);
  });

  it("does not disclose another tenant's contact", async () => {
    mockRequireOwner.mockResolvedValue({ ownerId: "org-b" });
    mockContactFindFirst.mockResolvedValue(null);

    await expect(getContact("org-a-contact")).resolves.toEqual({ error: "Contact not found." });
    expect(mockContactFindFirst.mock.calls[0][0].where).toEqual({
      id: "org-a-contact",
      ownerId: "org-b",
      deletedAt: null,
    });
  });
});
