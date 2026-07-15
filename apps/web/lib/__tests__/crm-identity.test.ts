import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockTransaction,
  mockIdentityFindFirst,
  mockContactFindMany,
  mockContactCreate,
  mockContactUpdateMany,
  mockIdentityCreate,
  mockAuditCreate,
} = vi.hoisted(() => ({
  mockTransaction: vi.fn(),
  mockIdentityFindFirst: vi.fn(),
  mockContactFindMany: vi.fn(),
  mockContactCreate: vi.fn(),
  mockContactUpdateMany: vi.fn(),
  mockIdentityCreate: vi.fn(),
  mockAuditCreate: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    $transaction: mockTransaction,
    contactIdentity: { findFirst: mockIdentityFindFirst },
    contact: { findMany: mockContactFindMany, updateMany: mockContactUpdateMany },
  },
}));

let id = 0;
vi.mock("@fikirtive/core", () => ({ newId: () => `crm-${++id}` }));

import {
  findOrCreateContactByIdentity,
  normalizeContactIdentity,
} from "../crm-identity";

const OWNER = "org-a";
const SEEN_AT = new Date("2026-07-15T01:02:03.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  id = 0;
  mockContactFindMany.mockResolvedValue([]);
  mockContactUpdateMany.mockResolvedValue({ count: 1 });
  mockContactCreate.mockResolvedValue({});
  mockIdentityCreate.mockResolvedValue({});
  mockAuditCreate.mockResolvedValue({});
  mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({
      contact: { create: mockContactCreate },
      contactIdentity: { create: mockIdentityCreate },
      actionEvent: { create: mockAuditCreate },
    }),
  );
});

describe("normalizeContactIdentity", () => {
  it("normalizes formatted WhatsApp numbers to E.164", () => {
    expect(normalizeContactIdentity({ channel: " WhatsApp ", externalId: "+60 (12) 345-6789" }))
      .toEqual({ channel: "whatsapp", externalId: "+60123456789", handle: null, label: null });
  });

  it("lowercases email identities", () => {
    expect(normalizeContactIdentity({ channel: "EMAIL", externalId: " Owner@Example.COM " }))
      .toEqual({ channel: "email", externalId: "owner@example.com", handle: null, label: null });
  });

  it("fails closed when a WhatsApp number has no country code", () => {
    expect(normalizeContactIdentity({ channel: "whatsapp", externalId: "012-345 6789" }))
      .toEqual({ error: "Use a WhatsApp number in E.164 format, including the country code." });
  });
});

describe("findOrCreateContactByIdentity", () => {
  it("on a live identity hit, only refreshes lastSeenAt on the owner-scoped contact", async () => {
    mockIdentityFindFirst.mockResolvedValue({ contactId: "contact-existing" });

    const result = await findOrCreateContactByIdentity({
      ownerId: OWNER,
      name: "Aisha",
      source: "manual",
      lifecycleStage: "New",
      identity: { channel: "email", externalId: "AISHA@EXAMPLE.COM" },
      seenAt: SEEN_AT,
    });

    expect(result).toEqual({ ok: true, contactId: "contact-existing", created: false, possibleDuplicateIds: [] });
    expect(mockIdentityFindFirst).toHaveBeenCalledWith({
      where: {
        ownerId: OWNER,
        channel: "email",
        externalId: "aisha@example.com",
        deletedAt: null,
        contact: { ownerId: OWNER, deletedAt: null },
      },
      select: { contactId: true },
    });
    expect(mockContactUpdateMany).toHaveBeenCalledWith({
      where: { id: "contact-existing", ownerId: OWNER, deletedAt: null },
      data: { lastSeenAt: SEEN_AT },
    });
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockContactCreate).not.toHaveBeenCalled();
    expect(mockIdentityCreate).not.toHaveBeenCalled();
    expect(mockAuditCreate).not.toHaveBeenCalled();
  });

  it("creates one Contact + Identity with unknown consent and reports same-name duplicates without merging", async () => {
    mockIdentityFindFirst.mockResolvedValue(null);
    mockContactFindMany.mockResolvedValue([{ id: "same-name-other" }]);

    const result = await findOrCreateContactByIdentity({
      ownerId: OWNER,
      name: "Aisha",
      source: "manual",
      lifecycleStage: "Active",
      identity: { channel: "whatsapp", externalId: "+60 12-345 6789", label: "Mobile" },
      seenAt: SEEN_AT,
    });

    expect(result).toEqual({ ok: true, contactId: "crm-1", created: true, possibleDuplicateIds: ["same-name-other"] });
    expect(mockContactFindMany).toHaveBeenCalledWith({
      where: { ownerId: OWNER, deletedAt: null, name: { equals: "Aisha", mode: "insensitive" } },
      select: { id: true },
      take: 10,
    });
    expect(mockContactCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: "crm-1",
        ownerId: OWNER,
        name: "Aisha",
        source: "manual",
        lifecycleStage: "Active",
        marketingConsent: "unknown",
        consentSource: null,
        consentAt: null,
        firstTouchAt: SEEN_AT,
        lastSeenAt: SEEN_AT,
      }),
    });
    expect(mockIdentityCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ownerId: OWNER,
        contactId: "crm-1",
        channel: "whatsapp",
        externalId: "+60123456789",
        label: "Mobile",
      }),
    });
    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ ownerId: OWNER, type: "crm.contact.create" }),
    });
  });

  it("recovers a concurrent identity P2002 by re-reading the winner and refreshing only lastSeenAt", async () => {
    mockIdentityFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ contactId: "contact-winner" });
    mockTransaction.mockRejectedValueOnce(Object.assign(new Error("duplicate"), { code: "P2002" }));

    const result = await findOrCreateContactByIdentity({
      ownerId: OWNER,
      name: "Aisha",
      source: "manual",
      lifecycleStage: "New",
      identity: { channel: "email", externalId: "aisha@example.com" },
      seenAt: SEEN_AT,
    });

    expect(result).toEqual({ ok: true, contactId: "contact-winner", created: false, possibleDuplicateIds: [] });
    expect(mockContactUpdateMany).toHaveBeenLastCalledWith({
      where: { id: "contact-winner", ownerId: OWNER, deletedAt: null },
      data: { lastSeenAt: SEEN_AT },
    });
  });

  it("never crosses owner scope while checking identity or possible duplicates", async () => {
    mockIdentityFindFirst.mockResolvedValue(null);
    await findOrCreateContactByIdentity({
      ownerId: "org-b",
      name: "Aisha",
      source: "manual",
      lifecycleStage: "New",
      identity: { channel: "email", externalId: "aisha@example.com" },
      seenAt: SEEN_AT,
    });

    expect(mockIdentityFindFirst.mock.calls[0][0].where.ownerId).toBe("org-b");
    expect(mockContactFindMany.mock.calls[0][0].where.ownerId).toBe("org-b");
  });
});
