import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const {
  mockRequireOwner,
  mockIsImpersonating,
  mockTransaction,
  mockContactFindFirst,
  mockContactCreate,
  mockContactUpdateMany,
  mockAuditCreate,
  mockFindSuggestions,
  mockRecordConsentEvent,
  mockRecordContactDndEvent,
  mockIdentityFindFirst,
  mockIdentityCreate,
  mockIdentityUpdateMany,
} = vi.hoisted(() => ({
  mockRequireOwner: vi.fn(),
  mockIsImpersonating: vi.fn(),
  mockTransaction: vi.fn(),
  mockContactFindFirst: vi.fn(),
  mockContactCreate: vi.fn(),
  mockContactUpdateMany: vi.fn(),
  mockAuditCreate: vi.fn(),
  mockFindSuggestions: vi.fn(),
  mockRecordConsentEvent: vi.fn(),
  mockRecordContactDndEvent: vi.fn(),
  mockIdentityFindFirst: vi.fn(),
  mockIdentityCreate: vi.fn(),
  mockIdentityUpdateMany: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth-guard", () => ({ requireOwner: mockRequireOwner }));
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: mockIsImpersonating }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../crm-identity", () => ({
  isCrmLifecycleStage: (value: unknown) => ["New", "Active", "Dormant"].includes(String(value)),
  normalizeContactIdentity: (
    { channel, externalId }: { channel: string; externalId: string },
    options: { assumeMalaysianPhone?: boolean } = {},
  ) => {
    if (channel === "email") {
      return { channel, externalId: externalId.trim().toLowerCase(), handle: null, label: null };
    }
    const compact = externalId.replace(/[\s().-]/g, "");
    if (/^\+[1-9]\d{7,14}$/.test(compact)) {
      return { channel, externalId: compact, handle: null, label: null };
    }
    if (options.assumeMalaysianPhone && /^0\d{8,10}$/.test(compact)) {
      return { channel, externalId: `+60${compact.slice(1)}`, handle: null, label: null };
    }
    return { error: "Use a WhatsApp number in E.164 format, including the country code." };
  },
  findContactDuplicateSuggestions: mockFindSuggestions,
}));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    $transaction: mockTransaction,
    contact: {
      findFirst: mockContactFindFirst,
      create: mockContactCreate,
      updateMany: mockContactUpdateMany,
    },
    contactIdentity: {
      findFirst: mockIdentityFindFirst,
      create: mockIdentityCreate,
      updateMany: mockIdentityUpdateMany,
    },
    actionEvent: { create: mockAuditCreate },
  },
  recordConsentEvent: mockRecordConsentEvent,
  recordContactDndEvent: mockRecordContactDndEvent,
}));

let id = 0;
vi.mock("@fikirtive/core", () => ({
  newId: () => `crm-${++id}`,
  MERCHANT_UNVERIFIED_IDENTITY: "merchant_unverified",
  CHANNEL_VERIFIED_IDENTITY: "channel_verified",
}));

import * as crmActions from "../crm-actions";

const OWNER = "org-a";

function transactionClient() {
  return {
    contact: {
      findFirst: mockContactFindFirst,
      create: mockContactCreate,
      updateMany: mockContactUpdateMany,
    },
    contactIdentity: {
      findFirst: mockIdentityFindFirst,
      create: mockIdentityCreate,
      updateMany: mockIdentityUpdateMany,
    },
    actionEvent: { create: mockAuditCreate },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  id = 0;
  mockRequireOwner.mockResolvedValue({ ownerId: OWNER });
  mockIsImpersonating.mockResolvedValue(false);
  mockFindSuggestions.mockResolvedValue([]);
  mockContactFindFirst.mockResolvedValue({ id: "contact-1", name: "Aisha", lifecycleStage: "New" });
  mockContactCreate.mockResolvedValue({});
  mockContactUpdateMany.mockResolvedValue({ count: 1 });
  mockAuditCreate.mockResolvedValue({});
  mockRecordConsentEvent.mockResolvedValue({ duplicate: false, eventIds: ["event-1"], receivedAt: [] });
  mockRecordContactDndEvent.mockResolvedValue({ duplicate: false, eventIds: ["dnd-1"], receivedAt: [] });
  mockIdentityFindFirst.mockResolvedValue(null);
  mockIdentityCreate.mockResolvedValue({});
  mockIdentityUpdateMany.mockResolvedValue({ count: 1 });
  mockTransaction.mockImplementation(async (callback: (tx: ReturnType<typeof transactionClient>) => unknown) =>
    callback(transactionClient()),
  );
});

