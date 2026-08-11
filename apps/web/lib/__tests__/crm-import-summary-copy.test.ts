/**
 * #803 r2/r3 — the one line the CSV import card prints about phone numbers.
 *
 * It kept overclaiming in shapes the happy path never produced:
 *  r2 (判词 5232132441 P2②) it announced "phone numbers were saved" for every file, including a
 *  file with no phone column at all and a file where every row failed;
 *  r3 (r2 判词追加 P2) it still appended "Saved numbers are not used for broadcasts" when NOTHING
 *  was saved — and the numbers it skipped sit on other contacts, where a connected channel may
 *  already have verified them. A caveat about rows this import did not write is a claim about
 *  someone else's rows.
 *
 * So the sentence is built from the row counts, and each clause may only appear when the thing it
 * describes actually happened.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/crm-view-data", () => ({ listContacts: vi.fn() }));
vi.mock("@/lib/crm-actions", () => ({ createContact: vi.fn(), importContacts: vi.fn() }));

import { importPhoneSummary } from "@/components/crm/contacts-page";

type Row = Parameters<typeof importPhoneSummary>[0][number];

function row(overrides: Partial<Row>): Row {
  return {
    rowNumber: 2,
    name: "Aisha",
    status: "imported",
    contactId: "contact-1",
    possibleDuplicates: [],
    consentAssertion: null,
    storedPhoneCount: 0,
    skippedPhoneCount: 0,
    warnings: [],
    ...overrides,
  } as Row;
}

describe("CSV import phone summary", () => {
  it("says nothing about phones when the file carried no phone column", () => {
    expect(importPhoneSummary([row({}), row({ rowNumber: 3 })])).toBe(
      "No phone numbers were stored from this file.",
    );
  });

  it("says nothing about phones when every row failed", () => {
    const failed = row({ status: "failed", contactId: null, warnings: ["Couldn't save that contact."] });
    expect(importPhoneSummary([failed])).toBe("No phone numbers were stored from this file.");
  });

  it("counts what was stored, and only then warns that stored numbers are not messaged", () => {
    const summary = importPhoneSummary([row({ storedPhoneCount: 1 }), row({ rowNumber: 3, storedPhoneCount: 2 })]);
    expect(summary).toBe("3 phone numbers saved as not verified. Saved numbers are not used for broadcasts.");
  });

  /**
   * r3 — the shape the r2 fix still got wrong. Nothing was written, so there is no "saved number"
   * to make a promise about, and the skipped numbers belong to contacts this import never touched.
   */
  it("drops the broadcast caveat entirely when every number was skipped as a conflict", () => {
    const summary = importPhoneSummary([
      row({ storedPhoneCount: 0, skippedPhoneCount: 1 }),
      row({ rowNumber: 3, storedPhoneCount: 0, skippedPhoneCount: 2 }),
    ]);
    expect(summary).toBe(
      "3 skipped because they are already saved on another contact.",
    );
    expect(summary).not.toContain("broadcasts");
    expect(summary).not.toContain("saved as not verified");
  });

  it("reports both halves when a file both stored and skipped numbers", () => {
    const summary = importPhoneSummary([
      row({ storedPhoneCount: 1 }),
      row({ rowNumber: 3, skippedPhoneCount: 1 }),
    ]);
    expect(summary).toBe(
      "1 phone number saved as not verified · 1 skipped because it is already saved on another contact."
        + " Saved numbers are not used for broadcasts.",
    );
  });
});
