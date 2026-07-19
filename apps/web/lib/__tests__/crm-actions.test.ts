import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireOwner,
  mockIsImpersonating,
  mockFindOrCreate,
  mockTransaction,
  mockContactFindMany,
  mockContactFindFirst,
  mockContactCreate,
  mockContactUpdateMany,
  mockIdentityUpdateMany,
  mockCampaignFindFirst,
  mockAuditCreate,
} = vi.hoisted(() => ({
  mockRequireOwner: vi.fn(),
  mockIsImpersonating: vi.fn(),
  mockFindOrCreate: vi.fn(),
  mockTransaction: vi.fn(),
  mockContactFindMany: vi.fn(),
  mockContactFindFirst: vi.fn(),
  mockContactCreate: vi.fn(),
  mockContactUpdateMany: vi.fn(),
  mockIdentityUpdateMany: vi.fn(),
  mockCampaignFindFirst: vi.fn(),
  mockAuditCreate: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth-guard", () => ({ requireOwner: mockRequireOwner }));
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: mockIsImpersonating }));
vi.mock("../crm-identity", () => ({
  findOrCreateContactByIdentity: mockFindOrCreate,
  isCrmLifecycleStage: (value: unknown) => ["New", "Active", "Dormant"].includes(String(value)),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    $transaction: mockTransaction,
    contact: {
      findMany: mockContactFindMany,
      findFirst: mockContactFindFirst,
      create: mockContactCreate,
      updateMany: mockContactUpdateMany,
    },
    contactIdentity: { updateMany: mockIdentityUpdateMany },
    campaign: { findFirst: mockCampaignFindFirst },
    actionEvent: { create: mockAuditCreate },
  },
}));

let id = 0;
vi.mock("@fikirtive/core", () => ({ newId: () => `crm-${++id}` }));

import { addLeadContact, mergeContacts, setContactConsent, updateContact } from "../crm-actions";
import { getContact, listContacts, searchContacts } from "../crm-view-data";

const OWNER = "org-a";
const FIRST_EARLY = new Date("2026-01-01T00:00:00.000Z");
const FIRST_LATE = new Date("2026-02-01T00:00:00.000Z");

function transactionClient() {
  return {
    contact: {
      findFirst: mockContactFindFirst,
      create: mockContactCreate,
      updateMany: mockContactUpdateMany,
    },
    contactIdentity: { updateMany: mockIdentityUpdateMany },
    campaign: { findFirst: mockCampaignFindFirst },
    actionEvent: { create: mockAuditCreate },
  };
}

function recordTransactionRollback() {
  const state = { rolledBack: false };
  mockTransaction.mockImplementationOnce(async (fn: (tx: unknown) => unknown) => {
    try {
      return await fn(transactionClient());
    } catch (error) {
      state.rolledBack = true;
      throw error;
    }
  });
  return state;
}

beforeEach(() => {
  vi.clearAllMocks();
  id = 0;
  mockRequireOwner.mockResolvedValue({ ownerId: OWNER, email: "owner@example.com" });
  mockIsImpersonating.mockResolvedValue(false);
  mockContactFindMany.mockResolvedValue([]);
  mockContactFindFirst.mockResolvedValue(null);
  mockContactCreate.mockResolvedValue({});
  mockContactUpdateMany.mockResolvedValue({ count: 1 });
  mockIdentityUpdateMany.mockResolvedValue({ count: 1 });
  mockCampaignFindFirst.mockResolvedValue({ id: "campaign-early" });
  mockAuditCreate.mockResolvedValue({});
  mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(transactionClient()));
});

