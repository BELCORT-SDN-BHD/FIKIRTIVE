import { beforeEach, describe, expect, it } from "vitest";
import {
  CONSENT_WRITER_RULES,
  contactConsentCompatibility,
  expireProviderRefusal,
  failClosedD5Override,
  foldConsentEvents,
  prisma,
  rebuildConsentRuntimeProjections,
  recordConsentEvent,
  recordContactDndEvent,
  recordProviderRefusalEvent,
  recordStopPurposeExpansion,
  recordUnqualifiedStop,
  validateConsentWriterCombination,
  validateDndWriterCombination,
  validateProviderRefusalWriterCombination,
} from "./index.js";

const ORG_A = "runtime-org-a";
const ORG_B = "runtime-org-b";
const CONTACT_A = "runtime-contact-a";
const CONTACT_B = "runtime-contact-b";
const CONNECTION_A = "runtime-connection-a";
const CONNECTION_B = "runtime-connection-b";
const IDENTITY_A = "runtime-identity-a";
const IDENTITY_B = "runtime-identity-b";
const NOW = new Date("2026-07-19T00:00:00.000Z");

beforeEach(async () => {
  await prisma.organization.createMany({ data: [{ id: ORG_A }, { id: ORG_B }] });
  await prisma.contact.createMany({
    data: [
      {
        id: CONTACT_A,
        ownerId: ORG_A,
        name: "Aisyah",
        source: "whatsapp",
        firstTouchAt: NOW,
        lastSeenAt: NOW,
      },
      {
        id: CONTACT_B,
        ownerId: ORG_B,
        name: "Mei",
        source: "whatsapp",
        firstTouchAt: NOW,
        lastSeenAt: NOW,
      },
    ],
  });
  await prisma.channelConnection.createMany({
    data: [
      {
        id: CONNECTION_A,
        ownerId: ORG_A,
        kind: "whatsapp",
        externalId: "wa-business-a",
        accessTokenEnc: "ciphertext-a",
      },
      {
        id: CONNECTION_B,
        ownerId: ORG_B,
        kind: "whatsapp",
        externalId: "wa-business-b",
        accessTokenEnc: "ciphertext-b",
      },
    ],
  });
  await prisma.contactIdentity.createMany({
    data: [
      {
        id: IDENTITY_A,
        ownerId: ORG_A,
        contactId: CONTACT_A,
        channel: "whatsapp",
        externalId: "+60111111111",
      },
      {
        id: IDENTITY_B,
        ownerId: ORG_B,
        contactId: CONTACT_B,
        channel: "whatsapp",
        externalId: "+60222222222",
      },
    ],
  });
});

function customerConsent(
  sourceKind: "double_optin" | "unsubscribe_link" | "resubscribe_link",
  idempotencyKey: string,
  overrides: Partial<Parameters<typeof recordConsentEvent>[0]> = {},
) {
  const action = sourceKind === "unsubscribe_link" ? "revoke" : "grant";
  return recordConsentEvent({
    ownerId: ORG_A,
    contactId: CONTACT_A,
    channel: "whatsapp",
    purpose: "marketing",
    sourceKind,
    action,
    evidenceRef: `evidence:${idempotencyKey}`,
    idempotencyKey,
    ...overrides,
  });
}

function permanentRefusal(
  action: "block" | "clear",
  idempotencyKey: string,
  reversesEventId?: string,
) {
  return recordProviderRefusalEvent({
    ownerId: ORG_A,
    providerConnectionId: CONNECTION_A,
    channel: "whatsapp",
    contactIdentityId: IDENTITY_A,
    kind: "permanent_recipient",
    action,
    providerCode: action === "block" ? "recipient_unavailable" : "recipient_verified",
    receiptRef: `receipt:${idempotencyKey}`,
    reversesEventId,
    idempotencyKey,
  });
}

