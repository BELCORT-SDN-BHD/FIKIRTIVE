/**
 * C4b-M1 — additive Customer Inbox storage contract only.
 *
 * These tests prove the exact physical carrier, tenant-FK, index, and migration-preflight
 * contracts. They intentionally add no writer, validator, provider adapter, send path, or UI.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./index.js";
import { TENANT_MODELS } from "./tenant-guard.js";

const ORG_A = "c4b-m1-org-a";
const ORG_B = "c4b-m1-org-b";
const MEMBER_A = "c4b-m1-member-a";
const MEMBER_B = "c4b-m1-member-b";
const CONTACT_A = "c4b-m1-contact-a";
const CONTACT_B = "c4b-m1-contact-b";
const IDENTITY_A = "c4b-m1-identity-a";
const IDENTITY_B = "c4b-m1-identity-b";
const SCOPE_A = "c4b-m1-scope-a";
const SCOPE_B = "c4b-m1-scope-b";
const CONVERSATION_A = "c4b-m1-conversation-a";
const CONVERSATION_B = "c4b-m1-conversation-b";
const TEMPLATE_A = "c4b-m1-template-a";
const NOW = new Date("2026-07-20T08:00:00.123456Z");
const MIGRATION = path.resolve(
  __dirname,
  "../prisma/migrations/20260720160000_c4b_m1_inbox_storage/migration.sql",
);
const SCHEMA = path.resolve(__dirname, "../prisma/schema.prisma");

const C4_MODELS = [
  "CustomerConversation",
  "CustomerMessage",
  "CustomerConversationEvent",
  "CustomerConversationDraft",
  "CustomerMessageTemplate",
  "CustomerMessageTemplateVersion",
] as const;

beforeEach(async () => {
  await prisma.organization.createMany({ data: [{ id: ORG_A }, { id: ORG_B }] });
  await prisma.user.createMany({
    data: [
      { id: "c4b-m1-user-a", email: "c4b-m1-a@example.test" },
      { id: "c4b-m1-user-b", email: "c4b-m1-b@example.test" },
    ],
    skipDuplicates: true,
  });
  await prisma.membership.createMany({
    data: [
      { id: MEMBER_A, userId: "c4b-m1-user-a", orgId: ORG_A },
      { id: MEMBER_B, userId: "c4b-m1-user-b", orgId: ORG_B },
    ],
  });
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
  await prisma.channelScope.createMany({
    data: [
      { id: SCOPE_A, ownerId: ORG_A, channel: "whatsapp", scopeKey: "waba-a" },
      { id: SCOPE_B, ownerId: ORG_B, channel: "whatsapp", scopeKey: "waba-b" },
    ],
  });
  await prisma.contactIdentity.createMany({
    data: [
      {
        id: IDENTITY_A,
        ownerId: ORG_A,
        contactId: CONTACT_A,
        channelScopeId: SCOPE_A,
        channel: "whatsapp",
        externalId: "+60111111111",
      },
      {
        id: IDENTITY_B,
        ownerId: ORG_B,
        contactId: CONTACT_B,
        channelScopeId: SCOPE_B,
        channel: "whatsapp",
        externalId: "+60222222222",
      },
    ],
  });
});

function conversation(id: string, ownerId: string, contactIdentityId: string) {
  return {
    id,
    ownerId,
    contactIdentityId,
    status: "open",
    lastActivityAt: NOW,
  };
}

function message(id: string, ownerId = ORG_A, conversationId = CONVERSATION_A) {
  return {
    id,
    ownerId,
    conversationId,
    direction: "inbound",
    actorKind: "customer",
    kind: "text",
    contentJson: { schemaVersion: 1, type: "text", text: "Hello" },
    searchText: "Hello",
    contentHash: `content:${id}`,
    sourceEventKey: `scope:${ownerId}:message:${id}`,
    sourcePayloadHash: `payload:${id}`,
    canonicalizationVersion: "customer_message_v1",
    receivedAt: NOW,
  };
}

describe("C4b-M1 tenant guard", () => {
  it("registers and rejects unscoped reads for all six carriers", async () => {
    for (const model of C4_MODELS) expect(TENANT_MODELS.has(model)).toBe(true);

    const unscopedQueries = [
      () => prisma.customerConversation.findMany({ where: {} }),
      () => prisma.customerMessage.findMany({ where: {} }),
      () => prisma.customerConversationEvent.findMany({ where: {} }),
      () => prisma.customerConversationDraft.findMany({ where: {} }),
      () => prisma.customerMessageTemplate.findMany({ where: {} }),
      () => prisma.customerMessageTemplateVersion.findMany({ where: {} }),
    ];
    for (const query of unscopedQueries) await expect(query()).rejects.toThrow(/tenant-guard/);
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

describe("C4b-M1 database catalog contract", () => {
  it("has every owner-qualified FK in exact column order with historical delete restriction", async () => {
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
        AND source.relname = ANY(ARRAY[
          'ContactIdentity',
          'CustomerConversation',
          'CustomerMessage',
          'CustomerConversationEvent',
          'CustomerConversationDraft',
          'CustomerMessageTemplate',
          'CustomerMessageTemplateVersion'
        ])
    `;

    const expected = [
      ["ContactIdentity", "ContactIdentity_ownerId_fkey", ["ownerId"], "Organization", ["id"]],
      ["ContactIdentity", "ContactIdentity_contactId_ownerId_fkey", ["contactId", "ownerId"], "Contact", ["id", "ownerId"]],
      ["ContactIdentity", "ContactIdentity_channelScopeId_ownerId_channel_fkey", ["channelScopeId", "ownerId", "channel"], "ChannelScope", ["id", "ownerId", "channel"]],
      ["CustomerConversation", "CustomerConversation_ownerId_fkey", ["ownerId"], "Organization", ["id"]],
      ["CustomerConversation", "CustomerConversation_contactIdentityId_ownerId_fkey", ["contactIdentityId", "ownerId"], "ContactIdentity", ["id", "ownerId"]],
      ["CustomerConversation", "CustomerConversation_assigneeMembershipId_ownerId_fkey", ["assigneeMembershipId", "ownerId"], "Membership", ["id", "orgId"]],
      ["CustomerMessage", "CustomerMessage_ownerId_fkey", ["ownerId"], "Organization", ["id"]],
      ["CustomerMessage", "CustomerMessage_conversationId_ownerId_fkey", ["conversationId", "ownerId"], "CustomerConversation", ["id", "ownerId"]],
      ["CustomerMessage", "CustomerMessage_actorMembershipId_ownerId_fkey", ["actorMembershipId", "ownerId"], "Membership", ["id", "orgId"]],
      ["CustomerConversationEvent", "CustomerConversationEvent_ownerId_fkey", ["ownerId"], "Organization", ["id"]],
      ["CustomerConversationEvent", "CustomerConversationEvent_conversationId_ownerId_fkey", ["conversationId", "ownerId"], "CustomerConversation", ["id", "ownerId"]],
      ["CustomerConversationEvent", "CustomerConversationEvent_actorMembershipId_ownerId_fkey", ["actorMembershipId", "ownerId"], "Membership", ["id", "orgId"]],
      ["CustomerConversationEvent", "CustomerConversationEvent_fromAssignee_ownerId_fkey", ["fromAssigneeMembershipId", "ownerId"], "Membership", ["id", "orgId"]],
      ["CustomerConversationEvent", "CustomerConversationEvent_toAssignee_ownerId_fkey", ["toAssigneeMembershipId", "ownerId"], "Membership", ["id", "orgId"]],
      ["CustomerConversationDraft", "CustomerConversationDraft_ownerId_fkey", ["ownerId"], "Organization", ["id"]],
      ["CustomerConversationDraft", "CustomerConversationDraft_conversationId_ownerId_fkey", ["conversationId", "ownerId"], "CustomerConversation", ["id", "ownerId"]],
      ["CustomerConversationDraft", "CustomerConversationDraft_authorMembershipId_ownerId_fkey", ["authorMembershipId", "ownerId"], "Membership", ["id", "orgId"]],
      ["CustomerMessageTemplate", "CustomerMessageTemplate_ownerId_fkey", ["ownerId"], "Organization", ["id"]],
      ["CustomerMessageTemplate", "CustomerMessageTemplate_channelScopeId_ownerId_channel_fkey", ["channelScopeId", "ownerId", "channel"], "ChannelScope", ["id", "ownerId", "channel"]],
      ["CustomerMessageTemplateVersion", "CustomerMessageTemplateVersion_ownerId_fkey", ["ownerId"], "Organization", ["id"]],
      ["CustomerMessageTemplateVersion", "CustomerMessageTemplateVersion_templateId_ownerId_fkey", ["templateId", "ownerId"], "CustomerMessageTemplate", ["id", "ownerId"]],
      ["CustomerMessageTemplateVersion", "CustomerMessageTemplateVersion_createdByMember_ownerId_fkey", ["createdByMembershipId", "ownerId"], "Membership", ["id", "orgId"]],
    ] as const;

    expect(rows.some((row) => row.constraintName === "ContactIdentity_contactId_fkey")).toBe(false);
    for (const [tableName, constraintName, columns, referencedTable, referencedColumns] of expected) {
      expect(rows).toContainEqual({
        tableName,
        constraintName,
        columns: [...columns],
        referencedTable,
        referencedColumns: [...referencedColumns],
        deleteAction: "r",
        updateAction: "c",
      });
    }
  });

  it("has the exact unique/list indexes and exactly two partial predicates", async () => {
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
      WHERE table_row.relname = ANY(ARRAY[
        'Membership',
        'CustomerConversation',
        'CustomerMessage',
        'CustomerConversationEvent',
        'CustomerConversationDraft',
        'CustomerMessageTemplate',
        'CustomerMessageTemplateVersion'
      ])
    `;

    const expected = [
      ["Membership", "Membership_id_orgId_key", true, ["id", "orgId"]],
      ["CustomerConversation", "CustomerConversation_id_ownerId_key", true, ["id", "ownerId"]],
      ["CustomerConversation", "CustomerConversation_ownerId_contactIdentityId_key", true, ["ownerId", "contactIdentityId"]],
      ["CustomerConversation", "CustomerConversation_owner_status_activity_idx", false, ["ownerId", "status", "lastActivityAt", "id"]],
      ["CustomerConversation", "CustomerConversation_owner_assignee_status_activity_idx", false, ["ownerId", "assigneeMembershipId", "status", "lastActivityAt", "id"]],
      ["CustomerMessage", "CustomerMessage_owner_conversation_received_idx", false, ["ownerId", "conversationId", "receivedAt", "id"]],
      ["CustomerConversationEvent", "CustomerConversationEvent_ownerId_idempotencyKey_key", true, ["ownerId", "idempotencyKey"]],
      ["CustomerConversationEvent", "CustomerConversationEvent_owner_conversation_revision_key", true, ["ownerId", "conversationId", "revision"]],
      ["CustomerConversationEvent", "CustomerConversationEvent_owner_conversation_created_idx", false, ["ownerId", "conversationId", "createdAt", "id"]],
      ["CustomerConversationDraft", "CustomerConversationDraft_pkey", true, ["ownerId", "conversationId"]],
      ["CustomerConversationDraft", "CustomerConversationDraft_conversationId_ownerId_key", true, ["conversationId", "ownerId"]],
      ["CustomerMessageTemplate", "CustomerMessageTemplate_id_ownerId_key", true, ["id", "ownerId"]],
      ["CustomerMessageTemplate", "CustomerMessageTemplate_owner_scope_archived_name_idx", false, ["ownerId", "channelScopeId", "archivedAt", "name"]],
      ["CustomerMessageTemplateVersion", "CustomerMessageTemplateVersion_id_ownerId_key", true, ["id", "ownerId"]],
      ["CustomerMessageTemplateVersion", "CustomerMessageTemplateVersion_owner_template_revision_key", true, ["ownerId", "templateId", "revision"]],
      ["CustomerMessageTemplateVersion", "CustomerMessageTemplateVersion_owner_template_revision_idx", false, ["ownerId", "templateId", "revision"]],
    ] as const;
    for (const [tableName, indexName, isUnique, columns] of expected) {
      expect(rows).toContainEqual({ tableName, indexName, isUnique, columns: [...columns], predicate: null });
    }

    const partials = rows.filter((row) => row.predicate !== null);
    expect(partials).toHaveLength(2);
    const sourceEventPartial = partials.find(
      (row) => row.indexName === "CustomerMessage_owner_source_event_live",
    );
    expect(sourceEventPartial).toMatchObject({
      tableName: "CustomerMessage",
      indexName: "CustomerMessage_owner_source_event_live",
      isUnique: true,
      columns: ["ownerId", "sourceEventKey"],
    });
    expect(sourceEventPartial!.predicate!.replace(/[()]/g, "").replace(/\s+/g, " ")).toBe(
      '"sourceEventKey" IS NOT NULL',
    );
    const templatePartial = partials.find(
      (row) => row.indexName === "CustomerMessageTemplate_owner_scope_name_locale_live",
    );
    expect(templatePartial).toMatchObject({
      tableName: "CustomerMessageTemplate",
      indexName: "CustomerMessageTemplate_owner_scope_name_locale_live",
      isUnique: true,
      columns: ["ownerId", "channelScopeId", "name", "locale"],
    });
    expect(templatePartial!.predicate!.replace(/[()]/g, "").replace(/\s+/g, " ")).toBe(
      '"archivedAt" IS NULL',
    );
  });

  it("stores provider time at TIMESTAMPTZ(6) and row lifecycle time at TIMESTAMP(3)", async () => {
    const rows = await prisma.$queryRaw<
      Array<{ tableName: string; columnName: string; dataType: string; precision: number }>
    >`
      SELECT table_name AS "tableName", column_name AS "columnName",
             data_type AS "dataType", datetime_precision AS precision
      FROM information_schema.columns
      WHERE (table_name = 'CustomerMessage' AND column_name IN ('occurredAt', 'receivedAt', 'createdAt'))
         OR (table_name = 'CustomerConversation' AND column_name IN ('lastMessageAt', 'lastActivityAt'))
    `;
    expect(rows).toEqual(
      expect.arrayContaining([
        { tableName: "CustomerMessage", columnName: "occurredAt", dataType: "timestamp with time zone", precision: 6 },
        { tableName: "CustomerMessage", columnName: "receivedAt", dataType: "timestamp with time zone", precision: 6 },
        { tableName: "CustomerMessage", columnName: "createdAt", dataType: "timestamp without time zone", precision: 3 },
        { tableName: "CustomerConversation", columnName: "lastMessageAt", dataType: "timestamp without time zone", precision: 3 },
        { tableName: "CustomerConversation", columnName: "lastActivityAt", dataType: "timestamp without time zone", precision: 3 },
      ]),
    );
  });
});

describe("C4b-M1 cross-owner and channel-qualified relations", () => {
  it("hardens ContactIdentity -> Contact and Conversation -> Identity/assignee", async () => {
    await expect(
      prisma.contactIdentity.create({
        data: {
          id: "c4b-m1-cross-contact",
          ownerId: ORG_A,
          contactId: CONTACT_B,
          channel: "whatsapp",
          externalId: "+60333333333",
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
    await expect(
      prisma.customerConversation.create({
        data: conversation("c4b-m1-cross-identity", ORG_A, IDENTITY_B),
      }),
    ).rejects.toMatchObject({ code: "P2003" });
    await expect(
      prisma.customerConversation.create({
        data: {
          ...conversation("c4b-m1-cross-assignee", ORG_A, IDENTITY_A),
          assigneeMembershipId: MEMBER_B,
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("rejects cross-owner conversation, actor, draft, template, and author references", async () => {
    await prisma.customerConversation.create({ data: conversation(CONVERSATION_A, ORG_A, IDENTITY_A) });

    await expect(
      prisma.customerMessage.create({ data: message("c4b-m1-cross-conversation", ORG_B) }),
    ).rejects.toMatchObject({ code: "P2003" });
    await expect(
      prisma.customerMessage.create({
        data: { ...message("c4b-m1-cross-message-actor"), actorKind: "merchant_member", actorMembershipId: MEMBER_B },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
    await expect(
      prisma.customerConversationEvent.create({
        data: {
          id: "c4b-m1-cross-event-conversation",
          ownerId: ORG_B,
          conversationId: CONVERSATION_A,
          revision: 1,
          kind: "opened",
          actorKind: "system",
          idempotencyKey: "event:cross-conversation",
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
    for (const field of ["actorMembershipId", "fromAssigneeMembershipId", "toAssigneeMembershipId"] as const) {
      await expect(
        prisma.customerConversationEvent.create({
          data: {
            id: `c4b-m1-cross-event-${field}`,
            ownerId: ORG_A,
            conversationId: CONVERSATION_A,
            revision: field.length,
            kind: "assigned",
            actorKind: "merchant_member",
            idempotencyKey: `event:${field}`,
            [field]: MEMBER_B,
          },
        }),
      ).rejects.toMatchObject({ code: "P2003" });
    }
    await expect(
      prisma.customerConversationDraft.create({
        data: {
          ownerId: ORG_A,
          conversationId: CONVERSATION_A,
          conversationRevision: 0,
          authorKind: "merchant_member",
          authorMembershipId: MEMBER_B,
          contentJson: { schemaVersion: 1, type: "text", text: "Draft" },
          contentHash: "draft:cross-owner",
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
    await expect(
      prisma.customerConversationDraft.create({
        data: {
          ownerId: ORG_B,
          conversationId: CONVERSATION_A,
          conversationRevision: 0,
          authorKind: "otto",
          contentJson: { schemaVersion: 1, type: "text", text: "Cross-owner draft" },
          contentHash: "draft:cross-conversation",
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });

    await expect(
      prisma.customerMessageTemplate.create({
        data: { id: "c4b-m1-cross-scope", ownerId: ORG_A, channelScopeId: SCOPE_B, channel: "whatsapp", name: "order_update", locale: "en_MY" },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
    await expect(
      prisma.customerMessageTemplate.create({
        data: { id: "c4b-m1-cross-channel", ownerId: ORG_A, channelScopeId: SCOPE_A, channel: "instagram", name: "order_update", locale: "en_MY" },
      }),
    ).rejects.toMatchObject({ code: "P2003" });

    await prisma.customerMessageTemplate.create({
      data: { id: TEMPLATE_A, ownerId: ORG_A, channelScopeId: SCOPE_A, channel: "whatsapp", name: "order_update", locale: "en_MY" },
    });
    await expect(
      prisma.customerMessageTemplateVersion.create({
        data: {
          id: "c4b-m1-cross-template",
          ownerId: ORG_B,
          templateId: TEMPLATE_A,
          revision: 1,
          purposeClass: "transactional",
          category: "utility",
          definitionJson: { schemaVersion: 1, body: "Order {{order}}", variables: [{ key: "order", sample: "B-1" }] },
          contentHash: "template:cross-template",
          createdByMembershipId: MEMBER_B,
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
    await expect(
      prisma.customerMessageTemplateVersion.create({
        data: {
          id: "c4b-m1-cross-template-author",
          ownerId: ORG_A,
          templateId: TEMPLATE_A,
          revision: 1,
          purposeClass: "transactional",
          category: "utility",
          definitionJson: { schemaVersion: 1, body: "Order {{order}}", variables: [{ key: "order", sample: "A-1" }] },
          contentHash: "template:cross-author",
          createdByMembershipId: MEMBER_B,
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });
});

describe("C4b-M1 source-event and live-template partial uniqueness", () => {
  it("keeps exactly one current shared draft on the singular conversation relation", async () => {
    await prisma.customerConversation.create({ data: conversation(CONVERSATION_A, ORG_A, IDENTITY_A) });
    const draft = {
      ownerId: ORG_A,
      conversationId: CONVERSATION_A,
      conversationRevision: 0,
      authorKind: "merchant_member",
      authorMembershipId: MEMBER_A,
      contentJson: { schemaVersion: 1, type: "text", text: "Shared draft" },
      contentHash: "draft:shared",
    };
    await prisma.customerConversationDraft.create({ data: draft });

    await expect(
      prisma.customerConversation.findFirstOrThrow({
        where: { id: CONVERSATION_A, ownerId: ORG_A },
        include: { draft: true },
      }),
    ).resolves.toMatchObject({ draft: { contentHash: "draft:shared" } });
    await expect(
      prisma.customerConversationDraft.create({
        data: { ...draft, contentHash: "draft:must-not-create-a-second-row" },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("deduplicates non-null inbound source keys per owner while allowing other owners", async () => {
    await prisma.customerConversation.createMany({
      data: [
        conversation(CONVERSATION_A, ORG_A, IDENTITY_A),
        conversation(CONVERSATION_B, ORG_B, IDENTITY_B),
      ],
    });
    const first = { ...message("c4b-m1-source-1"), sourceEventKey: "scope-a:event-1" };
    await prisma.customerMessage.create({ data: first });
    await expect(
      prisma.customerMessage.create({
        data: { ...message("c4b-m1-source-2"), sourceEventKey: first.sourceEventKey },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
    await expect(
      prisma.customerMessage.create({
        data: { ...message("c4b-m1-source-b", ORG_B, CONVERSATION_B), sourceEventKey: first.sourceEventKey },
      }),
    ).resolves.toMatchObject({ ownerId: ORG_B });
  });

  it("keeps a logical template unique only while its root is live", async () => {
    const logicalKey = {
      ownerId: ORG_A,
      channelScopeId: SCOPE_A,
      channel: "whatsapp",
      name: "order_update",
      locale: "en_MY",
    };
    await prisma.customerMessageTemplate.create({ data: { id: "c4b-m1-template-old", ...logicalKey } });
    await expect(
      prisma.customerMessageTemplate.create({ data: { id: "c4b-m1-template-duplicate", ...logicalKey } }),
    ).rejects.toMatchObject({ code: "P2002" });
    await prisma.customerMessageTemplate.updateMany({
      where: { id: "c4b-m1-template-old", ownerId: ORG_A },
      data: { archivedAt: NOW },
    });
    await expect(
      prisma.customerMessageTemplate.create({ data: { id: "c4b-m1-template-new", ...logicalKey } }),
    ).resolves.toMatchObject({ id: "c4b-m1-template-new" });
  });
});

describe("C4b-M1 migration preflight and legacy invariants", () => {
  it("executes the exact migration preflight against a disposable anomaly and rolls back", async () => {
    const migration = fs.readFileSync(MIGRATION, "utf8");
    const preflight = migration.match(
      /DO \$c4b_m1_preflight\$[\s\S]*?\$c4b_m1_preflight\$;/,
    )?.[0];
    expect(preflight).toBeTruthy();

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL search_path = pg_temp, public`);
        await tx.$executeRawUnsafe(
          `CREATE TEMP TABLE "Contact" ("id" TEXT PRIMARY KEY, "ownerId" TEXT NOT NULL) ON COMMIT DROP`,
        );
        await tx.$executeRawUnsafe(
          `CREATE TEMP TABLE "ContactIdentity" ("id" TEXT PRIMARY KEY, "ownerId" TEXT NOT NULL, "contactId" TEXT NOT NULL) ON COMMIT DROP`,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO "Contact" ("id", "ownerId") VALUES ('contact-b', 'org-b')`,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO "ContactIdentity" ("id", "ownerId", "contactId") VALUES ('identity-a', 'org-a', 'contact-b')`,
        );
        await tx.$executeRawUnsafe(preflight!);
      }),
    ).rejects.toThrow(/C4b-M1 blocked: cross-owner ContactIdentity -> Contact anomaly exists/);
  });

  it("places the fail-closed preflight before DDL inside one explicit transaction", () => {
    const migration = fs.readFileSync(MIGRATION, "utf8");
    const preflightStart = migration.indexOf("DO $c4b_m1_preflight$");
    const preflightEnd = migration.indexOf("$c4b_m1_preflight$;", preflightStart);
    const firstDdl = migration.search(/\n(?:CREATE|ALTER|DROP) (?:TABLE|INDEX)/);
    expect(migration.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(preflightStart).toBeGreaterThan(-1);
    expect(preflightEnd).toBeGreaterThan(preflightStart);
    expect(firstDdl).toBeGreaterThan(preflightEnd);
    expect(migration.trimEnd().endsWith("COMMIT;")).toBe(true);
  });

  it("preserves legacy identity uniqueness and keeps the four-fact unique absent", async () => {
    const migration = fs.readFileSync(MIGRATION, "utf8");
    const legacyMigration = fs.readFileSync(
      path.resolve(__dirname, "../prisma/migrations/20260714100000_b8_phase1_campaign_crm/migration.sql"),
      "utf8",
    );
    expect(legacyMigration).toMatch(
      /"ContactIdentity_owner_channel_external_live"[\s\S]*?\("ownerId","channel","externalId"\) WHERE "deletedAt" IS NULL/,
    );
    expect(migration).not.toMatch(/DROP INDEX\s+"ContactIdentity_owner_channel_external_live"/);
    expect(migration).not.toMatch(
      /CREATE UNIQUE INDEX[^;]*ON\s+"ContactIdentity"[^;]*"channelScopeId"[^;]*;/,
    );

    const indexes = await prisma.$queryRaw<Array<{ indexName: string; columns: string[] }>>`
      SELECT index_row.relname AS "indexName",
             ARRAY(
               SELECT column_row.attname
               FROM unnest(index_meta.indkey) WITH ORDINALITY AS index_column(attnum, ordinal)
               JOIN pg_attribute AS column_row
                 ON column_row.attrelid = index_meta.indrelid
                AND column_row.attnum = index_column.attnum
               WHERE index_column.attnum > 0
               ORDER BY index_column.ordinal
             )::text[] AS columns
      FROM pg_index AS index_meta
      JOIN pg_class AS table_row ON table_row.oid = index_meta.indrelid
      JOIN pg_class AS index_row ON index_row.oid = index_meta.indexrelid
      WHERE table_row.relname = 'ContactIdentity' AND index_meta.indisunique
    `;
    expect(indexes.find((index) => index.indexName === "ContactIdentity_owner_channel_external_live")?.columns).toEqual([
      "ownerId",
      "channel",
      "externalId",
    ]);
    expect(indexes.some((index) => index.columns.includes("channelScopeId"))).toBe(false);
  });

  it("does not reuse Otto Chat or publishing Channel, or add provider-specific runtime identifiers", () => {
    const schema = fs.readFileSync(SCHEMA, "utf8");
    const migration = fs.readFileSync(MIGRATION, "utf8");
    const c4Schema = schema.slice(
      schema.indexOf("model CustomerConversation"),
      schema.indexOf("// R-010 M1 consent batch"),
    );
    const runtimeLines = c4Schema
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n");

    expect(schema).toMatch(/model ChatThread \{/);
    expect(schema).toMatch(/model ChatMessage \{/);
    expect(migration).not.toMatch(/ChatThread|ChatMessage/);
    expect(migration).not.toMatch(/(?:CREATE|ALTER|DROP) TABLE "Channel"/);
    expect(runtimeLines).not.toMatch(/gupshup/i);
    expect(runtimeLines).not.toMatch(/\bprovider[A-Z_]/i);
    expect(migration).not.toMatch(/gupshup/i);
  });
});