describe("CRM action boundary", () => {
  it("exports the bounded action set with no merge action", () => {
    expect(Object.keys(crmActions).sort()).toEqual([
      "addContactPhone",
      "addContactPhoneFromOtto",
      "createContact",
      "importContacts",
      "removeContactPhone",
      "removeContactPhoneFromOtto",
      "setContactConsent",
      "setContactDnd",
      "setContactDndFromOtto",
      "updateContact",
      "updateContactPhone",
      "updateContactPhoneFromOtto",
    ]);
  });

  it("blocks every mutation while impersonating", async () => {
    mockIsImpersonating.mockResolvedValue(true);
    await expect(crmActions.createContact({ name: "Aisha" })).resolves.toHaveProperty("error");
    await expect(crmActions.updateContact({ contactId: "contact-1", patch: { name: "A" } })).resolves.toHaveProperty("error");
    await expect(crmActions.setContactConsent({ contactId: "contact-1", action: "grant", requestId: "r1" })).resolves.toHaveProperty("error");
    await expect(crmActions.setContactDnd({ contactId: "contact-1", enabled: true, requestId: "r2" })).resolves.toHaveProperty("error");
    await expect(crmActions.importContacts({ csv: "name\nBo", importId: "i1" })).resolves.toHaveProperty("error");
    await expect(crmActions.addContactPhone({ contactId: "contact-1", phone: "+60123456789" })).resolves.toHaveProperty("error");
    await expect(crmActions.updateContactPhone({ contactId: "contact-1", identityId: "identity-1", phone: "+60123456789" })).resolves.toHaveProperty("error");
    await expect(crmActions.removeContactPhone({ contactId: "contact-1", identityId: "identity-1" })).resolves.toHaveProperty("error");
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockIdentityCreate).not.toHaveBeenCalled();
    expect(mockRecordConsentEvent).not.toHaveBeenCalled();
    expect(mockRecordContactDndEvent).not.toHaveBeenCalled();
  });
});