describe("addLeadContact", () => {
  it("derives ownerId from the session and delegates strong-identity convergence", async () => {
    mockFindOrCreate.mockResolvedValue({ ok: true, contactId: "contact-1", created: true, possibleDuplicateIds: [] });
    const result = await addLeadContact({
      ownerId: "attacker-org",
      name: "Aisha",
      identity: { channel: "email", externalId: "aisha@example.com" },
    } as never);

    expect(result).toEqual({ ok: true, contactId: "contact-1", created: true, possibleDuplicateIds: [] });
    expect(mockFindOrCreate).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: OWNER,
      name: "Aisha",
      source: "manual",
      lifecycleStage: "New",
    }));
    expect(mockFindOrCreate.mock.calls[0][0]).not.toHaveProperty("marketingConsent", "opt_in");
  });

  it("allows a name-only lead, defaults consent to unknown, and reports duplicate names without auto-merging", async () => {
    mockContactFindMany.mockResolvedValue([{ id: "same-name" }]);
    const result = await addLeadContact({ name: "Aisha" });

    expect(result).toEqual({ ok: true, contactId: "crm-1", created: true, possibleDuplicateIds: ["same-name"] });
    expect(mockContactCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      id: "crm-1",
      ownerId: OWNER,
      name: "Aisha",
      lifecycleStage: "New",
      source: "manual",
      marketingConsent: "unknown",
      consentSource: null,
      consentAt: null,
    }) });
    expect(mockIdentityUpdateMany).not.toHaveBeenCalled();
  });

  it("blocks all mutation while impersonating a customer", async () => {
    mockIsImpersonating.mockResolvedValue(true);
    const result = await addLeadContact({ name: "Aisha" });
    expect(result).toHaveProperty("error");
    expect(mockFindOrCreate).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});

describe("setContactConsent", () => {
  it("requires explicit customer confirmation before opt-in", async () => {
    const result = await setContactConsent({
      contactId: "contact-1",
      marketingConsent: "opt_in",
      consentSource: "WhatsApp reply",
    });
    expect(result).toHaveProperty("error");
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("writes consent/source/time together and appends an owner-scoped audit event", async () => {
    mockContactFindFirst.mockResolvedValue({ marketingConsent: "unknown", consentSource: null, consentAt: null });
    const before = Date.now();
    const result = await setContactConsent({
      contactId: "contact-1",
      marketingConsent: "opt_in",
      consentSource: "WhatsApp reply",
      customerConfirmed: true,
    });
    const after = Date.now();

    expect(result).toEqual({ ok: true });
    const update = mockContactUpdateMany.mock.calls[0][0];
    expect(update.where).toEqual({ id: "contact-1", ownerId: OWNER, deletedAt: null });
    expect(update.data).toMatchObject({ marketingConsent: "opt_in", consentSource: "WhatsApp reply" });
    expect(update.data.consentAt).toBeInstanceOf(Date);
    expect(update.data.consentAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(update.data.consentAt.getTime()).toBeLessThanOrEqual(after);
    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ ownerId: OWNER, type: "crm.contact.consent" }),
    });
  });
});

describe("updateContact", () => {
  it("rejects values outside the three lifecycle stages", async () => {
    expect(await updateContact({ contactId: "contact-1", patch: { lifecycleStage: "Lead" } }))
      .toHaveProperty("error");
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("does not expose a write path for totalOrdersMyr", async () => {
    expect(await updateContact({ contactId: "contact-1", patch: { totalOrdersMyr: "999" } } as never))
      .toEqual({ error: "That field is read-only." });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("updates only allowed owner-scoped fields and audits the actual field change", async () => {
    mockContactFindFirst.mockResolvedValue({ name: "Aisha", lifecycleStage: "New", doNotDisturb: false });
    expect(await updateContact({ contactId: "contact-1", patch: { lifecycleStage: "Dormant" } }))
      .toEqual({ ok: true });

    expect(mockContactUpdateMany).toHaveBeenCalledWith({
      where: { id: "contact-1", ownerId: OWNER, deletedAt: null },
      data: { lifecycleStage: "Dormant" },
    });
    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ownerId: OWNER,
        type: "crm.contact.update",
        payload: { contactId: "contact-1", changes: { lifecycleStage: { from: "New", to: "Dormant" } } },
      }),
    });
  });
});

