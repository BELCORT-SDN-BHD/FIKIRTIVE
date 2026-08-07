import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const {
  mockRequireOwner,
  mockIsImpersonating,
  mockContactFindMany,
  mockConsentProjectionFindMany,
  mockConsentEventFindMany,
  mockSegmentFindMany,
  mockSegmentFindFirst,
  mockSegmentCreate,
  mockSegmentUpdateMany,
  mockNewId,
  mockRevalidatePath,
} = vi.hoisted(() => ({
  mockRequireOwner: vi.fn(),
  mockIsImpersonating: vi.fn(),
  mockContactFindMany: vi.fn(),
  mockConsentProjectionFindMany: vi.fn(),
  mockConsentEventFindMany: vi.fn(),
  mockSegmentFindMany: vi.fn(),
  mockSegmentFindFirst: vi.fn(),
  mockSegmentCreate: vi.fn(),
  mockSegmentUpdateMany: vi.fn(),
  mockNewId: vi.fn(),
  mockRevalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth-guard", () => ({ requireOwner: mockRequireOwner }));
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: mockIsImpersonating }));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    contact: { findMany: mockContactFindMany },
    consentStateProjection: { findMany: mockConsentProjectionFindMany },
    consentEvent: { findMany: mockConsentEventFindMany },
    segment: {
      findMany: mockSegmentFindMany,
      findFirst: mockSegmentFindFirst,
      create: mockSegmentCreate,
      updateMany: mockSegmentUpdateMany,
    },
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));
vi.mock("@fikirtive/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@fikirtive/core")>()),
  newId: mockNewId,
}));

import * as segmentActions from "../segment-actions";

const { buildSegment, getSegment, listSegments, previewSegment } = segmentActions;

const SEGMENT_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const NEXT_SEGMENT_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
const TEST_SECRET = "segment-actions-test-secret";

function draftProof(ownerId: string, segmentId: string): string {
  return createHmac("sha256", TEST_SECRET)
    .update(JSON.stringify(["fikirtive:crm-segment-draft:v1", ownerId, segmentId]))
    .digest("base64url");
}

const SEGMENT_PROOF = draftProof("owner-1", SEGMENT_ID);
const NEXT_SEGMENT_PROOF = draftProof("owner-1", NEXT_SEGMENT_ID);

const spendRules = {
  match: "all" as const,
  rules: [
    { kind: "lifetime_spend" as const, comparison: "at_least" as const, amountMyr: 500 },
    { kind: "contactability" as const, value: "contactable" as const },
  ],
};

const contacts = [
  {
    id: "contact-1",
    name: "Amina",
    totalOrdersMyr: "1200.50",
    doNotDisturb: false,
    marketingConsent: "unknown",
    identities: [{ channel: "whatsapp" }, { channel: "email" }],
  },
  {
    id: "contact-2",
    name: "Bo",
    totalOrdersMyr: "800",
    doNotDisturb: false,
    marketingConsent: "unknown",
    identities: [{ channel: "email" }],
  },
];

/** #726 — consent comes from the projection authority, never from a Contact column. */
function projection(contactId: string, state: string) {
  return { contactId, state };
}

