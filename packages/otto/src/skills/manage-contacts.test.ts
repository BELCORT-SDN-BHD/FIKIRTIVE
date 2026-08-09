import { describe, expect, it, vi } from "vitest";
import type { OttoContext } from "../context.js";
import { executeManageContacts, manageContactsSkill } from "./manage-contacts.js";

function port() {
  return {
    list: vi.fn(), get: vi.fn(), search: vi.fn(), create: vi.fn(), update: vi.fn(),
    importCsv: vi.fn(), recordConsent: vi.fn(), setDnd: vi.fn(),
    addPhone: vi.fn(), updatePhone: vi.fn(), removePhone: vi.fn(),
  } satisfies NonNullable<OttoContext["contacts"]>;
}

function context(contacts: NonNullable<OttoContext["contacts"]>) {
  return { context: { contacts } as OttoContext };
}

describe("manageContacts", () => {
  it("is a free internal write with no approval or external reach", () => {
    expect(manageContactsSkill).toMatchObject({
      name: "manageContacts",
      cost: "free",
      effect: "write",
      reach: "internal",
      needsApproval: false,
    });
  });

  it("routes structured create/update/import/consent/DND operations through the port", async () => {
    const contacts = port();
    await executeManageContacts({ operation: "create", name: "Aisha", lifecycleStage: "New" }, context(contacts));
    await executeManageContacts({ operation: "update", contactId: "contact-1", patch: { lifecycleStage: "Active" } }, context(contacts));
    await executeManageContacts({ operation: "import_csv", csv: "name\nBo", importId: "import-1" }, context(contacts));
    await executeManageContacts({ operation: "record_consent", contactId: "contact-1", consentAction: "grant", requestId: "consent-1" }, context(contacts));
    await executeManageContacts({ operation: "set_dnd", contactId: "contact-1", enabled: true, requestId: "dnd-1" }, context(contacts));

    expect(contacts.create).toHaveBeenCalledWith({ name: "Aisha", lifecycleStage: "New" });
    expect(contacts.update).toHaveBeenCalledWith({ contactId: "contact-1", patch: { lifecycleStage: "Active" } });
    expect(contacts.importCsv).toHaveBeenCalledWith({ csv: "name\nBo", importId: "import-1" });
    expect(contacts.recordConsent).toHaveBeenCalledWith({ contactId: "contact-1", action: "grant", requestId: "consent-1" });
    expect(contacts.setDnd).toHaveBeenCalledWith({ contactId: "contact-1", enabled: true, requestId: "dnd-1" });
  });

  it("fails closed when structured fields are missing", async () => {
    const contacts = port();
    await expect(executeManageContacts({ operation: "record_consent", contactId: "contact-1" }, context(contacts)))
      .resolves.toMatchObject({ ok: false });
    await expect(executeManageContacts({ operation: "set_dnd", contactId: "contact-1", enabled: false }, context(contacts)))
      .resolves.toMatchObject({ ok: false });
    expect(contacts.recordConsent).not.toHaveBeenCalled();
    expect(contacts.setDnd).not.toHaveBeenCalled();
  });
});