describe("mergeContacts", () => {
  it("requires an explicit manual confirmation", async () => {
    expect(await mergeContacts({ sourceContactId: "source", targetContactId: "target", confirmed: false }))
      .toHaveProperty("error");
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("repoints identities, inherits the earlier attribution pair, soft-deletes the source, and audits", async () => {
    mockContactFindFirst
      .mockResolvedValueOnce({ id: "source", firstTouchAt: FIRST_EARLY, firstTouchCampaignId: "campaign-early" })
      .mockResolvedValueOnce({ id: "target", firstTouchAt: FIRST_LATE, firstTouchCampaignId: "campaign-late" });

    expect(await mergeContacts({ sourceContactId: "source", targetContactId: "target", confirmed: true }))
      .toEqual({ ok: true });

    expect(mockIdentityUpdateMany).toHaveBeenCalledWith({
      where: { ownerId: OWNER, contactId: "source", deletedAt: null },
      data: { contactId: "target" },
    });
    expect(mockContactUpdateMany).toHaveBeenCalledWith({
      where: { id: "target", ownerId: OWNER, deletedAt: null },
      data: { firstTouchAt: FIRST_EARLY, firstTouchCampaignId: "campaign-early" },
    });
    expect(mockContactUpdateMany).toHaveBeenCalledWith({
      where: { id: "source", ownerId: OWNER, deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    });
    for (const call of mockContactUpdateMany.mock.calls) {
      expect(call[0].data).not.toHaveProperty("totalOrdersMyr");
    }
    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ ownerId: OWNER, type: "crm.contact.merge" }),
    });
    expect(mockCampaignFindFirst).toHaveBeenCalledWith({
      where: { id: "campaign-early", ownerId: OWNER },
      select: { id: true },
    });
  });

  it("inherits an earlier same-owner campaign even when that historical campaign is soft-deleted", async () => {
    mockContactFindFirst
      .mockResolvedValueOnce({ id: "source", firstTouchAt: FIRST_EARLY, firstTouchCampaignId: "campaign-archived" })
      .mockResolvedValueOnce({ id: "target", firstTouchAt: FIRST_LATE, firstTouchCampaignId: null });
    mockCampaignFindFirst.mockResolvedValue({ id: "campaign-archived", deletedAt: FIRST_LATE });

    expect(await mergeContacts({ sourceContactId: "source", targetContactId: "target", confirmed: true }))
      .toEqual({ ok: true });
    expect(mockCampaignFindFirst).toHaveBeenCalledWith({
      where: { id: "campaign-archived", ownerId: OWNER },
      select: { id: true },
    });
    expect(mockContactUpdateMany).toHaveBeenCalledWith({
      where: { id: "target", ownerId: OWNER, deletedAt: null },
      data: { firstTouchAt: FIRST_EARLY, firstTouchCampaignId: "campaign-archived" },
    });
  });

  it("fails closed before moving identities when the inherited campaign is not owned by the session tenant", async () => {
    mockContactFindFirst
      .mockResolvedValueOnce({ id: "source", firstTouchAt: FIRST_EARLY, firstTouchCampaignId: "foreign-campaign" })
      .mockResolvedValueOnce({ id: "target", firstTouchAt: FIRST_LATE, firstTouchCampaignId: null });
    mockCampaignFindFirst.mockResolvedValue(null);

    expect(await mergeContacts({ sourceContactId: "source", targetContactId: "target", confirmed: true }))
      .toEqual({ error: "Contact attribution is invalid." });
    expect(mockCampaignFindFirst.mock.calls[0][0].where.ownerId).toBe(OWNER);
    expect(mockIdentityUpdateMany).not.toHaveBeenCalled();
    expect(mockContactUpdateMany).not.toHaveBeenCalled();
    expect(mockAuditCreate).not.toHaveBeenCalled();
  });

  it("throws after identities move when the attribution target changed, so the transaction rolls back", async () => {
    mockContactFindFirst
      .mockResolvedValueOnce({ id: "source", firstTouchAt: FIRST_EARLY, firstTouchCampaignId: "campaign-early" })
      .mockResolvedValueOnce({ id: "target", firstTouchAt: FIRST_LATE, firstTouchCampaignId: null });
    mockContactUpdateMany.mockResolvedValueOnce({ count: 0 });
    const transaction = recordTransactionRollback();

    expect(await mergeContacts({ sourceContactId: "source", targetContactId: "target", confirmed: true }))
      .toEqual({ error: "Contact not found." });
    expect(mockIdentityUpdateMany).toHaveBeenCalled();
    expect(transaction.rolledBack).toBe(true);
    expect(mockAuditCreate).not.toHaveBeenCalled();
  });

  it("throws after identities move when the source archive loses a race, so the transaction rolls back", async () => {
    mockContactFindFirst
      .mockResolvedValueOnce({ id: "source", firstTouchAt: FIRST_LATE, firstTouchCampaignId: null })
      .mockResolvedValueOnce({ id: "target", firstTouchAt: FIRST_EARLY, firstTouchCampaignId: null });
    mockContactUpdateMany.mockResolvedValueOnce({ count: 0 });
    const transaction = recordTransactionRollback();

    expect(await mergeContacts({ sourceContactId: "source", targetContactId: "target", confirmed: true }))
      .toEqual({ error: "Contact not found." });
    expect(mockIdentityUpdateMany).toHaveBeenCalled();
    expect(transaction.rolledBack).toBe(true);
    expect(mockAuditCreate).not.toHaveBeenCalled();
  });

  it("treats a forged cross-tenant id as not found and writes nothing", async () => {
    mockContactFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: "target", firstTouchAt: FIRST_LATE, firstTouchCampaignId: null,
    });
    expect(await mergeContacts({ sourceContactId: "foreign", targetContactId: "target", confirmed: true }))
      .toHaveProperty("error");
    expect(mockIdentityUpdateMany).not.toHaveBeenCalled();
    expect(mockContactUpdateMany).not.toHaveBeenCalled();
    expect(mockAuditCreate).not.toHaveBeenCalled();
    expect(mockContactFindFirst.mock.calls[0][0].where.ownerId).toBe(OWNER);
  });
});

