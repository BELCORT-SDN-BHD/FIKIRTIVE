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
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth-guard", () => ({ requireOwner: mockRequireOwner }));
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: mockIsImpersonating }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../crm-identity", () => ({
  isCrmLifecycleStage: (value: unknown) => ["New", "Active", "Dormant"].includes(String(value)),
  normalizeContactIdentity: ({ channel, externalId }: { channel: string; externalId: string }) => ({
    channel,
    externalId: channel === "email" ? externalId.trim().toLowerCase() : externalId.replace(/[\s().-]/g, ""),
    handle: null,
    label: null,
  }),
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
    actionEvent: { create: mockAuditCreate },
  },
  recordConsentEvent: mockRecordConsentEvent,
  recordContactDndEvent: mockRecordContactDndEvent,
}));

let id = 0;
vi.mock("@fikirtive/core", () => ({ newId: () => `crm-${++id}` }));

import * as crmActions from "../crm-actions";

const OWNER = "org-a";

function transactionClient() {
  return {
    contact: {
      findFirst: mockContactFindFirst,
      create: mockContactCreate,
      updateMany: mockContactUpdateMany,
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
  mockTransaction.mockImplementation(async (callback: (tx: ReturnType<typeof transactionClient>) => unknown) =>
    callback(transactionClient()),
  );
});

describe("CRM action boundary", () => {
  it("exports the bounded action set with no merge action", () => {
    expect(Object.keys(crmActions).sort()).toEqual([
      "createContact",
      "importContacts",
      "setContactConsent",
      "setContactDnd",
      "setContactDndFromOtto",
      "updateContact",
    ]);
  });

  it("blocks every mutation while impersonating", async () => {
    mockIsImpersonating.mockResolvedValue(true);
    await expect(crmActions.createContact({ name: "Aisha" })).resolves.toHaveProperty("error");
    await expect(crmActions.updateContact({ contactId: "contact-1", patch: { name: "A" } })).resolves.toHaveProperty("error");
    await expect(crmActions.setContactConsent({ contactId: "contact-1", action: "grant", requestId: "r1" })).resolves.toHaveProperty("error");
    await expect(crmActions.setContactDnd({ contactId: "contact-1", enabled: true, requestId: "r2" })).resolves.toHaveProperty("error");
    await expect(crmActions.importContacts({ csv: "name\nBo", importId: "i1" })).resolves.toHaveProperty("error");
    expect(mockTransaction).not.toHaveBeenCalled();
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

describe("importContacts", () => {
  it("never fabricates consent when the column is absent or unknown", async () => {
    const result = await crmActions.importContacts({
      csv: "name,lifecycle_stage,consent\nAisha,Active,\nBo,New,unknown",
      importId: "import-1",
    });
    expect(result).toMatchObject({ ok: true, importedCount: 2, failedCount: 0 });
    expect(mockRecordConsentEvent).not.toHaveBeenCalled();
    expect(mockContactCreate).toHaveBeenCalledTimes(2);
    for (const call of mockContactCreate.mock.calls) {
      expect(call[0].data.source).toBe("import");
      expect(call[0].data).not.toHaveProperty("marketingConsent");
    }
  });

  it("uses phone/email only for suggestions and records an optional import assertion through the engine", async () => {
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
    expect(result).toMatchObject({
      ok: true,
      rows: [{
        status: "imported_with_warning",
        consentAssertion: "grant",
        possibleDuplicates: [{ contactId: "possible-1" }],
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
    expect(source).not.toContain("prisma.contactIdentity");
    expect(source).not.toContain("mergeContacts");
    expect(source).toContain("recordConsentEvent");
    expect(source).toContain("recordContactDndEvent");
  });
});
