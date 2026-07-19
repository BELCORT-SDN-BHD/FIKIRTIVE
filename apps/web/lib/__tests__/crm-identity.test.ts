import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const { mockContactFindMany } = vi.hoisted(() => ({ mockContactFindMany: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@fikirtive/db", () => ({ prisma: { contact: { findMany: mockContactFindMany } } }));

import {
  findContactDuplicateSuggestions,
  normalizeContactIdentity,
} from "../crm-identity";

beforeEach(() => {
  vi.clearAllMocks();
  mockContactFindMany.mockResolvedValue([]);
});

describe("normalizeContactIdentity", () => {
  it("normalizes only deterministic phone/email forms and never guesses a country code", () => {
    expect(normalizeContactIdentity({ channel: " WhatsApp ", externalId: "+60 12-345 6789" }))
      .toMatchObject({ channel: "whatsapp", externalId: "+60123456789" });
    expect(normalizeContactIdentity({ channel: "email", externalId: " AISHA@Example.COM " }))
      .toMatchObject({ channel: "email", externalId: "aisha@example.com" });
    expect(normalizeContactIdentity({ channel: "whatsapp", externalId: "0123456789" }))
      .toEqual({ error: "Use a WhatsApp number in E.164 format, including the country code." });
  });
});

describe("findContactDuplicateSuggestions", () => {
  it("is owner-scoped, deterministic, and returns reasons without mutating or merging", async () => {
    mockContactFindMany.mockResolvedValue([
      {
        id: "contact-1",
        name: "Aisha",
        identities: [
          { channel: "whatsapp", externalId: "+60123456789" },
          { channel: "email", externalId: "aisha@example.com" },
        ],
      },
    ]);
    const identities = [
      normalizeContactIdentity({ channel: "email", externalId: "aisha@example.com" }),
      normalizeContactIdentity({ channel: "whatsapp", externalId: "+60123456789" }),
    ].filter((value): value is Exclude<typeof value, { error: string }> => !("error" in value));

    const first = await findContactDuplicateSuggestions({ ownerId: "org-a", name: " aisha ", identities });
    const second = await findContactDuplicateSuggestions({ ownerId: "org-a", name: " aisha ", identities });

    expect(first).toEqual(second);
    expect(first).toEqual([{
      contactId: "contact-1",
      name: "Aisha",
      reasons: ["Same WhatsApp number", "Same email address", "Same name"],
    }]);
    const query = mockContactFindMany.mock.calls[0][0];
    expect(query.where.ownerId).toBe("org-a");
    expect(query.select.identities.where).toEqual({ ownerId: "org-a", deletedAt: null });
    expect(query.orderBy).toEqual([{ name: "asc" }, { id: "asc" }]);
    expect(JSON.stringify(query.where.OR)).toContain('"ownerId":"org-a"');
  });

  it("excludes the current Contact inside the same owner fence", async () => {
    await findContactDuplicateSuggestions({
      ownerId: "org-b",
      name: "Bo",
      excludeContactId: "contact-current",
    });
    expect(mockContactFindMany.mock.calls[0][0].where).toMatchObject({
      ownerId: "org-b",
      id: { not: "contact-current" },
      deletedAt: null,
    });
  });
});

describe("identity write fence", () => {
  it("contains normalization and read suggestions only", () => {
    const source = readFileSync(new URL("../crm-identity.ts", import.meta.url), "utf8");
    expect(source).not.toContain("contactIdentity.create");
    expect(source).not.toContain("contactIdentity.update");
    expect(source).not.toContain("findOrCreateContactByIdentity");
    expect(source).not.toContain("$transaction");
  });
});