const consentProjections = [projection("contact-2", "effective_revoke")];

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-15T03:04:05.000Z"));
  process.env.BETTER_AUTH_SECRET = TEST_SECRET;
  mockRequireOwner.mockResolvedValue({ ownerId: "owner-1" });
  mockIsImpersonating.mockResolvedValue(false);
  mockContactFindMany.mockResolvedValue(contacts);
  mockConsentProjectionFindMany.mockResolvedValue(consentProjections);
  mockConsentEventFindMany.mockResolvedValue([]);
  mockSegmentFindMany.mockResolvedValue([]);
  mockSegmentFindFirst.mockResolvedValue(null);
  mockSegmentCreate.mockResolvedValue({
    id: SEGMENT_ID,
    name: "VIP buyers",
    phrase: "All of: Lifetime spend is at least RM500 and contact is not a known opt-out",
    rulesJson: spendRules,
    kind: "custom",
    createdAt: new Date("2026-07-15T03:04:05.000Z"),
  });
  mockNewId.mockReturnValue(NEXT_SEGMENT_ID);
  mockSegmentUpdateMany.mockResolvedValue({ count: 1 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("segment action boundary", () => {
  it("exports exactly the four signed server actions", () => {
    expect(Object.keys(segmentActions).sort()).toEqual([
      "buildSegment",
      "getSegment",
      "listSegments",
      "previewSegment",
    ]);
  });

  it("authenticates every action independently and stops before data access", async () => {
    mockRequireOwner.mockResolvedValue({ error: "Sign in required." });

    await expect(listSegments()).resolves.toEqual({ error: "Sign in required." });
    await expect(getSegment(SEGMENT_ID)).resolves.toEqual({ error: "Sign in required." });
    await expect(previewSegment(spendRules)).resolves.toEqual({ error: "Sign in required." });
    await expect(
      buildSegment({ segmentId: SEGMENT_ID, name: "VIP buyers", rules: spendRules }),
    ).resolves.toEqual({ error: "Sign in required." });

    expect(mockRequireOwner).toHaveBeenCalledTimes(4);
    expect(mockContactFindMany).not.toHaveBeenCalled();
    expect(mockSegmentFindMany).not.toHaveBeenCalled();
    expect(mockSegmentFindFirst).not.toHaveBeenCalled();
    expect(mockSegmentCreate).not.toHaveBeenCalled();
  });
});

describe("previewSegment", () => {
  it("uses only owner-scoped live facts, never lastSeenAt, and performs no writes", async () => {
    const result = await previewSegment(spendRules);

    expect(mockContactFindMany).toHaveBeenCalledWith({
      where: { ownerId: "owner-1", deletedAt: null },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        totalOrdersMyr: true,
        doNotDisturb: true,
        marketingConsent: true,
        identities: {
          where: { ownerId: "owner-1", deletedAt: null },
          select: { channel: true },
        },
      },
    });
    expect(JSON.stringify(mockContactFindMany.mock.calls[0])).not.toContain("lastSeenAt");
    expect(result).toEqual({
      ok: true,
      evaluatedAt: "2026-07-15T03:04:05.000Z",
      phrase: "All of: Lifetime spend is at least RM500 and contact is not a known opt-out",
      matchedCount: 1,
      contactableCount: 1,
      knownOptOutCount: 0,
      // Bo clears the spend threshold and is a known opt-out: the consent rule is what
      // removed him, and the merchant is told so instead of reading a bare "0" (#726).
      excludedByConsentCount: 1,
      unresolvedLegacyOptOutCount: 0,
      reportedOptOutCount: 0,
      contacts: [
        {
          id: "contact-1",
          name: "Amina",
          channels: ["email", "whatsapp"],
          contactable: true,
          reportedOptOut: false,
          unresolvedLegacyOptOut: false,
        },
      ],
      // #715 — the preview frames its match count against the same owner total the
      // contacts list publishes, so the two pages can't disagree.
      totalContactCount: 2,
      unavailableFacts: { lastOrderAt: true, tags: true },
    });
    expect(mockSegmentCreate).not.toHaveBeenCalled();
  });

  it("rejects nested or otherwise invalid rules without reading contacts", async () => {
    const nested = await previewSegment({
      match: "all",
      rules: [{ match: "any", rules: [] }],
    });
    const empty = await previewSegment({ match: "all", rules: [] });

    expect(nested).toEqual({ error: "Choose valid segment rules." });
    expect(empty).toEqual({ error: "Choose valid segment rules." });
    expect(mockContactFindMany).not.toHaveBeenCalled();
  });

  it("preserves the locked All and Any matching semantics", async () => {
    const leaves = [
      { kind: "lifetime_spend" as const, comparison: "at_least" as const, amountMyr: 1000 },
      { kind: "channel" as const, channel: "email" },
    ];

    const all = await previewSegment({ match: "all", rules: leaves });
    const any = await previewSegment({ match: "any", rules: leaves });

    expect(all).toMatchObject({ ok: true, matchedCount: 1 });
    expect(any).toMatchObject({ ok: true, matchedCount: 2 });
  });

  it("keeps unknown and DND contacts selected while visibly excluding only known opt-out", async () => {
    mockContactFindMany.mockResolvedValue([
      contacts[0],
      contacts[1],
      {
        id: "contact-3",
        name: "Chen",
        totalOrdersMyr: "900",
        doNotDisturb: false,
        identities: [{ channel: "whatsapp" }],
      },
      {
        id: "contact-4",
        name: "Dina",
        totalOrdersMyr: "700",
        doNotDisturb: true,
        identities: [{ channel: "whatsapp" }],
      },
    ]);
    mockConsentProjectionFindMany.mockResolvedValue([
      ...consentProjections,
      projection("contact-4", "verified_grant"),
    ]);

    const result = await previewSegment({
      match: "all",
      rules: [{ kind: "lifetime_spend", comparison: "at_least", amountMyr: 0 }],
    });

    expect(result).toMatchObject({
      ok: true,
      matchedCount: 4,
      contactableCount: 3,
      knownOptOutCount: 1,
      contacts: expect.arrayContaining([
        expect.objectContaining({ id: "contact-2", contactable: false }),
        expect.objectContaining({ id: "contact-3", contactable: true }),
        expect.objectContaining({ id: "contact-4", contactable: true }),
      ]),
    });

    await expect(
      previewSegment({
        match: "all",
        rules: [{ kind: "contactability", value: "contactable" }],
      }),
    ).resolves.toMatchObject({
      matchedCount: 3,
      contactableCount: 3,
      knownOptOutCount: 0,
      // #726 — "0 known opt-out excluded" used to be printed even when the rule had just
      // removed someone. It now counts what the rule actually kept out.
      excludedByConsentCount: 1,
    });
    await expect(
      previewSegment({
        match: "all",
        rules: [{ kind: "contactability", value: "not_contactable" }],
      }),
    ).resolves.toMatchObject({ matchedCount: 1, contactableCount: 0, knownOptOutCount: 1 });
  });

  it("keeps a pre-ledger opt-out out until the customer's own evidence releases it", async () => {
    // R-010 §4.6.5 — an opt-out recorded before this contact had a consent history is a known
    // historical revoke. Moving selection onto the ledger must not be what puts her back.
    mockContactFindMany.mockResolvedValue([{ ...contacts[0], marketingConsent: "opt_out" }]);
    mockConsentProjectionFindMany.mockResolvedValue([]);

    await expect(
      previewSegment({ match: "all", rules: [{ kind: "contactability", value: "contactable" }] }),
    ).resolves.toMatchObject({
      matchedCount: 0,
      excludedByConsentCount: 1,
      unresolvedLegacyOptOutCount: 1,
    });

    // The merchant's own newer assertion cannot release it — only the customer's verified
    // opt-in, which folds the ledger to a verified grant, supersedes the pre-ledger byte.
    mockConsentProjectionFindMany.mockResolvedValue([projection("contact-1", "unknown")]);
    mockConsentEventFindMany.mockResolvedValue([{ contactId: "contact-1", action: "grant" }]);
    await expect(
      previewSegment({ match: "all", rules: [{ kind: "contactability", value: "contactable" }] }),
    ).resolves.toMatchObject({ matchedCount: 0, unresolvedLegacyOptOutCount: 1 });

    mockConsentProjectionFindMany.mockResolvedValue([projection("contact-1", "verified_grant")]);
    await expect(
      previewSegment({ match: "all", rules: [{ kind: "contactability", value: "contactable" }] }),
    ).resolves.toMatchObject({
      matchedCount: 1,
      excludedByConsentCount: 0,
      unresolvedLegacyOptOutCount: 0,
    });
  });

  it("marks an opt-out the merchant recorded himself without ever excluding him", async () => {
    // #716 — the projection is still `unknown` (a merchant assertion is not verified evidence),
    // and its last event is that assertion. The page has to show it, not swallow it.
    mockConsentProjectionFindMany.mockResolvedValue([projection("contact-1", "unknown")]);
    mockConsentEventFindMany.mockResolvedValue([{ contactId: "contact-1", action: "revoke" }]);

    const result = await previewSegment({
      match: "all",
      rules: [{ kind: "contactability", value: "contactable" }],
    });

    expect(mockConsentEventFindMany).toHaveBeenCalledWith({
      where: {
        ownerId: "owner-1",
        channel: "whatsapp",
        purpose: "marketing",
        actorKind: "merchant",
      },
      select: { contactId: true, action: true },
      orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
    });
    expect(result).toMatchObject({
      ok: true,
      matchedCount: 2,
      contactableCount: 2,
      excludedByConsentCount: 0,
      reportedOptOutCount: 1,
      contacts: expect.arrayContaining([
        expect.objectContaining({ id: "contact-1", contactable: true, reportedOptOut: true }),
        expect.objectContaining({ id: "contact-2", contactable: true, reportedOptOut: false }),
      ]),
    });
  });

  it("rejects a spend threshold the Decimal(14,2) facts cannot represent exactly", async () => {
    const result = await previewSegment({
      match: "all",
      rules: [{ kind: "lifetime_spend", comparison: "at_least", amountMyr: 500.004 }],
    });

    expect(result).toEqual({ error: "Use no more than two decimal places for lifetime spend." });
    expect(mockContactFindMany).not.toHaveBeenCalled();
  });

  it("fails closed for facts the contact model cannot supply", async () => {
    const result = await previewSegment({
      match: "any",
      rules: [
        { kind: "last_order_recency", withinDays: 30 },
        { kind: "tag", tag: "vip" },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      matchedCount: 0,
      contactableCount: 0,
      knownOptOutCount: 0,
      contacts: [],
      unavailableFacts: { lastOrderAt: true, tags: true },
    });
  });
});

describe("listSegments", () => {
  it("lists only live custom segments and recomputes their canonical phrase and counts", async () => {
    mockSegmentFindMany.mockResolvedValue([
      {
        id: SEGMENT_ID,
        name: "VIP buyers",
        phrase: "untrusted stored phrase",
        rulesJson: spendRules,
        createdAt: new Date("2026-07-14T00:00:00.000Z"),
      },
    ]);

    const result = await listSegments();

    expect(mockSegmentFindMany).toHaveBeenCalledWith({
      where: { ownerId: "owner-1", kind: "custom", deletedAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      select: { id: true, name: true, phrase: true, rulesJson: true, createdAt: true },
    });
    expect(result).toEqual({
      ok: true,
      evaluatedAt: "2026-07-15T03:04:05.000Z",
      nextSegmentId: NEXT_SEGMENT_ID,
      nextSegmentProof: NEXT_SEGMENT_PROOF,
      segments: [
        {
          id: SEGMENT_ID,
          name: "VIP buyers",
          phrase: "All of: Lifetime spend is at least RM500 and contact is not a known opt-out",
          rules: spendRules,
          status: "ready",
          matchedCount: 1,
          contactableCount: 1,
          knownOptOutCount: 0,
          excludedByConsentCount: 1,
          unresolvedLegacyOptOutCount: 0,
          reportedOptOutCount: 0,
          createdAt: "2026-07-14T00:00:00.000Z",
        },
      ],
      totalContactCount: 2,
      unavailableFacts: { lastOrderAt: true, tags: true },
    });
  });

  it("marks malformed persisted rules unavailable instead of treating them as all contacts", async () => {
    mockSegmentFindMany.mockResolvedValue([
      {
        id: SEGMENT_ID,
        name: "Broken segment",
        phrase: "Everyone",
        rulesJson: { match: "all", rules: [] },
        createdAt: new Date("2026-07-14T00:00:00.000Z"),
      },
    ]);

    const result = await listSegments();

    expect(result).toMatchObject({
      ok: true,
      segments: [
        {
          id: SEGMENT_ID,
          phrase: "Rules unavailable",
          rules: null,
          status: "unavailable",
          matchedCount: 0,
          contactableCount: 0,
          knownOptOutCount: 0,
        },
      ],
    });
  });

  it("marks persisted spend precision beyond cents unavailable instead of rounding its phrase", async () => {
    mockSegmentFindMany.mockResolvedValue([
      {
        id: SEGMENT_ID,
        name: "Too precise",
        phrase: "Lifetime spend is at least RM500",
        rulesJson: {
          match: "all",
          rules: [{ kind: "lifetime_spend", comparison: "at_least", amountMyr: 500.004 }],
        },
        createdAt: new Date("2026-07-14T00:00:00.000Z"),
      },
    ]);

    const result = await listSegments();
    expect(result).toMatchObject({
      ok: true,
      segments: [{ status: "unavailable", phrase: "Rules unavailable", matchedCount: 0 }],
    });
  });
});

describe("getSegment", () => {
  it("reads one exact owner-scoped custom segment with deterministic live counts", async () => {
    mockSegmentFindFirst.mockResolvedValue({
      id: SEGMENT_ID,
      name: "VIP buyers",
      phrase: "untrusted stored phrase",
      rulesJson: spendRules,
      createdAt: new Date("2026-07-14T00:00:00.000Z"),
    });

    const result = await getSegment(SEGMENT_ID);

    expect(mockSegmentFindFirst).toHaveBeenCalledWith({
      where: { id: SEGMENT_ID, ownerId: "owner-1", kind: "custom", deletedAt: null },
      select: { id: true, name: true, phrase: true, rulesJson: true, createdAt: true },
    });
    expect(result).toMatchObject({
      ok: true,
      evaluatedAt: "2026-07-15T03:04:05.000Z",
      segment: {
        id: SEGMENT_ID,
        phrase: "All of: Lifetime spend is at least RM500 and contact is not a known opt-out",
        matchedCount: 1,
        contactableCount: 1,
        knownOptOutCount: 0,
      },
    });
  });

  it("does not reveal a cross-tenant segment", async () => {
    mockRequireOwner.mockResolvedValue({ ownerId: "owner-2" });
    mockSegmentFindFirst.mockResolvedValue(null);

    await expect(getSegment(SEGMENT_ID)).resolves.toEqual({ error: "Segment not found." });
    expect(mockSegmentFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: SEGMENT_ID, ownerId: "owner-2", kind: "custom", deletedAt: null },
      }),
    );
    expect(mockContactFindMany).not.toHaveBeenCalled();
  });
});

