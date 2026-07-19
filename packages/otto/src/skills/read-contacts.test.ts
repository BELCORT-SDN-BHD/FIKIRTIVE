import { describe, expect, it, vi } from "vitest";
import type { OttoContext } from "../context.js";
import { executeReadContacts, readContactsSkill } from "./read-contacts.js";

function context(contacts: NonNullable<OttoContext["contacts"]>) {
  return { context: { contacts } as OttoContext };
}

describe("readContacts", () => {
  it("is a free internal read and requires exact ids for get", async () => {
    expect(readContactsSkill).toMatchObject({
      name: "readContacts",
      cost: "free",
      effect: "read",
      reach: "internal",
      needsApproval: false,
    });
    const contacts = {
      list: vi.fn(), get: vi.fn(), search: vi.fn(), create: vi.fn(), update: vi.fn(),
      importCsv: vi.fn(), recordConsent: vi.fn(), setDnd: vi.fn(),
    } satisfies NonNullable<OttoContext["contacts"]>;
    await expect(executeReadContacts({ operation: "get" }, context(contacts))).resolves.toEqual({
      ok: false,
      error: "get needs the exact `contactId` from list or search.",
    });
    expect(contacts.get).not.toHaveBeenCalled();
  });

  it("routes list, get, and search through the injected port", async () => {
    const contacts = {
      list: vi.fn().mockResolvedValue({ ok: true, contacts: [] }),
      get: vi.fn().mockResolvedValue({ error: "Contact not found." }),
      search: vi.fn().mockResolvedValue({ ok: true, contacts: [] }),
      create: vi.fn(), update: vi.fn(), importCsv: vi.fn(), recordConsent: vi.fn(), setDnd: vi.fn(),
    } satisfies NonNullable<OttoContext["contacts"]>;
    await executeReadContacts({ operation: "list", lifecycleStage: "Active", limit: 10 }, context(contacts));
    await executeReadContacts({ operation: "get", contactId: "contact-1" }, context(contacts));
    await executeReadContacts({ operation: "search", query: "Aisha", limit: 5 }, context(contacts));

    expect(contacts.list).toHaveBeenCalledWith({ lifecycleStage: "Active", limit: 10 });
    expect(contacts.get).toHaveBeenCalledWith("contact-1");
    expect(contacts.search).toHaveBeenCalledWith({ query: "Aisha", lifecycleStage: undefined, limit: 5 });
  });
});
