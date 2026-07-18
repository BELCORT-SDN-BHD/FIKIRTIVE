/**
 * R-010 M1 consent batch — additive carrier contract only.
 *
 * These tests prove tenant-qualified relations, exactly-once/event and projection uniques,
 * deterministic replay indexes, and preservation of Contact's four legacy compatibility columns.
 * No writer, fold, replay engine, projection updater, or reader cutover is implemented here.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./index.js";

const ORG_A = "consent-org-a";
const ORG_B = "consent-org-b";
const CONTACT_A = "consent-contact-a";
const CONTACT_B = "consent-contact-b";
const CONNECTION_A = "consent-connection-a";
const IDENTITY_A = "consent-identity-a";
const NOW = new Date("2026-07-19T00:00:00.123456Z");
const SCHEMA = path.resolve(__dirname, "../prisma/schema.prisma");
const MIGRATION = path.resolve(
  __dirname,
  "../prisma/migrations/20260719130000_m_consent_batch/migration.sql",
);

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
  await prisma.channelConnection.create({
    data: {
      id: CONNECTION_A,
      ownerId: ORG_A,
      kind: "whatsapp",
      externalId: "wa-business-a",
      accessTokenEnc: "ciphertext",
    },
  });
  await prisma.contactIdentity.create({
    data: {
      id: IDENTITY_A,
      ownerId: ORG_A,
      contactId: CONTACT_A,
      channel: "whatsapp",
      externalId: "+60111111111",
    },
  });
});

function consentEvent(id: string, idempotencyKey: string) {
  return {
    id,
    ownerId: ORG_A,
    contactId: CONTACT_A,
    channel: "whatsapp",
    purpose: "marketing",
    action: "grant",
    actorKind: "customer",
    entryMode: "interactive",
    sourceKind: "double_optin",
    evidenceStatus: "verified",
    operationId: `operation:${id}`,
    idempotencyKey,
    receivedAt: NOW,
  };
}

function dndEvent(id: string, idempotencyKey: string) {
  return {
    id,
    ownerId: ORG_A,
    contactId: CONTACT_A,
    action: "set",
    actorKind: "merchant",
    sourceKind: "crm_ui",
    idempotencyKey,
    receivedAt: NOW,
  };
}

function refusalEvent(id: string, idempotencyKey: string) {
  return {
    id,
    ownerId: ORG_A,
    scopeKey: `recipient:${CONNECTION_A}:whatsapp:${IDENTITY_A}`,
    providerConnectionId: CONNECTION_A,
    channel: "whatsapp",
    contactIdentityId: IDENTITY_A,
    kind: "permanent_recipient",
    action: "block",
    actorKind: "provider",
    providerCode: "recipient_unavailable",
    receiptRef: `receipt:${id}`,
    idempotencyKey,
    receivedAt: NOW,
  };
}

describe("R-010 consent carriers — tenant guard and tenant-qualified relations", () => {
  it("guards all five owner-scoped models", async () => {
    const unscopedQueries = [
      () => prisma.consentEvent.findMany({ where: {} }),
      () => prisma.consentStateProjection.findMany({ where: {} }),
      () => prisma.contactDndEvent.findMany({ where: {} }),
      () => prisma.providerRefusalEvent.findMany({ where: {} }),
      () => prisma.providerRefusalState.findMany({ where: {} }),
    ];

    for (const query of unscopedQueries) {
      await expect(query()).rejects.toThrow(/tenant-guard/);
    }

    await prisma.consentEvent.create({ data: consentEvent("consent-guard", "consent:guard") });
    await prisma.consentStateProjection.create({
      data: {
        ownerId: ORG_A,
        contactId: CONTACT_A,
        channel: "whatsapp",
        purpose: "marketing",
        state: "verified_grant",
        lastEventId: "consent-guard",
        lastReceivedAt: NOW,
        stateActorKind: "customer",
        stateSourceKind: "double_optin",
        evidenceStatus: "verified",
      },
    });
    await prisma.contactDndEvent.create({ data: dndEvent("dnd-guard", "dnd:guard") });
    await prisma.providerRefusalEvent.create({
      data: refusalEvent("refusal-guard", "refusal:guard"),
    });
    await prisma.providerRefusalState.create({
      data: {
        ownerId: ORG_A,
        scopeKey: `recipient:${CONNECTION_A}:whatsapp:${IDENTITY_A}`,
        blocked: true,
        lastEventId: "refusal-guard",
        lastReceivedAt: NOW,
      },
    });

    const otherTenantQueries = [
      () => prisma.consentEvent.findMany({ where: { ownerId: ORG_B } }),
      () => prisma.consentStateProjection.findMany({ where: { ownerId: ORG_B } }),
      () => prisma.contactDndEvent.findMany({ where: { ownerId: ORG_B } }),
      () => prisma.providerRefusalEvent.findMany({ where: { ownerId: ORG_B } }),
      () => prisma.providerRefusalState.findMany({ where: { ownerId: ORG_B } }),
    ];
    for (const query of otherTenantQueries) {
      await expect(query()).resolves.toHaveLength(0);
    }
  });

  it("rejects cross-owner Contact, connection, and identity references", async () => {
    await expect(
      prisma.consentEvent.create({
        data: { ...consentEvent("consent-cross-owner", "consent:cross-owner"), ownerId: ORG_B },
      }),
    ).rejects.toMatchObject({ code: "P2003" });

    await expect(
      prisma.consentStateProjection.create({
        data: {
          ownerId: ORG_B,
          contactId: CONTACT_A,
          channel: "whatsapp",
          purpose: "marketing",
          state: "unknown",
          lastEventId: "consent-cross-owner",
          lastReceivedAt: NOW,
          stateActorKind: "legacy_unknown",
          stateSourceKind: "legacy_contact_snapshot",
          evidenceStatus: "unresolved",
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });

    await expect(
      prisma.contactDndEvent.create({
        data: { ...dndEvent("dnd-cross-owner", "dnd:cross-owner"), ownerId: ORG_B },
      }),
    ).rejects.toMatchObject({ code: "P2003" });

    await expect(
      prisma.providerRefusalEvent.create({
        data: { ...refusalEvent("refusal-cross-owner", "refusal:cross-owner"), ownerId: ORG_B },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });
});

describe("R-010 consent carriers — unique contracts", () => {
  it("enforces owner-qualified event idempotency keys", async () => {
    await prisma.consentEvent.create({ data: consentEvent("consent-1", "consent:same") });
    await expect(
      prisma.consentEvent.create({ data: consentEvent("consent-2", "consent:same") }),
    ).rejects.toMatchObject({ code: "P2002" });

    await prisma.contactDndEvent.create({ data: dndEvent("dnd-1", "dnd:same") });
    await expect(
      prisma.contactDndEvent.create({ data: dndEvent("dnd-2", "dnd:same") }),
    ).rejects.toMatchObject({ code: "P2002" });

    await prisma.providerRefusalEvent.create({ data: refusalEvent("refusal-1", "refusal:same") });
    await expect(
      prisma.providerRefusalEvent.create({ data: refusalEvent("refusal-2", "refusal:same") }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("enforces the projection tuple and refusal-state scope uniques", async () => {
    const projection = {
      ownerId: ORG_A,
      contactId: CONTACT_A,
      channel: "whatsapp",
      purpose: "marketing",
      state: "verified_grant",
      lastEventId: "consent-1",
      lastReceivedAt: NOW,
      stateActorKind: "customer",
      stateSourceKind: "double_optin",
      evidenceStatus: "verified",
    };
    await prisma.consentStateProjection.create({ data: projection });
    await expect(
      prisma.consentStateProjection.create({ data: { ...projection, lastEventId: "consent-2" } }),
    ).rejects.toMatchObject({ code: "P2002" });

    const state = {
      ownerId: ORG_A,
      scopeKey: `recipient:${CONNECTION_A}:whatsapp:${IDENTITY_A}`,
      blocked: true,
      lastEventId: "refusal-1",
      lastReceivedAt: NOW,
    };
    await prisma.providerRefusalState.create({ data: state });
    await expect(
      prisma.providerRefusalState.create({ data: { ...state, lastEventId: "refusal-2" } }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});

describe("R-010 consent carriers — replay indexes", () => {
  it("creates the exact ordered replay indexes", async () => {
    const indexes = await prisma.$queryRaw<
      Array<{ tableName: string; isUnique: boolean; columns: string[] }>
    >`
      SELECT
        table_rel.relname AS "tableName",
        index_meta.indisunique AS "isUnique",
        ARRAY(
          SELECT attribute.attname::text
          FROM unnest(index_meta.indkey) WITH ORDINALITY AS key_column(attnum, position)
          JOIN pg_attribute AS attribute
            ON attribute.attrelid = table_rel.oid
           AND attribute.attnum = key_column.attnum
          ORDER BY key_column.position
        ) AS columns
      FROM pg_index AS index_meta
      JOIN pg_class AS table_rel ON table_rel.oid = index_meta.indrelid
      JOIN pg_namespace AS namespace ON namespace.oid = table_rel.relnamespace
      WHERE namespace.nspname = current_schema()
        AND table_rel.relname IN ('ConsentEvent', 'ContactDndEvent', 'ProviderRefusalEvent')
    `;

    expect(indexes).toEqual(
      expect.arrayContaining([
        {
          tableName: "ConsentEvent",
          isUnique: false,
          columns: ["ownerId", "contactId", "channel", "purpose", "receivedAt", "id"],
        },
        {
          tableName: "ContactDndEvent",
          isUnique: false,
          columns: ["ownerId", "contactId", "receivedAt", "id"],
        },
        {
          tableName: "ProviderRefusalEvent",
          isUnique: false,
          columns: ["ownerId", "scopeKey", "receivedAt", "id"],
        },
      ]),
    );
  });
});

describe("R-010 consent carriers — legacy Contact compatibility columns", () => {
  it("keeps the four legacy fields byte-for-byte in schema and out of the migration", () => {
    const schema = fs.readFileSync(SCHEMA, "utf8");
    const start = schema.indexOf("model Contact {");
    const block = schema.slice(start, schema.indexOf("\n}", start));

    expect(block).toContain('marketingConsent     String   @default("unknown") // opt_in | opt_out | unknown (code-validated)');
    expect(block).toContain("consentSource        String?");
    expect(block).toContain("consentAt            DateTime?");
    expect(block).toContain("doNotDisturb         Boolean  @default(false)");

    const migration = fs.readFileSync(MIGRATION, "utf8");
    expect(migration).not.toMatch(/"marketingConsent"|"consentSource"|"consentAt"|"doNotDisturb"/);
  });
});
