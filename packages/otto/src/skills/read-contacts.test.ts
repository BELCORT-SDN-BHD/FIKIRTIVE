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

/**
 * #742 — the merchant asks "which customers do I have?" and the answer is built from ONE PAGE.
 * The Contacts page has said so out loud since #715 ("Showing 50 of 65 contacts"); the skill
 * handed the model 50 rows and no counts, so the same cut went unmentioned in chat.
 *
 * The counts are carried, not re-derived: `returned` and `totalCount` come from the port (the
 * same owner-scoped read and the same owner-scoped count the page uses), and this skill passes
 * them straight through. Nothing here re-counts anything — a second count is a second answer.
 */
describe("readContacts — #742 a page is never handed over as the whole list", () => {
  function port(page: unknown) {
    return {
      list: vi.fn().mockResolvedValue(page),
      search: vi.fn().mockResolvedValue(page),
      get: vi.fn(), create: vi.fn(), update: vi.fn(),
      importCsv: vi.fn(), recordConsent: vi.fn(), setDnd: vi.fn(),
    } satisfies NonNullable<OttoContext["contacts"]>;
  }

  const TRUNCATED = {
    ok: true as const,
    contacts: [],
    returned: 50,
    totalCount: 65,
    hasMore: true,
  };

  it("carries the total and the truncation flag through list", async () => {
    const contacts = port(TRUNCATED);
    const res = await executeReadContacts({ operation: "list" }, context(contacts)) as
      { returned: number; totalCount: number; hasMore: boolean };

    expect(res.returned).toBe(50);
    expect(res.totalCount).toBe(65);
    expect(res.hasMore).toBe(true);
  });

  it("carries them through search too — the same cut, the same admission", async () => {
    const contacts = port(TRUNCATED);
    const res = await executeReadContacts({ operation: "search", query: "Bulk" }, context(contacts)) as
      { returned: number; totalCount: number; hasMore: boolean };

    expect(res.returned).toBe(50);
    expect(res.totalCount).toBe(65);
    expect(res.hasMore).toBe(true);
  });

  it("tells the model, in the contract it actually reads, to say both numbers", () => {
    const description = readContactsSkill.description;
    expect(description).toMatch(/totalCount/);
    expect(description).toMatch(/hasMore/);
    expect(description).toMatch(/returned/);
    // The failure mode is not "omits a field" — it is answering a headcount question off a
    // page. The contract has to name that, not just list the fields.
    expect(description).toMatch(/one page/i);
  });
});
