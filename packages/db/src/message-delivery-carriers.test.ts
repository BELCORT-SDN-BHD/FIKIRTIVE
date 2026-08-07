/**
 * C6-M1 — additive messaging receipt storage contract only.
 *
 * These tests prove the exact carrier columns, tenant-qualified foreign keys, owner isolation,
 * idempotency anchors, ordered replay indexes, and storage-only boundaries. They intentionally
 * add no ingestion writer, reconciliation engine, sender, provider adapter, retention job, or UI.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./index.js";
import { TENANT_MODELS } from "./tenant-guard.js";

const ORG_A = "c6-m1-org-a";
const ORG_B = "c6-m1-org-b";
const SCOPE_A = "c6-m1-scope-a";
const SCOPE_B = "c6-m1-scope-b";
const CONNECTION_A = "c6-m1-connection-a";
const CONNECTION_B = "c6-m1-connection-b";
const NOW = new Date("2026-07-22T08:00:00.123456Z");
const SCHEMA = path.resolve(__dirname, "../prisma/schema.prisma");
const MIGRATION = path.resolve(
  __dirname,
  "../prisma/migrations/20260722100000_c6_m1_message_delivery_carriers/migration.sql",
);

beforeEach(async () => {
  await prisma.organization.createMany({ data: [{ id: ORG_A }, { id: ORG_B }] });
  await prisma.channelScope.createMany({
    data: [
      { id: SCOPE_A, ownerId: ORG_A, channel: "whatsapp", scopeKey: "waba-a" },
      { id: SCOPE_B, ownerId: ORG_B, channel: "whatsapp", scopeKey: "waba-b" },
    ],
  });
  await prisma.channelConnection.createMany({
    data: [
      {
        id: CONNECTION_A,
        ownerId: ORG_A,
        kind: "whatsapp",
        channelScopeId: SCOPE_A,
        externalId: "wa-business-a",
        accessTokenEnc: "ciphertext-a",
      },
      {
        id: CONNECTION_B,
        ownerId: ORG_B,
        kind: "whatsapp",
        channelScopeId: SCOPE_B,
        externalId: "wa-business-b",
        accessTokenEnc: "ciphertext-b",
      },
    ],
  });
});

function deliveryEvent(
  id: string,
  ownerId = ORG_A,
  channelScopeId = SCOPE_A,
  providerConnectionId = CONNECTION_A,
) {
  return {
    id,
    ownerId,
    logicalSendRef: `logical-send:${id}`,
    channelScopeId,
    channel: "whatsapp",
    providerConnectionId,
    factKind: "delivered",
    providerCode: "delivered",
    externalMessageRef: `provider-message:${id}`,
    receiptRef: `receipt:${id}`,
    actorKind: "provider",
    sourceEventKey: `delivery_changed:${id}`,
    sourcePayloadHash: `v1:payload:${id}`,
    occurredAt: NOW,
    receivedAt: NOW,
  };
}

function deliveryState(ownerId: string, logicalSendRef: string, lastEventId: string) {
  return {
    ownerId,
    logicalSendRef,
    lifecycle: "delivered",
    reconciliation: "converged",
    lastEventId,
    lastProviderEventAt: NOW,
    lastReconciledAt: NOW,
  };
}

function modelBlock(modelName: string): string {
  const schema = fs.readFileSync(SCHEMA, "utf8");
  const start = schema.indexOf(`model ${modelName} {`);
  expect(start, `${modelName} must exist in schema.prisma`).toBeGreaterThanOrEqual(0);
  return schema.slice(start, schema.indexOf("\n}", start));
}

describe("C6-M1 tenant guard and owner isolation", () => {
  it("registers both carriers and rejects unscoped reads", async () => {
    expect(TENANT_MODELS.has("MessageDeliveryEvent")).toBe(true);
    expect(TENANT_MODELS.has("MessageDeliveryState")).toBe(true);

    await expect(prisma.messageDeliveryEvent.findMany({ where: {} })).rejects.toThrow(
      /tenant-guard/,
    );
    await expect(prisma.messageDeliveryState.findMany({ where: {} })).rejects.toThrow(
      /tenant-guard/,
    );
  });

  it("keeps another owner's filtered reads empty", async () => {
    const event = deliveryEvent("event-owner-a");
    await prisma.messageDeliveryEvent.create({ data: event });
    await prisma.messageDeliveryState.create({
      data: deliveryState(ORG_A, event.logicalSendRef, event.id),
    });

    await expect(
      prisma.messageDeliveryEvent.findMany({ where: { ownerId: ORG_B } }),
    ).resolves.toHaveLength(0);
    await expect(
      prisma.messageDeliveryState.findMany({ where: { ownerId: ORG_B } }),
    ).resolves.toHaveLength(0);
  });

  it("rejects cross-owner and cross-channel event relations", async () => {
    await expect(
      prisma.messageDeliveryEvent.create({
        data: deliveryEvent("event-cross-scope", ORG_A, SCOPE_B, CONNECTION_A),
      }),
    ).rejects.toMatchObject({ code: "P2003" });

    await expect(
      prisma.messageDeliveryEvent.create({
        data: deliveryEvent("event-cross-connection", ORG_A, SCOPE_A, CONNECTION_B),
      }),
    ).rejects.toMatchObject({ code: "P2003" });

    await expect(
      prisma.messageDeliveryEvent.create({
        data: {
          ...deliveryEvent("event-cross-channel"),
          channel: "instagram",
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });
});

describe("C6-M1 idempotency and per-send uniqueness", () => {
  it("deduplicates sourceEventKey per owner without overwriting the original hash", async () => {
    const first = {
      ...deliveryEvent("event-dedup-first"),
      sourceEventKey: "delivery_changed:provider-event-42",
      sourcePayloadHash: "v1:hash-original",
    };
    await prisma.messageDeliveryEvent.create({ data: first });

    await expect(
      prisma.messageDeliveryEvent.create({
        data: {
          ...deliveryEvent("event-dedup-same-hash"),
          sourceEventKey: first.sourceEventKey,
          sourcePayloadHash: first.sourcePayloadHash,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    await expect(
      prisma.messageDeliveryEvent.create({
        data: {
          ...deliveryEvent("event-dedup-conflicting-hash"),
          sourceEventKey: first.sourceEventKey,
          sourcePayloadHash: "v1:hash-conflict",
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    const rows = await prisma.messageDeliveryEvent.findMany({
      where: { ownerId: ORG_A, sourceEventKey: first.sourceEventKey },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: first.id, sourcePayloadHash: first.sourcePayloadHash });

    await expect(
      prisma.messageDeliveryEvent.create({
        data: {
          ...deliveryEvent("event-dedup-other-owner", ORG_B, SCOPE_B, CONNECTION_B),
          sourceEventKey: first.sourceEventKey,
        },
      }),
    ).resolves.toMatchObject({ ownerId: ORG_B });
  });

  it("keeps exactly one state row per owner and logicalSendRef", async () => {
    const logicalSendRef = "logical-send:shared-within-owner";
    await prisma.messageDeliveryState.create({
      data: deliveryState(ORG_A, logicalSendRef, "event-state-a"),
    });

    await expect(
      prisma.messageDeliveryState.create({
        data: deliveryState(ORG_A, logicalSendRef, "event-state-a-duplicate"),
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    await expect(
      prisma.messageDeliveryState.create({
        data: deliveryState(ORG_B, logicalSendRef, "event-state-b"),
      }),
    ).resolves.toMatchObject({ ownerId: ORG_B, logicalSendRef });
  });
});

type ForeignKeyRow = {
  tableName: string;
  constraintName: string;
  columns: string[];
  referencedTable: string;
  referencedColumns: string[];
  deleteAction: string;
  updateAction: string;
};

type IndexRow = {
  tableName: string;
  indexName: string;
  isUnique: boolean;
  columns: string[];
  predicate: string | null;
};

describe("C6-M1 database catalog contract", () => {
  it("has exactly the tenant-qualified historical foreign keys, all Restrict", async () => {
    const rows = await prisma.$queryRaw<ForeignKeyRow[]>`
      SELECT source.relname AS "tableName",
             constraint_row.conname AS "constraintName",
             ARRAY(
               SELECT source_column.attname
               FROM unnest(constraint_row.conkey) WITH ORDINALITY AS key_column(attnum, ordinal)
               JOIN pg_attribute AS source_column
                 ON source_column.attrelid = constraint_row.conrelid
                AND source_column.attnum = key_column.attnum
               ORDER BY key_column.ordinal
             )::text[] AS columns,
             target.relname AS "referencedTable",
             ARRAY(
               SELECT target_column.attname
               FROM unnest(constraint_row.confkey) WITH ORDINALITY AS key_column(attnum, ordinal)
               JOIN pg_attribute AS target_column
                 ON target_column.attrelid = constraint_row.confrelid
                AND target_column.attnum = key_column.attnum
               ORDER BY key_column.ordinal
             )::text[] AS "referencedColumns",
             constraint_row.confdeltype::text AS "deleteAction",
             constraint_row.confupdtype::text AS "updateAction"
      FROM pg_constraint AS constraint_row
      JOIN pg_class AS source ON source.oid = constraint_row.conrelid
      JOIN pg_class AS target ON target.oid = constraint_row.confrelid
      WHERE constraint_row.contype = 'f'
        AND source.relname IN ('MessageDeliveryEvent', 'MessageDeliveryState')
    `;

    expect(rows).toHaveLength(4);
    expect(rows).toEqual(
      expect.arrayContaining([
        {
          tableName: "MessageDeliveryEvent",
          constraintName: "MessageDeliveryEvent_ownerId_fkey",
          columns: ["ownerId"],
          referencedTable: "Organization",
          referencedColumns: ["id"],
          deleteAction: "r",
          updateAction: "c",
        },
        {
          tableName: "MessageDeliveryEvent",
          constraintName: "MessageDeliveryEvent_channelScopeId_ownerId_channel_fkey",
          columns: ["channelScopeId", "ownerId", "channel"],
          referencedTable: "ChannelScope",
          referencedColumns: ["id", "ownerId", "channel"],
          deleteAction: "r",
          updateAction: "c",
        },
        {
          tableName: "MessageDeliveryEvent",
          constraintName: "MessageDeliveryEvent_providerConnectionId_ownerId_fkey",
          columns: ["providerConnectionId", "ownerId"],
          referencedTable: "ChannelConnection",
          referencedColumns: ["id", "ownerId"],
          deleteAction: "r",
          updateAction: "c",
        },
        {
          tableName: "MessageDeliveryState",
          constraintName: "MessageDeliveryState_ownerId_fkey",
          columns: ["ownerId"],
          referencedTable: "Organization",
          referencedColumns: ["id"],
          deleteAction: "r",
          updateAction: "c",
        },
      ]),
    );
  });

  it("has the exact unconditional uniques and ordered reconcile indexes", async () => {
    const rows = await prisma.$queryRaw<IndexRow[]>`
      SELECT table_row.relname AS "tableName",
             index_row.relname AS "indexName",
             index_meta.indisunique AS "isUnique",
             ARRAY(
               SELECT column_row.attname
               FROM unnest(index_meta.indkey) WITH ORDINALITY AS index_column(attnum, ordinal)
               JOIN pg_attribute AS column_row
                 ON column_row.attrelid = index_meta.indrelid
                AND column_row.attnum = index_column.attnum
               WHERE index_column.attnum > 0
               ORDER BY index_column.ordinal
             )::text[] AS columns,
             pg_get_expr(index_meta.indpred, index_meta.indrelid) AS predicate
      FROM pg_index AS index_meta
      JOIN pg_class AS table_row ON table_row.oid = index_meta.indrelid
      JOIN pg_class AS index_row ON index_row.oid = index_meta.indexrelid
      WHERE table_row.relname IN ('MessageDeliveryEvent', 'MessageDeliveryState')
    `;

    const expected = [
      {
        tableName: "MessageDeliveryEvent",
        indexName: "MessageDeliveryEvent_ownerId_sourceEventKey_key",
        isUnique: true,
        columns: ["ownerId", "sourceEventKey"],
        predicate: null,
      },
      {
        tableName: "MessageDeliveryEvent",
        indexName: "MessageDeliveryEvent_owner_send_received_idx",
        isUnique: false,
        columns: ["ownerId", "logicalSendRef", "receivedAt", "id"],
        predicate: null,
      },
      {
        tableName: "MessageDeliveryEvent",
        indexName: "MessageDeliveryEvent_owner_connection_received_idx",
        isUnique: false,
        columns: ["ownerId", "providerConnectionId", "receivedAt", "id"],
        predicate: null,
      },
      {
        tableName: "MessageDeliveryState",
        indexName: "MessageDeliveryState_ownerId_logicalSendRef_key",
        isUnique: true,
        columns: ["ownerId", "logicalSendRef"],
        predicate: null,
      },
    ];

    expect(rows).toEqual(expect.arrayContaining(expected));
    expect(rows.filter((row) => row.indexName !== "MessageDeliveryEvent_pkey")).toHaveLength(4);
  });

  it("stores exact columns and canonical times without a simulated or TTL column", async () => {
    const rows = await prisma.$queryRaw<Array<{ tableName: string; columnName: string }>>`
      SELECT table_name AS "tableName", column_name AS "columnName"
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name IN ('MessageDeliveryEvent', 'MessageDeliveryState')
      ORDER BY table_name, ordinal_position
    `;

    expect(rows.filter((row) => row.tableName === "MessageDeliveryEvent").map((row) => row.columnName)).toEqual([
      "id",
      "ownerId",
      "logicalSendRef",
      "channelScopeId",
      "channel",
      "providerConnectionId",
      "factKind",
      "providerCode",
      "externalMessageRef",
      "receiptRef",
      "actorKind",
      "sourceEventKey",
      "sourcePayloadHash",
      "occurredAt",
      "receivedAt",
      "createdAt",
    ]);
    expect(rows.filter((row) => row.tableName === "MessageDeliveryState").map((row) => row.columnName)).toEqual([
      "ownerId",
      "logicalSendRef",
      "lifecycle",
      "reconciliation",
      "lastEventId",
      "lastProviderEventAt",
      "lastReconciledAt",
      "updatedAt",
    ]);

    const timeRows = await prisma.$queryRaw<
      Array<{ tableName: string; columnName: string; dataType: string; precision: number }>
    >`
      SELECT table_name AS "tableName", column_name AS "columnName",
             data_type AS "dataType", datetime_precision AS precision
      FROM information_schema.columns
      WHERE (table_name = 'MessageDeliveryEvent' AND column_name IN ('occurredAt', 'receivedAt', 'createdAt'))
         OR (table_name = 'MessageDeliveryState' AND column_name IN ('lastProviderEventAt', 'lastReconciledAt', 'updatedAt'))
    `;
    expect(timeRows).toEqual(
      expect.arrayContaining([
        { tableName: "MessageDeliveryEvent", columnName: "occurredAt", dataType: "timestamp with time zone", precision: 6 },
        { tableName: "MessageDeliveryEvent", columnName: "receivedAt", dataType: "timestamp with time zone", precision: 6 },
        { tableName: "MessageDeliveryEvent", columnName: "createdAt", dataType: "timestamp without time zone", precision: 3 },
        { tableName: "MessageDeliveryState", columnName: "lastProviderEventAt", dataType: "timestamp with time zone", precision: 6 },
        { tableName: "MessageDeliveryState", columnName: "lastReconciledAt", dataType: "timestamp with time zone", precision: 6 },
        { tableName: "MessageDeliveryState", columnName: "updatedAt", dataType: "timestamp without time zone", precision: 3 },
      ]),
    );
  });
});

describe("C6-M1 historical Restrict behavior", () => {
  it("prevents deleting the actual Organization, ChannelScope, and ChannelConnection references", async () => {
    await prisma.messageDeliveryEvent.create({ data: deliveryEvent("event-restrict") });

    await expect(prisma.channelScope.delete({ where: { id: SCOPE_A, ownerId: ORG_A } })).rejects.toMatchObject({
      code: "P2003",
    });
    await expect(
      prisma.channelConnection.delete({ where: { id: CONNECTION_A, ownerId: ORG_A } }),
    ).rejects.toMatchObject({ code: "P2003" });
    await expect(prisma.organization.delete({ where: { id: ORG_A } })).rejects.toMatchObject({
      code: "P2003",
    });

    await expect(
      prisma.messageDeliveryEvent.findMany({ where: { ownerId: ORG_A } }),
    ).resolves.toHaveLength(1);
  });

  it("does not invent Contact, ContactIdentity, or BroadcastRun foreign keys", () => {
    const eventBlock = modelBlock("MessageDeliveryEvent");
    const stateBlock = modelBlock("MessageDeliveryState");
    for (const block of [eventBlock, stateBlock]) {
      expect(block).not.toMatch(/^\s+(?:contactId|contactIdentityId|broadcastRunId)\s/m);
    }

    const migration = fs.readFileSync(MIGRATION, "utf8");
    expect(migration).not.toMatch(/REFERENCES "(?:Contact|ContactIdentity|BroadcastRun)"/);
    expect(migration).not.toContain("ON DELETE CASCADE");
  });
});

describe("C6-M1 frozen storage boundaries", () => {
  it("uses code-validated Strings and carries the later monotonic fold cursor without a trigger", () => {
    const eventBlock = modelBlock("MessageDeliveryEvent");
    const stateBlock = modelBlock("MessageDeliveryState");
    expect(eventBlock).toMatch(/^\s+factKind\s+String\s/m);
    expect(eventBlock).toMatch(/^\s+actorKind\s+String\s/m);
    expect(stateBlock).toMatch(/^\s+lifecycle\s+String\s/m);
    expect(stateBlock).toMatch(/^\s+reconciliation\s+String\s/m);
    expect(stateBlock).toMatch(/^\s+lastEventId\s+String\s/m);
    expect(stateBlock).toContain("unknown | accepted | delivered | read | failed");
    expect(stateBlock).toContain("converged | pending | conflict | timeout_unknown");

    const migration = fs.readFileSync(MIGRATION, "utf8");
    expect(migration).not.toMatch(/CREATE\s+(?:TYPE|TRIGGER)|CHECK\s*\(/i);
  });

  it("keeps provider metadata opaque, avoids field crypto, and remains retention-neutral", () => {
    const eventBlock = modelBlock("MessageDeliveryEvent");
    expect(eventBlock).not.toMatch(/^\s+(?:simulated|updatedAt|deletedAt|expiresAt)\s/m);
    expect(eventBlock).not.toMatch(/^\s+(?:rawPayload|messageBody|phone|token|signature)\s/m);
    expect(eventBlock).not.toMatch(/^\s+(?:receiptRefEnc|providerCodeEnc)\s/m);

    const stateBlock = modelBlock("MessageDeliveryState");
    expect(stateBlock).not.toMatch(/^\s+(?:simulated|deletedAt|expiresAt)\s/m);

    const migration = fs.readFileSync(MIGRATION, "utf8");
    expect(migration).not.toMatch(/"(?:simulated|deletedAt|expiresAt|rawPayload|receiptRefEnc|providerCodeEnc)"/);
    expect(migration).not.toMatch(/pg_cron|CREATE\s+TRIGGER/i);
  });

  it("contains only additive DDL for the two new tables", () => {
    const migration = fs
      .readFileSync(MIGRATION, "utf8")
      .replace(/^--.*$/gm, "")
      .trim();
    expect(migration.startsWith("BEGIN;")).toBe(true);
    expect(migration.endsWith("COMMIT;")).toBe(true);
    expect(migration).not.toMatch(/^\s*(?:DROP|DELETE|UPDATE|INSERT|TRUNCATE)\b/im);
    expect(migration).not.toMatch(/CREATE\s+(?:TYPE|TRIGGER|FUNCTION)/i);

    const alteredTables = [...migration.matchAll(/ALTER TABLE "([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(new Set(alteredTables)).toEqual(
      new Set(["MessageDeliveryEvent", "MessageDeliveryState"]),
    );
  });
});