describe("CRM read surfaces", () => {
  const row = {
    id: "contact-1",
    name: "Aisha",
    lifecycleStage: "Active",
    source: "manual",
    firstTouchCampaignId: null,
    firstTouchAt: FIRST_EARLY,
    lastSeenAt: FIRST_LATE,
    marketingConsent: "unknown",
    consentSource: null,
    consentAt: null,
    doNotDisturb: false,
    totalOrdersMyr: null,
    createdAt: FIRST_EARLY,
    identities: [],
  };

  it("lists live contacts owner-scoped and keeps absent order truth as null", async () => {
    mockContactFindMany.mockResolvedValue([row]);
    const result = await listContacts();
    expect(result).toEqual({ ok: true, contacts: [row] });
    expect(mockContactFindMany.mock.calls[0][0].where).toMatchObject({ ownerId: OWNER, deletedAt: null });
    expect(mockContactFindMany.mock.calls[0][0].select.identities.where).toEqual({ ownerId: OWNER, deletedAt: null });
    if (!("ok" in result)) throw new Error("expected contacts");
    expect(result.contacts[0].totalOrdersMyr).toBeNull();
  });

  it("gets a profile by an owner-scoped findFirst, never a bare unique id", async () => {
    mockContactFindFirst.mockResolvedValue({ ...row, totalOrdersMyr: { toString: () => "500.00" } });
    const result = await getContact("contact-1");
    expect(result).toMatchObject({ ok: true, contact: { id: "contact-1", totalOrdersMyr: "500.00" } });
    expect(mockContactFindFirst.mock.calls[0][0].where).toEqual({ id: "contact-1", ownerId: OWNER, deletedAt: null });
    expect(mockContactFindFirst.mock.calls[0][0].select.identities.where).toEqual({ ownerId: OWNER, deletedAt: null });
  });

  it("searches name and identity inside the same owner fence", async () => {
    mockContactFindMany.mockResolvedValue([row]);
    await searchContacts("aisha@example.com");
    const where = mockContactFindMany.mock.calls[0][0].where;
    expect(where.ownerId).toBe(OWNER);
    expect(where.deletedAt).toBeNull();
    expect(where.OR).toEqual(expect.arrayContaining([
      { name: { contains: "aisha@example.com", mode: "insensitive" } },
      { identities: { some: { ownerId: OWNER, deletedAt: null, externalId: { contains: "aisha@example.com", mode: "insensitive" } } } },
    ]));
  });

  it("returns the auth error before any read", async () => {
    mockRequireOwner.mockResolvedValue({ error: "Not authorized." });
    expect(await listContacts()).toEqual({ error: "Not authorized." });
    expect(mockContactFindMany).not.toHaveBeenCalled();
  });
});
