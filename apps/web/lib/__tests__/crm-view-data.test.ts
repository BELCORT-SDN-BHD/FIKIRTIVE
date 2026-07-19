import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequireOwner, mockContactFindMany, mockContactFindFirst } = vi.hoisted(() => ({
  mockRequireOwner: vi.fn(),
  mockContactFindMany: vi.fn(),
  mockContactFindFirst: vi.fn(),
}));

vi.mock("@/lib/auth-guard", () => ({ requireOwner: mockRequireOwner }));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    contact: {
      findMany: mockContactFindMany,
      findFirst: mockContactFindFirst,
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
    expect(query.select).not.toHaveProperty("marketingConsent");
    expect(query.select.consentStateProjections.where).toEqual({
      ownerId: OWNER,
      channel: "whatsapp",
      purpose: "marketing",
    });
    expect(query.select.identities.where).toEqual({ ownerId: OWNER, deletedAt: null });
    expect(query.take).toBe(100);
  });

  it("keeps identity search inside the authenticated owner fence", async () => {
    await searchContacts({ query: "+6012", lifecycleStage: "New", limit: 10 });

    const query = mockContactFindMany.mock.calls[0][0];
    expect(query.where.ownerId).toBe(OWNER);
    expect(query.where.OR[1].identities.some).toMatchObject({ ownerId: OWNER, deletedAt: null });
    expect(query.where.OR[2].identities.some).toMatchObject({ ownerId: OWNER, deletedAt: null });
    expect(JSON.stringify(query)).not.toContain("org-b");
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
    expect(query.select).not.toHaveProperty("marketingConsent");
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
