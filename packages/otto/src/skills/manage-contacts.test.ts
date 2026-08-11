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

  /**
   * r2 (判词 5232132441 P3③) — the three phone operations were only represented by a fake port
   * with the right shape. A port that exists proves nothing about routing: these assert the exact
   * arguments each operation forwards, and that a missing field reaches no port at all.
   */
  it("routes the three phone operations to their own port methods with exact arguments", async () => {
    const contacts = port();
    await executeManageContacts(
      { operation: "add_phone", contactId: "contact-1", phone: "012-345 6789" },
      context(contacts),
    );
    await executeManageContacts(
      { operation: "update_phone", contactId: "contact-1", identityId: "identity-1", phone: "+60123456780" },
      context(contacts),
    );
    await executeManageContacts(
      { operation: "remove_phone", contactId: "contact-1", identityId: "identity-1" },
      context(contacts),
    );

    expect(contacts.addPhone).toHaveBeenCalledWith({ contactId: "contact-1", phone: "012-345 6789" });
    expect(contacts.updatePhone).toHaveBeenCalledWith({
      contactId: "contact-1",
      identityId: "identity-1",
      phone: "+60123456780",
    });
    expect(contacts.removePhone).toHaveBeenCalledWith({ contactId: "contact-1", identityId: "identity-1" });
    // No phone operation may reach a writer that decides consent, DND, or the contact record.
    expect(contacts.recordConsent).not.toHaveBeenCalled();
    expect(contacts.setDnd).not.toHaveBeenCalled();
    expect(contacts.update).not.toHaveBeenCalled();
  });

  it("fails closed when a phone operation is missing a field, without touching the port", async () => {
    const contacts = port();
    await expect(executeManageContacts({ operation: "add_phone", contactId: "contact-1" }, context(contacts)))
      .resolves.toMatchObject({ ok: false });
    await expect(executeManageContacts({ operation: "add_phone", phone: "0123456789" }, context(contacts)))
      .resolves.toMatchObject({ ok: false });
    await expect(executeManageContacts(
      { operation: "update_phone", contactId: "contact-1", phone: "0123456789" },
      context(contacts),
    )).resolves.toMatchObject({ ok: false });
    await expect(executeManageContacts(
      { operation: "update_phone", contactId: "contact-1", identityId: "identity-1" },
      context(contacts),
    )).resolves.toMatchObject({ ok: false });
    await expect(executeManageContacts({ operation: "remove_phone", contactId: "contact-1" }, context(contacts)))
      .resolves.toMatchObject({ ok: false });

    expect(contacts.addPhone).not.toHaveBeenCalled();
    expect(contacts.updatePhone).not.toHaveBeenCalled();
    expect(contacts.removePhone).not.toHaveBeenCalled();
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