describe("buildSegment", () => {
  it("blocks impersonated writes immediately after owner auth with zero CRM data access", async () => {
    mockIsImpersonating.mockResolvedValue(true);

    await expect(
      buildSegment({ segmentId: SEGMENT_ID, name: "VIP buyers", rules: spendRules }),
    ).resolves.toEqual({
      error: "Paused while impersonating a customer — exit impersonation to do this.",
    });

    expect(mockRequireOwner).toHaveBeenCalledTimes(1);
    expect(mockIsImpersonating).toHaveBeenCalledTimes(1);
    expect(mockContactFindMany).not.toHaveBeenCalled();
    expect(mockSegmentFindMany).not.toHaveBeenCalled();
    expect(mockSegmentFindFirst).not.toHaveBeenCalled();
    expect(mockSegmentCreate).not.toHaveBeenCalled();
  });

  it("trims the name and creates the fixed owner-scoped custom payload", async () => {
    const result = await buildSegment({
      segmentId: SEGMENT_ID,
      segmentProof: SEGMENT_PROOF,
      name: "  VIP buyers  ",
      rules: spendRules,
    });

    expect(mockSegmentFindFirst).toHaveBeenCalledWith({
      where: { id: SEGMENT_ID, ownerId: "owner-1", deletedAt: null },
      select: { id: true, name: true, phrase: true, rulesJson: true, kind: true, createdAt: true },
    });
    expect(mockSegmentCreate).toHaveBeenCalledWith({
      data: {
        id: SEGMENT_ID,
        ownerId: "owner-1",
        name: "VIP buyers",
        phrase: "All of: Lifetime spend is at least RM500 and contact is not a known opt-out",
        rulesJson: spendRules,
        kind: "custom",
      },
      select: { id: true, name: true, phrase: true, rulesJson: true, kind: true, createdAt: true },
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/crm/segments");
    expect(result).toMatchObject({
      ok: true,
      nextSegmentId: NEXT_SEGMENT_ID,
      nextSegmentProof: NEXT_SEGMENT_PROOF,
      segment: {
        id: SEGMENT_ID,
        name: "VIP buyers",
        phrase: "All of: Lifetime spend is at least RM500 and contact is not a known opt-out",
        rules: spendRules,
      },
    });
  });

  it("rejects invalid names, ids, and rules before writing", async () => {
    await expect(
      buildSegment({ segmentId: SEGMENT_ID, segmentProof: SEGMENT_PROOF, name: "  ", rules: spendRules }),
    ).resolves.toHaveProperty("error");
    await expect(
      buildSegment({ segmentId: "caller-picked", segmentProof: "forged", name: "VIP", rules: spendRules }),
    ).resolves.toHaveProperty("error");
    await expect(
      buildSegment({
        segmentId: SEGMENT_ID,
        segmentProof: SEGMENT_PROOF,
        name: "VIP",
        rules: { match: "all", rules: [] },
      }),
    ).resolves.toHaveProperty("error");
    expect(mockSegmentCreate).not.toHaveBeenCalled();
  });

  it("rejects a valid caller-picked ULID without its owner-bound server proof", async () => {
    await expect(
      buildSegment({ segmentId: SEGMENT_ID, segmentProof: "forged", name: "VIP", rules: spendRules }),
    ).resolves.toEqual({ error: "Start a new segment draft and try again." });
    expect(mockSegmentFindFirst).not.toHaveBeenCalled();
    expect(mockSegmentCreate).not.toHaveBeenCalled();

    mockRequireOwner.mockResolvedValue({ ownerId: "owner-2" });
    await expect(
      buildSegment({ segmentId: SEGMENT_ID, segmentProof: SEGMENT_PROOF, name: "VIP", rules: spendRules }),
    ).resolves.toEqual({ error: "Start a new segment draft and try again." });
    expect(mockSegmentFindFirst).not.toHaveBeenCalled();
  });

  it("rejects unrepresentable spend precision before reading or writing a segment", async () => {
    const result = await buildSegment({
      segmentId: SEGMENT_ID,
      segmentProof: SEGMENT_PROOF,
      name: "Too precise",
      rules: {
        match: "all",
        rules: [{ kind: "lifetime_spend", comparison: "at_least", amountMyr: 500.004 }],
      },
    });

    expect(result).toEqual({ error: "Use no more than two decimal places for lifetime spend." });
    expect(mockSegmentFindFirst).not.toHaveBeenCalled();
    expect(mockSegmentCreate).not.toHaveBeenCalled();
  });

  it("returns the original row for an exact retry without overwriting it", async () => {
    mockSegmentFindFirst.mockResolvedValue({
      id: SEGMENT_ID,
      name: "VIP buyers",
      phrase: "All of: Lifetime spend is at least RM500 and contact is not a known opt-out",
      rulesJson: spendRules,
      kind: "custom",
      createdAt: new Date("2026-07-14T00:00:00.000Z"),
    });

    const result = await buildSegment({
      segmentId: SEGMENT_ID,
      segmentProof: SEGMENT_PROOF,
      name: "VIP buyers",
      rules: spendRules,
    });

    expect(mockSegmentCreate).not.toHaveBeenCalled();
    expect(mockRevalidatePath).toHaveBeenCalledWith("/crm/segments");
    expect(result).toMatchObject({
      ok: true,
      idempotent: true,
      segment: { id: SEGMENT_ID, createdAt: "2026-07-14T00:00:00.000Z" },
    });
  });

  it("fails generically when the same id already has a different payload", async () => {
    mockSegmentFindFirst.mockResolvedValue({
      id: SEGMENT_ID,
      name: "Someone else's meaning",
      phrase: "Any of: Contact is contactable",
      rulesJson: { match: "any", rules: [{ kind: "contactability", value: "contactable" }] },
      kind: "custom",
      createdAt: new Date(),
    });

    await expect(
      buildSegment({ segmentId: SEGMENT_ID, segmentProof: SEGMENT_PROOF, name: "VIP buyers", rules: spendRules }),
    ).resolves.toEqual({ error: "Couldn't save this segment. Start a new draft and try again." });
    expect(mockSegmentCreate).not.toHaveBeenCalled();
  });

  it("does not reveal a cross-tenant unique-id collision", async () => {
    mockSegmentFindFirst.mockResolvedValue(null);
    mockSegmentCreate.mockRejectedValue({ code: "P2002" });

    await expect(
      buildSegment({ segmentId: SEGMENT_ID, segmentProof: SEGMENT_PROOF, name: "VIP buyers", rules: spendRules }),
    ).resolves.toEqual({ error: "Couldn't save this segment. Start a new draft and try again." });

    expect(mockSegmentFindFirst).toHaveBeenCalledTimes(2);
    for (const [call] of mockSegmentFindFirst.mock.calls) {
      expect(call.where).toEqual({ id: SEGMENT_ID, ownerId: "owner-1", deletedAt: null });
    }
  });

  it("settles a create race as an exact retry for the same owner and payload", async () => {
    mockSegmentFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: SEGMENT_ID,
        name: "VIP buyers",
        phrase: "All of: Lifetime spend is at least RM500 and contact is not a known opt-out",
        rulesJson: spendRules,
        kind: "custom",
        createdAt: new Date("2026-07-14T00:00:00.000Z"),
      });
    mockSegmentCreate.mockRejectedValue({ code: "P2002" });

    const result = await buildSegment({
      segmentId: SEGMENT_ID,
      segmentProof: SEGMENT_PROOF,
      name: "VIP buyers",
      rules: spendRules,
    });

    expect(result).toMatchObject({ ok: true, idempotent: true, segment: { id: SEGMENT_ID } });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/crm/segments");
  });

  it("makes a successful save visible to the next custom list read", async () => {
    const stored: Array<Record<string, unknown>> = [];
    mockSegmentCreate.mockImplementation(async ({ data }) => {
      const row = { ...data, createdAt: new Date("2026-07-15T03:04:05.000Z") };
      stored.unshift(row);
      return row;
    });
    mockSegmentFindMany.mockImplementation(async () => stored);

    const built = await buildSegment({
      segmentId: SEGMENT_ID,
      segmentProof: SEGMENT_PROOF,
      name: "VIP buyers",
      rules: spendRules,
    });
    expect(built).toMatchObject({ ok: true, segment: { id: SEGMENT_ID } });

    const listed = await listSegments();
    expect(listed).toMatchObject({
      ok: true,
      segments: [
        {
          id: SEGMENT_ID,
          name: "VIP buyers",
          phrase: "All of: Lifetime spend is at least RM500 and contact is not a known opt-out",
          matchedCount: 1,
        },
      ],
    });
  });

  it("updates an existing owner-scoped custom segment through the shared validated path", async () => {
    const updatedRules = {
      match: "all" as const,
      rules: [{ kind: "lifetime_spend" as const, comparison: "more_than" as const, amountMyr: 750 }],
    };
    mockSegmentFindFirst.mockResolvedValue({
      id: SEGMENT_ID,
      name: "VIP buyers",
      phrase: "All of: Lifetime spend is at least RM500 and contact is not a known opt-out",
      rulesJson: spendRules,
      kind: "custom",
      createdAt: new Date("2026-07-14T00:00:00.000Z"),
    });

    const result = await buildSegment({
      operation: "update",
      segmentId: SEGMENT_ID,
      name: "High-value buyers",
      rules: updatedRules,
    });

    expect(mockSegmentFindFirst).toHaveBeenCalledWith({
      where: { id: SEGMENT_ID, ownerId: "owner-1", deletedAt: null, kind: "custom" },
      select: { id: true, name: true, phrase: true, rulesJson: true, kind: true, createdAt: true },
    });
    expect(mockSegmentUpdateMany).toHaveBeenCalledWith({
      where: { id: SEGMENT_ID, ownerId: "owner-1", kind: "custom", deletedAt: null },
      data: {
        name: "High-value buyers",
        phrase: "All of: Lifetime spend is more than RM750",
        rulesJson: updatedRules,
      },
    });
    expect(mockSegmentCreate).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: true,
      operation: "update",
      idempotent: false,
      segment: { id: SEGMENT_ID, name: "High-value buyers", rules: updatedRules },
    });
    expect(result).not.toHaveProperty("nextSegmentId");
  });

  it("makes an exact update retry idempotent without writing again", async () => {
    mockSegmentFindFirst.mockResolvedValue({
      id: SEGMENT_ID,
      name: "VIP buyers",
      phrase: "All of: Lifetime spend is at least RM500 and contact is not a known opt-out",
      rulesJson: spendRules,
      kind: "custom",
      createdAt: new Date("2026-07-14T00:00:00.000Z"),
    });

    await expect(
      buildSegment({
        operation: "update",
        segmentId: SEGMENT_ID,
        name: "VIP buyers",
        rules: spendRules,
      }),
    ).resolves.toMatchObject({ ok: true, operation: "update", idempotent: true });
    expect(mockSegmentUpdateMany).not.toHaveBeenCalled();
  });

  it("recovers an ambiguous update only when the owner-scoped saved payload is exact", async () => {
    const existing = {
      id: SEGMENT_ID,
      name: "VIP buyers",
      phrase: "All of: Lifetime spend is at least RM500 and contact is not a known opt-out",
      rulesJson: spendRules,
      kind: "custom",
      createdAt: new Date("2026-07-14T00:00:00.000Z"),
    };
    const updatedRules = {
      match: "all" as const,
      rules: [
        { kind: "lifetime_spend" as const, comparison: "more_than" as const, amountMyr: 750 },
      ],
    };
    mockSegmentFindFirst
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce({
        ...existing,
        name: "High-value buyers",
        phrase: "All of: Lifetime spend is more than RM750",
        rulesJson: updatedRules,
      });
    mockSegmentUpdateMany.mockRejectedValueOnce(new Error("ambiguous write result"));

    await expect(
      buildSegment({
        operation: "update",
        segmentId: SEGMENT_ID,
        name: "High-value buyers",
        rules: updatedRules,
      }),
    ).resolves.toMatchObject({ ok: true, operation: "update", idempotent: true });
    expect(mockSegmentFindFirst).toHaveBeenLastCalledWith({
      where: { id: SEGMENT_ID, ownerId: "owner-1", kind: "custom", deletedAt: null },
      select: { id: true, name: true, phrase: true, rulesJson: true, kind: true, createdAt: true },
    });
  });

  it("fails closed when an update id is not owned by the authenticated tenant", async () => {
    mockRequireOwner.mockResolvedValue({ ownerId: "owner-2" });
    mockSegmentFindFirst.mockResolvedValue(null);

    await expect(
      buildSegment({
        operation: "update",
        segmentId: SEGMENT_ID,
        name: "Foreign segment",
        rules: spendRules,
      }),
    ).resolves.toEqual({ error: "Segment not found." });
    expect(mockSegmentFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: SEGMENT_ID, ownerId: "owner-2", deletedAt: null, kind: "custom" },
      }),
    );
    expect(mockSegmentUpdateMany).not.toHaveBeenCalled();
    expect(mockSegmentCreate).not.toHaveBeenCalled();
  });
});

describe("segment page ambiguous-save retry fence", () => {
  it("locks the exact attempted payload and exposes an explicit fresh-draft recovery", () => {
    const source = readFileSync(
      new URL("../../components/crm/segments-page.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("const attempt: RetryFence = retryFence ??");
    expect(source).toContain("name: attempt.name");
    expect(source).toContain("rules: JSON.parse(attempt.rulesKey) as SegmentRuleGroup");
    expect(source.match(/setRetryFence\(attempt\)/g)).toHaveLength(2);
    expect(source).toContain("const draftLocked = saving || refreshingDraft || retryFence !== null");
    expect(source).toContain("<fieldset disabled={draftLocked}");
    expect(source).toContain("const result = await listSegments()");
    expect(source).toContain("setNextSegmentProof(result.nextSegmentProof)");
    expect(source).toContain("Retry exact ${retryFence.operation}");
    expect(source).toContain("Use a fresh draft");
    expect(source).toContain("Refresh latest");
    expect(source).toContain("known opt-out excluded");
    expect(source).toContain("Do not disturb is checked at send time and does not filter this segment.");
  });
});