describe("R-010 closed validators", () => {
  it("accepts every listed consent writer tuple and rejects every unlisted shape", () => {
    for (const [sourceKind, rule] of Object.entries(CONSENT_WRITER_RULES)) {
      for (const action of rule.actions) {
        expect(() =>
          validateConsentWriterCombination({
            sourceKind,
            action,
            actorKind: rule.actorKind,
            entryMode: rule.entryMode,
            evidenceStatus: rule.evidenceStatus,
          }),
        ).not.toThrow();
      }
    }

    const rejected = [
      {
        sourceKind: "double_optin",
        action: "revoke",
        actorKind: "customer",
        entryMode: "interactive",
        evidenceStatus: "verified",
      },
      {
        sourceKind: "crm_manual",
        action: "grant",
        actorKind: "customer",
        entryMode: "backfill",
        evidenceStatus: "asserted",
      },
      {
        sourceKind: "stop_keyword",
        action: "revoke",
        actorKind: "system",
        entryMode: "interactive",
        evidenceStatus: "verified",
      },
      {
        sourceKind: "customer_backfill",
        action: "grant",
        actorKind: "customer",
        entryMode: "backfill",
        evidenceStatus: "verified",
      },
    ];
    for (const combination of rejected) {
      expect(() => validateConsentWriterCombination(combination)).toThrowError(
        expect.objectContaining({ code: "INVALID_WRITER_COMBINATION" }),
      );
    }
  });

  it("enforces the exact DND and provider-refusal matrices", () => {
    const validDnd = [
      ["crm_ui", "merchant", "set"],
      ["crm_ui", "merchant", "clear"],
      ["otto_approved_action", "otto", "set"],
      ["otto_approved_action", "otto", "clear"],
      ["legacy_contact_snapshot", "legacy_migration", "set"],
    ] as const;
    for (const [sourceKind, actorKind, action] of validDnd) {
      expect(() => validateDndWriterCombination({ sourceKind, actorKind, action })).not.toThrow();
    }
    expect(() =>
      validateDndWriterCombination({
        sourceKind: "legacy_contact_snapshot",
        actorKind: "legacy_migration",
        action: "clear",
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_WRITER_COMBINATION" }));

    const validProvider = [
      {
        kind: "permanent_recipient",
        action: "block",
        actorKind: "provider",
        hasChannel: true,
        hasContactIdentity: true,
        hasExpiresAt: false,
        hasReversesEventId: false,
      },
      {
        kind: "permanent_recipient",
        action: "clear",
        actorKind: "provider",
        hasChannel: true,
        hasContactIdentity: true,
        hasExpiresAt: false,
        hasReversesEventId: true,
      },
      {
        kind: "account_level",
        action: "block",
        actorKind: "provider",
        hasChannel: false,
        hasContactIdentity: false,
        hasExpiresAt: true,
        hasReversesEventId: false,
      },
      {
        kind: "account_level",
        action: "clear",
        actorKind: "provider",
        hasChannel: false,
        hasContactIdentity: false,
        hasExpiresAt: false,
        hasReversesEventId: true,
      },
      {
        kind: "account_level",
        action: "expire",
        actorKind: "system",
        hasChannel: false,
        hasContactIdentity: false,
        hasExpiresAt: true,
        hasReversesEventId: true,
      },
      {
        kind: "transient",
        action: "observe",
        actorKind: "provider",
        hasChannel: true,
        hasContactIdentity: true,
        hasExpiresAt: false,
        hasReversesEventId: false,
      },
    ];
    for (const combination of validProvider) {
      expect(() => validateProviderRefusalWriterCombination(combination)).not.toThrow();
    }
    expect(() =>
      validateProviderRefusalWriterCombination({
        kind: "permanent_recipient",
        action: "expire",
        actorKind: "system",
        hasChannel: true,
        hasContactIdentity: true,
        hasExpiresAt: true,
        hasReversesEventId: true,
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_WRITER_COMBINATION" }));
    expect(() =>
      validateProviderRefusalWriterCombination({
        kind: "transient",
        action: "block",
        actorKind: "provider",
        hasChannel: false,
        hasContactIdentity: false,
        hasExpiresAt: false,
        hasReversesEventId: false,
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_WRITER_COMBINATION" }));
  });

  it("keeps D5 explicitly fail-closed", () => {
    expect(() => failClosedD5Override()).toThrowError(
      expect.objectContaining({ code: "D5_DEFERRED" }),
    );
  });

  it("keeps historical and unresolved backfill state-neutral after a live customer stance", () => {
    const fold = foldConsentEvents([
      {
        id: "live-grant",
        receivedAt: "2026-07-19T00:00:00.000001Z",
        action: "grant",
        actorKind: "customer",
        entryMode: "interactive",
        sourceKind: "double_optin",
        evidenceStatus: "verified",
      },
      {
        id: "late-history",
        receivedAt: "2026-07-19T00:00:00.000002Z",
        action: "revoke",
        actorKind: "customer",
        entryMode: "backfill",
        sourceKind: "historical_verified_revoke",
        evidenceStatus: "verified",
      },
      {
        id: "legacy-claim",
        receivedAt: "2026-07-19T00:00:00.000003Z",
        action: "revoke",
        actorKind: "legacy_unknown",
        entryMode: "backfill",
        sourceKind: "legacy_contact_snapshot",
        evidenceStatus: "unresolved",
      },
    ]);
    expect(fold).toMatchObject({
      state: "verified_grant",
      stateEventId: "live-grant",
      lastEventId: "legacy-claim",
    });
  });
});

describe("closed transactional writers", () => {
  it("treats same-key/same-payload replays as success and rejects payload drift for all ledgers", async () => {
    const firstConsent = await customerConsent("double_optin", "consent:same");
    const replayConsent = await customerConsent("double_optin", "consent:same");
    expect(firstConsent.duplicate).toBe(false);
    expect(replayConsent).toMatchObject({ duplicate: true, eventIds: firstConsent.eventIds });
    await expect(
      recordConsentEvent({
        ownerId: ORG_A,
        contactId: CONTACT_A,
        channel: "whatsapp",
        purpose: "marketing",
        sourceKind: "crm_manual",
        action: "revoke",
        idempotencyKey: "consent:same",
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const dnd = await recordContactDndEvent({
      ownerId: ORG_A,
      contactId: CONTACT_A,
      sourceKind: "crm_ui",
      action: "set",
      actorId: "merchant:1",
      idempotencyKey: "dnd:same",
    });
    await expect(
      recordContactDndEvent({
        ownerId: ORG_A,
        contactId: CONTACT_A,
        sourceKind: "crm_ui",
        action: "set",
        actorId: "merchant:1",
        idempotencyKey: "dnd:same",
      }),
    ).resolves.toMatchObject({ duplicate: true, eventIds: dnd.eventIds });
    await expect(
      recordContactDndEvent({
        ownerId: ORG_A,
        contactId: CONTACT_A,
        sourceKind: "crm_ui",
        action: "clear",
        actorId: "merchant:1",
        idempotencyKey: "dnd:same",
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await recordContactDndEvent({
      ownerId: ORG_A,
      contactId: CONTACT_A,
      sourceKind: "crm_ui",
      action: "clear",
      actorId: "merchant:1",
      idempotencyKey: "dnd:clear",
    });
    await expect(
      prisma.contact.findFirstOrThrow({ where: { ownerId: ORG_A, id: CONTACT_A } }),
    ).resolves.toMatchObject({ doNotDisturb: false, marketingConsent: "opt_in" });

    const refusal = await permanentRefusal("block", "refusal:same");
    await expect(permanentRefusal("block", "refusal:same")).resolves.toMatchObject({
      duplicate: true,
      eventIds: refusal.eventIds,
    });
    await expect(
      recordProviderRefusalEvent({
        ownerId: ORG_A,
        providerConnectionId: CONNECTION_A,
        channel: "whatsapp",
        contactIdentityId: IDENTITY_A,
        kind: "permanent_recipient",
        action: "block",
        providerCode: "different_code",
        receiptRef: "receipt:refusal:same",
        idempotencyKey: "refusal:same",
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("assigns receivedAt from the tuple cursor at one-microsecond precision; occurredAt never wins", async () => {
    await prisma.consentEvent.create({
      data: {
        id: "future-cursor",
        ownerId: ORG_A,
        contactId: CONTACT_A,
        channel: "whatsapp",
        purpose: "marketing",
        action: "grant",
        actorKind: "customer",
        entryMode: "interactive",
        sourceKind: "double_optin",
        evidenceStatus: "verified",
        evidenceRef: "evidence:future",
        operationId: "operation:future",
        idempotencyKey: "future:cursor",
        occurredAt: new Date("2099-01-01T00:00:00.000Z"),
        receivedAt: new Date("2099-01-01T00:00:00.000Z"),
      },
    });

    const written = await customerConsent("unsubscribe_link", "cursor:next", {
      occurredAt: new Date("1970-01-01T00:00:00.000Z"),
    });
    expect(written.receivedAt).toEqual(["2099-01-01T00:00:00.000001Z"]);
    const contact = await prisma.contact.findFirstOrThrow({
      where: { ownerId: ORG_A, id: CONTACT_A },
    });
    expect(contact.marketingConsent).toBe("opt_out");
    expect(contact.consentAt?.toISOString()).toBe("2099-01-01T00:00:00.000Z");
  });

  it("fans unqualified STOP out to the closed proactive set in stable order and never touches transactional", async () => {
    await customerConsent("double_optin", "grant:marketing");
    await customerConsent("double_optin", "grant:transactional", { purpose: "transactional" });
    const stop = await recordUnqualifiedStop({
      ownerId: ORG_A,
      contactId: CONTACT_A,
      channel: "whatsapp",
      sourceKind: "stop_keyword",
      channelEventRef: "gupshup:inbound",
      opaqueMessageId: "message:stop-1",
    });
    expect(stop.duplicate).toBe(false);

    const stopEvents = await prisma.consentEvent.findMany({
      where: { ownerId: ORG_A, sourceKind: "stop_keyword" },
      orderBy: [{ purpose: "asc" }],
    });
    expect(stopEvents.map((event) => event.purpose)).toEqual(["marketing", "review_request"]);
    expect(new Set(stopEvents.map((event) => event.operationId))).toEqual(
      new Set(["stop:whatsapp:gupshup:inbound:message:stop-1"]),
    );
    expect(stopEvents.map((event) => event.idempotencyKey)).toEqual([
      "stop:whatsapp:gupshup:inbound:message:stop-1:marketing",
      "stop:whatsapp:gupshup:inbound:message:stop-1:review_request",
    ]);

    const projections = await prisma.consentStateProjection.findMany({
      where: { ownerId: ORG_A, contactId: CONTACT_A, channel: "whatsapp" },
      orderBy: { purpose: "asc" },
    });
    expect(projections.map(({ purpose, state }) => ({ purpose, state }))).toEqual([
      { purpose: "marketing", state: "effective_revoke" },
      { purpose: "review_request", state: "effective_revoke" },
      { purpose: "transactional", state: "verified_grant" },
    ]);
    await expect(
      recordUnqualifiedStop({
        ownerId: ORG_A,
        contactId: CONTACT_A,
        channel: "whatsapp",
        sourceKind: "stop_keyword",
        channelEventRef: "gupshup:inbound",
        opaqueMessageId: "message:stop-1",
      }),
    ).resolves.toMatchObject({ duplicate: true, eventIds: stop.eventIds });
  });

  it("rolls the whole STOP operation back when the second purpose fails", async () => {
    await customerConsent("double_optin", "grant:before-stop");
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION fail_review_stop_for_test() RETURNS trigger AS $$
      BEGIN
        IF NEW."sourceKind" = 'stop_keyword' AND NEW."purpose" = 'review_request' THEN
          RAISE EXCEPTION 'forced second-purpose failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER fail_review_stop_for_test
      BEFORE INSERT ON "ConsentEvent"
      FOR EACH ROW EXECUTE FUNCTION fail_review_stop_for_test()
    `);
    try {
      await expect(
        recordUnqualifiedStop({
          ownerId: ORG_A,
          contactId: CONTACT_A,
          channel: "whatsapp",
          sourceKind: "stop_keyword",
          channelEventRef: "adapter:event",
          opaqueMessageId: "message:atomic",
        }),
      ).rejects.toThrow(/forced second-purpose failure|Raw query failed/);
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS fail_review_stop_for_test ON "ConsentEvent"`,
      );
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS fail_review_stop_for_test()`);
    }

    expect(
      await prisma.consentEvent.count({
        where: { ownerId: ORG_A, sourceKind: "stop_keyword" },
      }),
    ).toBe(0);
    const projections = await prisma.consentStateProjection.findMany({
      where: { ownerId: ORG_A, contactId: CONTACT_A },
    });
    expect(projections).toHaveLength(1);
    expect(projections[0]).toMatchObject({ purpose: "marketing", state: "verified_grant" });
    await expect(
      prisma.contact.findFirstOrThrow({ where: { ownerId: ORG_A, id: CONTACT_A } }),
    ).resolves.toMatchObject({ marketingConsent: "opt_in" });
  });

  it("rejects stop_purpose_expansion into a purpose tuple that already has events (R-010 :206/:268)", async () => {
    await recordUnqualifiedStop({
      ownerId: ORG_A,
      contactId: CONTACT_A,
      channel: "whatsapp",
      sourceKind: "stop_keyword",
      channelEventRef: "gupshup:inbound",
      opaqueMessageId: "message:stop-expand-1",
    });
    const before = await prisma.consentEvent.count({ where: { ownerId: ORG_A } });
    await expect(
      recordStopPurposeExpansion({
        ownerId: ORG_A,
        contactId: CONTACT_A,
        channel: "whatsapp",
        purpose: "marketing",
        originalStopOperationId: "stop:whatsapp:gupshup:inbound:message:stop-expand-1",
        evidenceRef: "evidence:stop-expand-1",
      }),
    ).rejects.toMatchObject({ code: "INVALID_WRITER_COMBINATION" });
    await expect(prisma.consentEvent.count({ where: { ownerId: ORG_A } })).resolves.toBe(before);
  });

  it("keeps provider blocks scoped, requires verified active-block reversal, and never expires by wall clock", async () => {
    const futureBlock = await recordProviderRefusalEvent({
      ownerId: ORG_A,
      providerConnectionId: CONNECTION_A,
      kind: "account_level",
      action: "block",
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      providerCode: "future_account_hold",
      receiptRef: "receipt:account:future",
      idempotencyKey: "account:future",
    });
    await expect(
      expireProviderRefusal({ ownerId: ORG_A, blockEventId: futureBlock.eventIds[0]! }),
    ).rejects.toMatchObject({ code: "INVALID_WRITER_COMBINATION" });
    const accountBlock = await recordProviderRefusalEvent({
      ownerId: ORG_A,
      providerConnectionId: CONNECTION_A,
      kind: "account_level",
      action: "block",
      expiresAt: new Date("2020-01-01T00:00:00.000Z"),
      providerCode: "account_policy_hold",
      receiptRef: "receipt:account:block",
      idempotencyKey: "account:block",
    });
    await expect(
      prisma.providerRefusalState.findFirstOrThrow({
        where: { ownerId: ORG_A, scopeKey: `account:${CONNECTION_A}` },
      }),
    ).resolves.toMatchObject({ blocked: true });
    await expect(
      recordProviderRefusalEvent({
        ownerId: ORG_A,
        providerConnectionId: CONNECTION_A,
        kind: "account_level",
        action: "clear",
        providerCode: "account_clear",
        receiptRef: "receipt:wrong-clear",
        reversesEventId: "not-the-active-block",
        idempotencyKey: "account:wrong-clear",
      }),
    ).rejects.toMatchObject({ code: "ACTIVE_BLOCK_REQUIRED" });

    await expect(
      expireProviderRefusal({ ownerId: ORG_A, blockEventId: accountBlock.eventIds[0]! }),
    ).resolves.toMatchObject({ duplicate: false });
    await expect(
      prisma.providerRefusalState.findFirstOrThrow({
        where: { ownerId: ORG_A, scopeKey: `account:${CONNECTION_A}` },
      }),
    ).resolves.toMatchObject({ blocked: false });

    const permanent = await permanentRefusal("block", "permanent:block");
    await permanentRefusal("clear", "permanent:clear", permanent.eventIds[0]);
    await expect(
      prisma.providerRefusalState.findFirstOrThrow({
        where: {
          ownerId: ORG_A,
          scopeKey: `recipient:${CONNECTION_A}:whatsapp:${IDENTITY_A}`,
        },
      }),
    ).resolves.toMatchObject({ blocked: false });
    expect(
      await prisma.providerRefusalState.count({
        where: { ownerId: ORG_B },
      }),
    ).toBe(0);
  });
});

describe("projection fidelity, replay, and tenant isolation", () => {
  it("applies the frozen Contact mapping and leaves state-neutral/non-mapped events byte-stable", async () => {
    const unknown = foldConsentEvents([
      {
        id: "legacy-1",
        receivedAt: "2026-07-19T00:00:00.000001Z",
        action: "grant",
        actorKind: "legacy_unknown",
        entryMode: "backfill",
        sourceKind: "legacy_contact_snapshot",
        evidenceStatus: "unresolved",
      },
    ]);
    expect(unknown && contactConsentCompatibility(unknown)).toEqual({
      marketingConsent: "unknown",
      consentSource: null,
      consentAtEventId: null,
    });

    const grant = await customerConsent("double_optin", "mapping:grant");
    const grantEvent = await prisma.consentEvent.findFirstOrThrow({
      where: { ownerId: ORG_A, id: grant.eventIds[0] },
    });
    const afterGrant = await prisma.contact.findFirstOrThrow({
      where: { ownerId: ORG_A, id: CONTACT_A },
    });
    expect(afterGrant).toMatchObject({
      marketingConsent: "opt_in",
      consentSource: "consent_event:double_optin",
    });
    expect(afterGrant.consentAt?.getTime()).toBe(grantEvent.receivedAt.getTime());

    await recordConsentEvent({
      ownerId: ORG_A,
      contactId: CONTACT_A,
      channel: "whatsapp",
      purpose: "marketing",
      sourceKind: "crm_manual",
      action: "revoke",
      evidenceRef: "claim:merchant",
      idempotencyKey: "mapping:asserted",
    });
    const afterAsserted = await prisma.contact.findFirstOrThrow({
      where: { ownerId: ORG_A, id: CONTACT_A },
    });
    expect({
      marketingConsent: afterAsserted.marketingConsent,
      consentSource: afterAsserted.consentSource,
      consentAt: afterAsserted.consentAt?.getTime(),
    }).toEqual({
      marketingConsent: afterGrant.marketingConsent,
      consentSource: afterGrant.consentSource,
      consentAt: afterGrant.consentAt?.getTime(),
    });

    await recordConsentEvent({
      ownerId: ORG_A,
      contactId: CONTACT_A,
      channel: "whatsapp",
      purpose: "marketing",
      sourceKind: "legacy_contact_snapshot",
      action: "revoke",
      evidenceRef: "legacy:snapshot",
      idempotencyKey: "mapping:legacy-unresolved",
    });
    const afterUnresolved = await prisma.contact.findFirstOrThrow({
      where: { ownerId: ORG_A, id: CONTACT_A },
    });
    expect({
      marketingConsent: afterUnresolved.marketingConsent,
      consentSource: afterUnresolved.consentSource,
      consentAt: afterUnresolved.consentAt?.getTime(),
    }).toEqual({
      marketingConsent: afterGrant.marketingConsent,
      consentSource: afterGrant.consentSource,
      consentAt: afterGrant.consentAt?.getTime(),
    });

    await recordConsentEvent({
      ownerId: ORG_A,
      contactId: CONTACT_A,
      channel: "instagram",
      purpose: "marketing",
      sourceKind: "double_optin",
      action: "grant",
      evidenceRef: "evidence:instagram",
      idempotencyKey: "mapping:instagram",
    });
    const afterOtherChannel = await prisma.contact.findFirstOrThrow({
      where: { ownerId: ORG_A, id: CONTACT_A },
    });
    expect(afterOtherChannel.consentSource).toBe("consent_event:double_optin");

    const revoke = await customerConsent("unsubscribe_link", "mapping:revoke");
    const revokeEvent = await prisma.consentEvent.findFirstOrThrow({
      where: { ownerId: ORG_A, id: revoke.eventIds[0] },
    });
    const afterRevoke = await prisma.contact.findFirstOrThrow({
      where: { ownerId: ORG_A, id: CONTACT_A },
    });
    expect(afterRevoke).toMatchObject({
      marketingConsent: "opt_out",
      consentSource: "consent_event:unsubscribe_link",
    });
    expect(afterRevoke.consentAt?.getTime()).toBe(revokeEvent.receivedAt.getTime());
  });

  it("rebuilds all projections to the online semantic result", async () => {
    await customerConsent("double_optin", "replay:grant");
    await recordConsentEvent({
      ownerId: ORG_A,
      contactId: CONTACT_A,
      channel: "whatsapp",
      purpose: "marketing",
      sourceKind: "crm_manual",
      action: "revoke",
      evidenceRef: "claim:replay",
      idempotencyKey: "replay:asserted",
    });
    await recordContactDndEvent({
      ownerId: ORG_A,
      contactId: CONTACT_A,
      sourceKind: "crm_ui",
      action: "set",
      actorId: "merchant:replay",
      idempotencyKey: "replay:dnd",
    });
    await permanentRefusal("block", "replay:refusal");
    await recordProviderRefusalEvent({
      ownerId: ORG_A,
      providerConnectionId: CONNECTION_A,
      channel: "whatsapp",
      contactIdentityId: IDENTITY_A,
      kind: "transient",
      action: "observe",
      providerCode: "timeout",
      receiptRef: "receipt:transient",
      idempotencyKey: "replay:transient",
    });

    const before = {
      consent: await prisma.consentStateProjection.findMany({
        where: { ownerId: ORG_A },
        orderBy: [{ contactId: "asc" }, { channel: "asc" }, { purpose: "asc" }],
        select: {
          ownerId: true,
          contactId: true,
          channel: true,
          purpose: true,
          state: true,
          lastEventId: true,
          lastReceivedAt: true,
          stateActorKind: true,
          stateSourceKind: true,
          evidenceStatus: true,
        },
      }),
      provider: await prisma.providerRefusalState.findMany({
        where: { ownerId: ORG_A },
        orderBy: { scopeKey: "asc" },
      }),
      contact: await prisma.contact.findFirstOrThrow({
        where: { ownerId: ORG_A, id: CONTACT_A },
        select: {
          marketingConsent: true,
          consentSource: true,
          consentAt: true,
          doNotDisturb: true,
        },
      }),
    };

    await prisma.consentStateProjection.deleteMany({ where: { ownerId: ORG_A } });
    await prisma.providerRefusalState.deleteMany({ where: { ownerId: ORG_A } });
    await prisma.contact.updateMany({
      where: { ownerId: ORG_A, id: CONTACT_A },
      data: {
        marketingConsent: "unknown",
        consentSource: null,
        consentAt: null,
        doNotDisturb: false,
      },
    });

    await expect(rebuildConsentRuntimeProjections(ORG_A)).resolves.toEqual({
      consentProjectionCount: 1,
      dndContactCount: 1,
      providerProjectionCount: 1,
    });
    const after = {
      consent: await prisma.consentStateProjection.findMany({
        where: { ownerId: ORG_A },
        orderBy: [{ contactId: "asc" }, { channel: "asc" }, { purpose: "asc" }],
        select: {
          ownerId: true,
          contactId: true,
          channel: true,
          purpose: true,
          state: true,
          lastEventId: true,
          lastReceivedAt: true,
          stateActorKind: true,
          stateSourceKind: true,
          evidenceStatus: true,
        },
      }),
      provider: await prisma.providerRefusalState.findMany({
        where: { ownerId: ORG_A },
        orderBy: { scopeKey: "asc" },
      }),
      contact: await prisma.contact.findFirstOrThrow({
        where: { ownerId: ORG_A, id: CONTACT_A },
        select: {
          marketingConsent: true,
          consentSource: true,
          consentAt: true,
          doNotDisturb: true,
        },
      }),
    };
    expect(after).toEqual(before);
  });

  it("fails closed across tenants without changing the target tenant", async () => {
    await expect(
      recordConsentEvent({
        ownerId: ORG_B,
        contactId: CONTACT_A,
        channel: "whatsapp",
        purpose: "marketing",
        sourceKind: "double_optin",
        action: "grant",
        evidenceRef: "evidence:cross-owner",
        idempotencyKey: "cross-owner:consent",
      }),
    ).rejects.toMatchObject({ code: "TENANT_RESOURCE_NOT_FOUND" });
    await expect(
      recordProviderRefusalEvent({
        ownerId: ORG_B,
        providerConnectionId: CONNECTION_A,
        channel: "whatsapp",
        contactIdentityId: IDENTITY_A,
        kind: "permanent_recipient",
        action: "block",
        providerCode: "cross_owner",
        receiptRef: "receipt:cross-owner",
        idempotencyKey: "cross-owner:refusal",
      }),
    ).rejects.toMatchObject({ code: "TENANT_RESOURCE_NOT_FOUND" });

    expect(await prisma.consentEvent.count({ where: { ownerId: ORG_A } })).toBe(0);
    expect(await prisma.consentEvent.count({ where: { ownerId: ORG_B } })).toBe(0);
    expect(await prisma.providerRefusalEvent.count({ where: { ownerId: ORG_A } })).toBe(0);
    expect(await prisma.providerRefusalEvent.count({ where: { ownerId: ORG_B } })).toBe(0);
    await expect(rebuildConsentRuntimeProjections(ORG_B)).resolves.toEqual({
      consentProjectionCount: 0,
      dndContactCount: 0,
      providerProjectionCount: 0,
    });
    await expect(
      prisma.contact.findFirstOrThrow({ where: { ownerId: ORG_A, id: CONTACT_A } }),
    ).resolves.toMatchObject({
      marketingConsent: "unknown",
      doNotDisturb: false,
    });
  });
});