describe("createContact and updateContact", () => {
  it("derives owner scope, creates no identity/consent/DND fields, and returns suggestions only", async () => {
    mockFindSuggestions.mockResolvedValue([{ contactId: "possible-1", name: "Aisha", reasons: ["Same name"] }]);
    const result = await crmActions.createContact({
      ownerId: "attacker",
      name: " Aisha ",
      lifecycleStage: "New",
    } as never);

    expect(result).toEqual({
      ok: true,
      contactId: "crm-1",
      created: true,
      possibleDuplicates: [{ contactId: "possible-1", name: "Aisha", reasons: ["Same name"] }],
    });
    expect(mockFindSuggestions).toHaveBeenCalledWith({ ownerId: OWNER, name: "Aisha", identities: undefined });
    const data = mockContactCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({ id: "crm-1", ownerId: OWNER, name: "Aisha", source: "manual" });
    expect(data).not.toHaveProperty("marketingConsent");
    expect(data).not.toHaveProperty("consentSource");
    expect(data).not.toHaveProperty("consentAt");
    expect(data).not.toHaveProperty("doNotDisturb");
  });

  it("refuses the deferred identity write path", async () => {
    await expect(crmActions.createContact({
      name: "Aisha",
      identity: { channel: "email", externalId: "aisha@example.com" },
    } as never)).resolves.toEqual({
      error: "Identity editing is not available. Add the contact without attaching an identity.",
    });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("updates only name/lifecycle and keeps order/DND outside the generic patch", async () => {
    await expect(crmActions.updateContact({ contactId: "contact-1", patch: { lifecycleStage: "Dormant" } }))
      .resolves.toEqual({ ok: true });
    expect(mockContactUpdateMany).toHaveBeenCalledWith({
      where: { id: "contact-1", ownerId: OWNER, deletedAt: null },
      data: { lifecycleStage: "Dormant" },
    });
    await expect(crmActions.updateContact({ contactId: "contact-1", patch: { totalOrdersMyr: "999" } } as never))
      .resolves.toEqual({ error: "That field is read-only." });
    await expect(crmActions.updateContact({ contactId: "contact-1", patch: { doNotDisturb: true } } as never))
      .resolves.toEqual({ error: "Use the do-not-disturb control for that setting." });
  });
});

describe("consent and DND runtime writers", () => {
  it("records manual consent through crm_manual without a direct Contact update", async () => {
    await expect(crmActions.setContactConsent({
      contactId: "contact-1",
      action: "grant",
      requestId: "consent-1",
    })).resolves.toEqual({ ok: true });

    expect(mockContactFindFirst).toHaveBeenCalledWith({
      where: { id: "contact-1", ownerId: OWNER, deletedAt: null },
      select: { id: true },
    });
    expect(mockRecordConsentEvent).toHaveBeenCalledWith({
      ownerId: OWNER,
      contactId: "contact-1",
      channel: "whatsapp",
      purpose: "marketing",
      sourceKind: "crm_manual",
      action: "grant",
      idempotencyKey: "crm-manual:contact-1:consent-1",
    });
    expect(mockContactUpdateMany).not.toHaveBeenCalled();
  });

  it("surfaces closed-matrix and idempotency rejections as clear messages", async () => {
    mockRecordConsentEvent.mockRejectedValueOnce({ code: "INVALID_WRITER_COMBINATION" });
    await expect(crmActions.setContactConsent({ contactId: "contact-1", action: "revoke", requestId: "r1" }))
      .resolves.toEqual({ error: "This consent record does not match the approved evidence rules." });

    mockRecordConsentEvent.mockRejectedValueOnce({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(crmActions.setContactConsent({ contactId: "contact-1", action: "grant", requestId: "r2" }))
      .resolves.toEqual({ error: "This request was already used for a different consent record. Start a new attempt." });
  });

  it("uses distinct closed DND sources for the human and Otto entrypoints", async () => {
    await crmActions.setContactDnd({ contactId: "contact-1", enabled: true, requestId: "dnd-ui" });
    await crmActions.setContactDndFromOtto({ contactId: "contact-1", enabled: false, requestId: "dnd-otto" });

    expect(mockRecordContactDndEvent).toHaveBeenNthCalledWith(1, {
      ownerId: OWNER,
      contactId: "contact-1",
      sourceKind: "crm_ui",
      action: "set",
      idempotencyKey: "crm-dnd:contact-1:dnd-ui",
    });
    expect(mockRecordContactDndEvent).toHaveBeenNthCalledWith(2, {
      ownerId: OWNER,
      contactId: "contact-1",
      sourceKind: "otto_approved_action",
      action: "clear",
      idempotencyKey: "crm-dnd:contact-1:dnd-otto",
    });
  });

  it("fails cross-tenant ids as not found before either engine sees them", async () => {
    mockRequireOwner.mockResolvedValue({ ownerId: "org-b" });
    mockContactFindFirst.mockResolvedValue(null);
    await expect(crmActions.setContactConsent({ contactId: "org-a-contact", action: "grant", requestId: "r1" }))
      .resolves.toEqual({ error: "Contact not found." });
    await expect(crmActions.setContactDnd({ contactId: "org-a-contact", enabled: true, requestId: "r2" }))
      .resolves.toEqual({ error: "Contact not found." });
    expect(mockContactFindFirst.mock.calls.every((call) => call[0].where.ownerId === "org-b")).toBe(true);
    expect(mockRecordConsentEvent).not.toHaveBeenCalled();
    expect(mockRecordContactDndEvent).not.toHaveBeenCalled();
  });
});

describe("merchant-entered phone numbers (#803)", () => {
  it("stores what the merchant typed at the unverified grade, with no evidence and no consent", async () => {
    await expect(crmActions.addContactPhone({ contactId: "contact-1", phone: "012-345 6789" }))
      .resolves.toEqual({
        ok: true,
        identityId: "crm-1",
        phone: "+60123456789",
        verificationStatus: "merchant_unverified",
        alreadyStored: false,
      });

    const data = mockIdentityCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({
      ownerId: OWNER,
      contactId: "contact-1",
      channel: "whatsapp",
      externalId: "+60123456789",
      verificationStatus: "merchant_unverified",
      verifiedAt: null,
      verifiedSourceKind: null,
    });
    expect(mockRecordConsentEvent).not.toHaveBeenCalled();
    expect(mockAuditCreate.mock.calls[0][0].data).toMatchObject({
      ownerId: OWNER,
      type: "crm.contact.identity.add",
      payload: { verificationStatus: "merchant_unverified", entrySurface: "crm_ui" },
    });
  });

  it("records the entry surface Otto used, through the same writer and the same grade", async () => {
    await crmActions.addContactPhoneFromOtto({ contactId: "contact-1", phone: "+60123456789" });
    expect(mockIdentityCreate.mock.calls[0][0].data.verificationStatus).toBe("merchant_unverified");
    expect(mockAuditCreate.mock.calls[0][0].data.payload.entrySurface).toBe("otto_approved_action");
  });

  it("cannot be told to store a number as verified", async () => {
    await crmActions.addContactPhone({
      contactId: "contact-1",
      phone: "+60123456789",
      verificationStatus: "channel_verified",
      verifiedSourceKind: "inbound_message",
    } as never);
    expect(mockIdentityCreate.mock.calls[0][0].data).toMatchObject({
      verificationStatus: "merchant_unverified",
      verifiedAt: null,
      verifiedSourceKind: null,
    });
  });

  it("says how to fix a number it cannot read, and stores nothing", async () => {
    await expect(crmActions.addContactPhone({ contactId: "contact-1", phone: "12345" }))
      .resolves.toEqual({ error: "Use a WhatsApp number in E.164 format, including the country code." });
    expect(mockIdentityCreate).not.toHaveBeenCalled();
  });

  it("treats a repeat of the same number on the same contact as already done", async () => {
    mockIdentityFindFirst.mockResolvedValue({
      id: "identity-1",
      contactId: "contact-1",
      verificationStatus: "merchant_unverified",
    });
    await expect(crmActions.addContactPhone({ contactId: "contact-1", phone: "+60123456789" }))
      .resolves.toEqual({
        ok: true,
        identityId: "identity-1",
        phone: "+60123456789",
        verificationStatus: "merchant_unverified",
        alreadyStored: true,
      });
    expect(mockIdentityCreate).not.toHaveBeenCalled();
  });

  /**
   * r2 (判词 5232132441 P2①). Re-adding a number a channel already confirmed is a success, and
   * reporting it as freshly stored and unverified would demote a verified fact in the words the
   * merchant reads. The grade comes back so the page can say what is actually true.
   */
  it("reports the existing grade when the number is already channel verified", async () => {
    mockIdentityFindFirst.mockResolvedValue({
      id: "identity-1",
      contactId: "contact-1",
      verificationStatus: "channel_verified",
    });
    await expect(crmActions.addContactPhone({ contactId: "contact-1", phone: "+60123456789" }))
      .resolves.toEqual({
        ok: true,
        identityId: "identity-1",
        phone: "+60123456789",
        verificationStatus: "channel_verified",
        alreadyStored: true,
      });
    expect(mockIdentityCreate).not.toHaveBeenCalled();
    expect(mockIdentityUpdateMany).not.toHaveBeenCalled();
  });

  it("refuses to move a number this tenant already holds on another contact", async () => {
    mockIdentityFindFirst.mockResolvedValue({
      id: "identity-9",
      contactId: "contact-other",
      verificationStatus: "merchant_unverified",
    });
    await expect(crmActions.addContactPhone({ contactId: "contact-1", phone: "+60123456789" }))
      .resolves.toEqual({ error: "That number is already saved on another contact." });
    expect(mockIdentityCreate).not.toHaveBeenCalled();
  });

  it("refuses to edit or remove a number a channel confirmed", async () => {
    mockIdentityFindFirst.mockResolvedValue({
      id: "identity-1",
      externalId: "+60123456789",
      verificationStatus: "channel_verified",
    });
    const locked = {
      error: "This number was confirmed by a connected channel, so it can't be edited or removed here.",
    };
    await expect(crmActions.updateContactPhone({ contactId: "contact-1", identityId: "identity-1", phone: "+60123456700" }))
      .resolves.toEqual(locked);
    await expect(crmActions.removeContactPhone({ contactId: "contact-1", identityId: "identity-1" }))
      .resolves.toEqual(locked);
    expect(mockIdentityUpdateMany).not.toHaveBeenCalled();
  });

  it("removes a merchant-entered number as a soft delete, keeping the record", async () => {
    mockIdentityFindFirst.mockResolvedValue({
      id: "identity-1",
      externalId: "+60123456789",
      verificationStatus: "merchant_unverified",
    });
    await expect(crmActions.removeContactPhone({ contactId: "contact-1", identityId: "identity-1" }))
      .resolves.toEqual({ ok: true });

    const call = mockIdentityUpdateMany.mock.calls[0][0];
    expect(call.where).toMatchObject({
      id: "identity-1",
      ownerId: OWNER,
      contactId: "contact-1",
      deletedAt: null,
      verificationStatus: "merchant_unverified",
    });
    expect(call.data.deletedAt).toBeInstanceOf(Date);
    expect(call.data).not.toHaveProperty("externalId");
  });

  it("keeps every phone read and write inside the authenticated tenant", async () => {
    mockRequireOwner.mockResolvedValue({ ownerId: "org-b" });
    mockContactFindFirst.mockResolvedValue(null);
    await expect(crmActions.addContactPhone({ contactId: "org-a-contact", phone: "+60123456789", ownerId: "org-a" } as never))
      .resolves.toEqual({ error: "Contact not found." });
    expect(mockContactFindFirst.mock.calls[0][0].where.ownerId).toBe("org-b");
    expect(mockIdentityCreate).not.toHaveBeenCalled();
  });
});

describe("importContacts", () => {
  it("never fabricates consent when the column is absent or unknown", async () => {
    const result = await crmActions.importContacts({
      csv: "name,lifecycle_stage,consent\nAisha,Active,\nBo,New,unknown",
      importId: "import-1",
    });
    expect(result).toMatchObject({ ok: true, importedCount: 2, failedCount: 0 });
    // r2 (判词 5232132441 P2②): no phone column means nothing was stored, and the row says so.
    if ("ok" in result) {
      expect(result.rows.every((row) => row.storedPhoneCount === 0 && row.skippedPhoneCount === 0)).toBe(true);
    }
    expect(mockRecordConsentEvent).not.toHaveBeenCalled();
    expect(mockContactCreate).toHaveBeenCalledTimes(2);
    for (const call of mockContactCreate.mock.calls) {
      expect(call[0].data.source).toBe("import");
      expect(call[0].data).not.toHaveProperty("marketingConsent");
    }
  });

  it("stores imported phone/email at the merchant-entered grade and records the consent assertion through the engine", async () => {
    mockFindSuggestions.mockResolvedValue([{ contactId: "possible-1", name: "Aisha", reasons: ["Same WhatsApp number"] }]);
    const result = await crmActions.importContacts({
      csv: "name,phone,email,consent\nAisha,+60123456789,AISHA@example.com,opt_in",
      importId: "import-2",
    });

    expect(mockFindSuggestions).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: OWNER,
      name: "Aisha",
      identities: expect.arrayContaining([
        expect.objectContaining({ channel: "whatsapp", externalId: "+60123456789" }),
        expect.objectContaining({ channel: "email", externalId: "aisha@example.com" }),
      ]),
    }));
    expect(mockRecordConsentEvent).toHaveBeenCalledWith({
      ownerId: OWNER,
      contactId: "crm-1",
      channel: "whatsapp",
      purpose: "marketing",
      sourceKind: "import",
      action: "grant",
      evidenceRef: "csv:import-2:2",
      idempotencyKey: "crm-import:import-2:2",
    });
    // #803 — the NUMBER is now kept, at the grade that says who put it there. The email is not:
    // it still has no entry, correction, or removal surface.
    expect(mockIdentityCreate).toHaveBeenCalledTimes(1);
    expect(mockIdentityCreate.mock.calls[0][0].data).toMatchObject({
      ownerId: OWNER,
      contactId: "crm-1",
      channel: "whatsapp",
      externalId: "+60123456789",
      verificationStatus: "merchant_unverified",
      verifiedAt: null,
      verifiedSourceKind: null,
    });
    expect(result).toMatchObject({
      ok: true,
      rows: [{
        status: "imported_with_warning",
        consentAssertion: "grant",
        possibleDuplicates: [{ contactId: "possible-1" }],
        storedPhoneCount: 1,
        skippedPhoneCount: 0,
        warnings: ["The email address was checked for duplicates but is not stored yet."],
      }],
    });
  });

  it("leaves a number this tenant already holds where it is, and says so on the row", async () => {
    mockIdentityFindFirst.mockResolvedValue({ id: "identity-9", contactId: "contact-other" });
    const result = await crmActions.importContacts({
      csv: "name,phone\nAisha,012-345 6789",
      importId: "import-3",
    });
    expect(mockIdentityCreate).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: true,
      importedCount: 1,
      rows: [{
        status: "imported_with_warning",
        storedPhoneCount: 0,
        skippedPhoneCount: 1,
        warnings: ["+60123456789 is already saved on another contact, so it was not added here."],
      }],
    });
  });

  it("keeps the created contact and clearly surfaces an engine rejection on that row", async () => {
    mockRecordConsentEvent.mockRejectedValue({ code: "IDEMPOTENCY_CONFLICT" });
    const result = await crmActions.importContacts({
      csv: "name,consent\nAisha,opt_out",
      importId: "import-conflict",
    });
    expect(result).toMatchObject({
      ok: true,
      importedCount: 1,
      rows: [{
        status: "imported_with_warning",
        consentAssertion: null,
        consentError: "This request was already used for a different consent record. Start a new attempt.",
      }],
    });
  });
});

describe("sole-writer compliance", () => {
  it("contains no direct app write for consent/DND compatibility fields or identity/merge path", () => {
    const source = readFileSync(new URL("../crm-actions.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/\b(marketingConsent|consentSource|consentAt|doNotDisturb)\s*:/);
    expect(source).not.toContain("mergeContacts");
    // #803 opened an identity write path — for ONE grade only. No caller-supplied grade, and no
    // way for this file to write the verified one.
    expect(source).not.toMatch(/verificationStatus:\s*(input|patch|raw)/);
    expect(source).not.toMatch(/verificationStatus:\s*CHANNEL_VERIFIED_IDENTITY/);
    expect(source).toContain("recordConsentEvent");
    expect(source).toContain("recordContactDndEvent");
  });
});
