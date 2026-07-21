import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@fikirtive/db";
import * as customerInboxGateway from "../customer-inbox-gateway";
import { createCustomerInboxService } from "../customer-inbox-service";
import { requireOwner } from "../auth-guard";

vi.mock("../auth-guard", () => ({
  requireOwner: vi.fn(async () => ({
    email: "c4b-m2-owner@example.test",
    ownerId: "c4b-m2-test-org-a",
  })),
}));
vi.mock("../better-auth/compat", () => ({
  isImpersonating: vi.fn(async () => false),
}));

const ORG_A = "c4b-m2-test-org-a";
const ORG_B = "c4b-m2-test-org-b";
const USER_OWNER = "c4b-m2-test-user-owner";
const USER_ADMIN = "c4b-m2-test-user-admin";
const USER_MEMBER = "c4b-m2-test-user-member";
const USER_MEMBER_2 = "c4b-m2-test-user-member-2";
const USER_SUSPENDED = "c4b-m2-test-user-suspended";
const USER_REVOKED = "c4b-m2-test-user-revoked";
const USER_DELETED = "c4b-m2-test-user-deleted";
const USER_UNKNOWN = "c4b-m2-test-user-unknown";
const USER_B = "c4b-m2-test-user-b";
const OWNER = "c4b-m2-test-owner";
const ADMIN = "c4b-m2-test-admin";
const MEMBER = "c4b-m2-test-member";
const MEMBER_2 = "c4b-m2-test-member-2";
const SUSPENDED = "c4b-m2-test-suspended";
const REVOKED = "c4b-m2-test-revoked";
const DELETED = "c4b-m2-test-deleted";
const UNKNOWN = "c4b-m2-test-unknown";
const MEMBER_B = "c4b-m2-test-member-b";
const CONTACT_A = "c4b-m2-test-contact-a";
const CONTACT_B = "c4b-m2-test-contact-b";
const SCOPE_A = "c4b-m2-test-scope-a";
const SCOPE_B = "c4b-m2-test-scope-b";
const IDENTITY_A = "c4b-m2-test-identity-a";
const IDENTITY_UNASSIGNED = "c4b-m2-test-identity-unassigned";
const IDENTITY_OTTO = "c4b-m2-test-identity-otto";
const IDENTITY_OWNER = "c4b-m2-test-identity-owner";
const IDENTITY_B = "c4b-m2-test-identity-b";
const CONVERSATION_ASSIGNED = "c4b-m2-test-conversation-assigned";
const CONVERSATION_UNASSIGNED = "c4b-m2-test-conversation-unassigned";
const CONVERSATION_OTTO = "c4b-m2-test-conversation-otto";
const CONVERSATION_OWNER = "c4b-m2-test-conversation-owner";
const CONVERSATION_B = "c4b-m2-test-conversation-b";
const MESSAGE_A = "c4b-m2-test-message-a";
const MESSAGE_B = "c4b-m2-test-message-b";
const TEMPLATE_A = "c4b-m2-test-template-a";
const TEMPLATE_B = "c4b-m2-test-template-b";
const TEMPLATE_VERSION_A = "c4b-m2-test-template-version-a";
const TEMPLATE_VERSION_B = "c4b-m2-test-template-version-b";
const NOW = new Date("2026-07-21T08:00:00.000Z");
const OWNERS = [ORG_A, ORG_B];

const recordingAdapter = {
  submitReply: vi.fn(),
  submitTemplateReview: vi.fn(),
};

let sequence = 0;
let inbox = createCustomerInboxService({
  clock: () => NOW,
  id: () => `c4b-m2-test-generated-${++sequence}`,
  externalAdapter: recordingAdapter,
});

const owner = { ownerId: ORG_A, membershipId: OWNER, impersonating: false };
const admin = { ownerId: ORG_A, membershipId: ADMIN, impersonating: false };
const member = { ownerId: ORG_A, membershipId: MEMBER, impersonating: false };
const member2 = { ownerId: ORG_A, membershipId: MEMBER_2, impersonating: false };

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
    throw new Error(`Expected ${code}`);
  } catch (error) {
    if (error instanceof Error && error.message === `Expected ${code}`) throw error;
    expect(errorCode(error)).toBe(code);
  }
}

async function cleanup(): Promise<void> {
  await prisma.actionEvent.deleteMany({
    where: { ownerId: { in: OWNERS }, type: { startsWith: "c4.inbox.impersonation" } },
  });
  await prisma.customerMessageTemplateVersion.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.customerMessageTemplate.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.customerConversationDraft.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.customerConversationEvent.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.customerMessage.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.customerConversation.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.contactIdentity.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.channelScope.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.contact.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.membership.deleteMany({ where: { orgId: { in: OWNERS } } });
  await prisma.organization.deleteMany({ where: { id: { in: OWNERS } } });
  await prisma.user.deleteMany({
    where: {
      id: {
        in: [
          USER_OWNER,
          USER_ADMIN,
          USER_MEMBER,
          USER_MEMBER_2,
          USER_SUSPENDED,
          USER_REVOKED,
          USER_DELETED,
          USER_UNKNOWN,
          USER_B,
        ],
      },
    },
  });
}

async function seed(): Promise<void> {
  await prisma.organization.createMany({ data: [{ id: ORG_A }, { id: ORG_B }] });
  await prisma.user.createMany({
    data: [
      { id: USER_OWNER, email: "c4b-m2-owner@example.test" },
      { id: USER_ADMIN, email: "c4b-m2-admin@example.test" },
      { id: USER_MEMBER, email: "c4b-m2-member@example.test" },
      { id: USER_MEMBER_2, email: "c4b-m2-member-2@example.test" },
      { id: USER_SUSPENDED, email: "c4b-m2-suspended@example.test" },
      { id: USER_REVOKED, email: "c4b-m2-revoked@example.test" },
      { id: USER_DELETED, email: "c4b-m2-deleted@example.test" },
      { id: USER_UNKNOWN, email: "c4b-m2-unknown@example.test" },
      { id: USER_B, email: "c4b-m2-b@example.test" },
    ],
  });
  await prisma.membership.createMany({
    data: [
      { id: OWNER, userId: USER_OWNER, orgId: ORG_A, role: "owner" },
      { id: ADMIN, userId: USER_ADMIN, orgId: ORG_A, role: "admin" },
      { id: MEMBER, userId: USER_MEMBER, orgId: ORG_A, role: "member" },
      { id: MEMBER_2, userId: USER_MEMBER_2, orgId: ORG_A, role: "member" },
      { id: SUSPENDED, userId: USER_SUSPENDED, orgId: ORG_A, role: "member", status: "suspended" },
      { id: REVOKED, userId: USER_REVOKED, orgId: ORG_A, role: "member", status: "revoked" },
      { id: DELETED, userId: USER_DELETED, orgId: ORG_A, role: "member", deletedAt: NOW },
      { id: UNKNOWN, userId: USER_UNKNOWN, orgId: ORG_A, role: "unknown-role" },
      { id: MEMBER_B, userId: USER_B, orgId: ORG_B, role: "owner" },
    ],
  });
  await prisma.contact.createMany({
    data: [
      { id: CONTACT_A, ownerId: ORG_A, name: "Aisyah", source: "whatsapp", firstTouchAt: NOW, lastSeenAt: NOW },
      { id: CONTACT_B, ownerId: ORG_B, name: "Mei", source: "whatsapp", firstTouchAt: NOW, lastSeenAt: NOW },
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
      { id: IDENTITY_A, ownerId: ORG_A, contactId: CONTACT_A, channelScopeId: SCOPE_A, channel: "whatsapp", externalId: "+60111111111" },
      { id: IDENTITY_UNASSIGNED, ownerId: ORG_A, contactId: CONTACT_A, channelScopeId: SCOPE_A, channel: "whatsapp", externalId: "+60111111112" },
      { id: IDENTITY_OTTO, ownerId: ORG_A, contactId: CONTACT_A, channelScopeId: SCOPE_A, channel: "whatsapp", externalId: "+60111111113" },
      { id: IDENTITY_OWNER, ownerId: ORG_A, contactId: CONTACT_A, channelScopeId: SCOPE_A, channel: "whatsapp", externalId: "+60111111114" },
      { id: IDENTITY_B, ownerId: ORG_B, contactId: CONTACT_B, channelScopeId: SCOPE_B, channel: "whatsapp", externalId: "+60222222222" },
    ],
  });
  await prisma.customerConversation.createMany({
    data: [
      { id: CONVERSATION_ASSIGNED, ownerId: ORG_A, contactIdentityId: IDENTITY_A, status: "open", assigneeMembershipId: MEMBER, revision: 1, lastMessageAt: NOW, lastActivityAt: NOW },
      { id: CONVERSATION_UNASSIGNED, ownerId: ORG_A, contactIdentityId: IDENTITY_UNASSIGNED, status: "open", revision: 0, lastActivityAt: NOW },
      { id: CONVERSATION_OTTO, ownerId: ORG_A, contactIdentityId: IDENTITY_OTTO, status: "open", assigneeMembershipId: MEMBER, automationState: "otto_active", revision: 0, lastActivityAt: NOW },
      { id: CONVERSATION_OWNER, ownerId: ORG_A, contactIdentityId: IDENTITY_OWNER, status: "open", revision: 0, lastActivityAt: NOW },
      { id: CONVERSATION_B, ownerId: ORG_B, contactIdentityId: IDENTITY_B, status: "open", assigneeMembershipId: MEMBER_B, revision: 1, lastMessageAt: NOW, lastActivityAt: NOW },
    ],
  });
  await prisma.customerMessage.createMany({
    data: [
      {
        id: MESSAGE_A,
        ownerId: ORG_A,
        conversationId: CONVERSATION_ASSIGNED,
        direction: "inbound",
        actorKind: "customer",
        kind: "text",
        contentJson: { schemaVersion: 1, type: "text", text: "Alpha private hello" },
        searchText: "Alpha private hello",
        contentHash: "content-a",
        sourceEventKey: "scope-a:event-a",
        sourcePayloadHash: "payload-a",
        canonicalizationVersion: "v1",
        receivedAt: NOW,
      },
      {
        id: MESSAGE_B,
        ownerId: ORG_B,
        conversationId: CONVERSATION_B,
        direction: "inbound",
        actorKind: "customer",
        kind: "text",
        contentJson: { schemaVersion: 1, type: "text", text: "Bravo tenant secret" },
        searchText: "Bravo tenant secret",
        contentHash: "content-b",
        sourceEventKey: "scope-b:event-b",
        sourcePayloadHash: "payload-b",
        canonicalizationVersion: "v1",
        receivedAt: NOW,
      },
    ],
  });
  await prisma.customerMessageTemplate.createMany({
    data: [
      { id: TEMPLATE_A, ownerId: ORG_A, channelScopeId: SCOPE_A, channel: "whatsapp", name: "welcome_a", locale: "en_MY" },
      { id: TEMPLATE_B, ownerId: ORG_B, channelScopeId: SCOPE_B, channel: "whatsapp", name: "welcome_b", locale: "en_MY" },
    ],
  });
  await prisma.customerMessageTemplateVersion.createMany({
    data: [
      {
        id: TEMPLATE_VERSION_A,
        ownerId: ORG_A,
        templateId: TEMPLATE_A,
        revision: 1,
        purposeClass: "proactive_non_transactional",
        category: "marketing",
        definitionJson: { schemaVersion: 1, body: "Hello {{name}}", variables: [{ key: "name", sample: "Aisyah" }] },
        contentHash: "template-content-a",
        createdByMembershipId: OWNER,
      },
      {
        id: TEMPLATE_VERSION_B,
        ownerId: ORG_B,
        templateId: TEMPLATE_B,
        revision: 1,
        purposeClass: "proactive_non_transactional",
        category: "marketing",
        definitionJson: { schemaVersion: 1, body: "Private B", variables: [] },
        contentHash: "template-content-b",
        createdByMembershipId: MEMBER_B,
      },
    ],
  });
}

async function ownerCounts(ownerId = ORG_A) {
  const [conversations, messages, events, drafts, templates, versions] = await Promise.all([
    prisma.customerConversation.count({ where: { ownerId } }),
    prisma.customerMessage.count({ where: { ownerId } }),
    prisma.customerConversationEvent.count({ where: { ownerId } }),
    prisma.customerConversationDraft.count({ where: { ownerId } }),
    prisma.customerMessageTemplate.count({ where: { ownerId } }),
    prisma.customerMessageTemplateVersion.count({ where: { ownerId } }),
  ]);
  return { conversations, messages, events, drafts, templates, versions };
}

beforeEach(async () => {
  await cleanup();
  await seed();
  sequence = 0;
  vi.clearAllMocks();
  inbox = createCustomerInboxService({
    clock: () => NOW,
    id: () => `c4b-m2-test-generated-${++sequence}`,
    externalAdapter: recordingAdapter,
  });
});

afterAll(cleanup);

describe("C4b-M2 capabilities, inactive/unknown memberships, and impersonation", () => {
  it("allows every active role to read the same owner-scoped inbox surfaces", async () => {
    for (const principal of [owner, admin, member]) {
      const results = await Promise.all([
        inbox.listConversations(principal, { view: "all" }),
        inbox.getConversation(principal, { conversationId: CONVERSATION_ASSIGNED }),
        inbox.searchConversations(principal, { query: "Alpha" }),
        inbox.getHistory(principal, { conversationId: CONVERSATION_ASSIGNED }),
        inbox.getConversationPreflight(principal, { conversationId: CONVERSATION_ASSIGNED }),
        inbox.listTemplates(principal, { channelScopeId: SCOPE_A }),
      ]);
      const serialized = JSON.stringify(results);
      expect(serialized).toContain(CONVERSATION_ASSIGNED);
      expect(serialized).toContain(MESSAGE_A);
      expect(serialized).toContain(TEMPLATE_A);
      expect(serialized).not.toContain(CONVERSATION_B);
      expect(serialized).not.toContain(MESSAGE_B);
      expect(serialized).not.toContain(TEMPLATE_B);
    }
  });

  it("lets a member self-claim and act only while assigned, including explicit handoff without resume", async () => {
    await inbox.assignConversation(member, {
      conversationId: CONVERSATION_UNASSIGNED,
      expectedRevision: 0,
      targetMembershipId: MEMBER,
    });
    await expectCode(
      inbox.assignConversation(member, {
        conversationId: CONVERSATION_UNASSIGNED,
        expectedRevision: 1,
        targetMembershipId: MEMBER_2,
      }),
      "ACTION_DENIED",
    );
    await inbox.saveConversationDraft(member, {
      conversationId: CONVERSATION_ASSIGNED,
      conversationBaseRevision: 1,
      draftBaseRevision: null,
      text: "A safe local draft",
    });
    await inbox.takeOverConversation(member, { conversationId: CONVERSATION_OTTO, expectedRevision: 0 });
    await inbox.handOffConversation(member, {
      conversationId: CONVERSATION_OTTO,
      expectedRevision: 1,
      targetMembershipId: MEMBER_2,
      note: "Please continue",
    });
    const handedOff = await prisma.customerConversation.findFirstOrThrow({
      where: { ownerId: ORG_A, id: CONVERSATION_OTTO },
    });
    expect(handedOff).toMatchObject({
      assigneeMembershipId: MEMBER_2,
      automationState: "paused_by_human",
      revision: 2,
    });
    await inbox.setConversationStatus(member, {
      conversationId: CONVERSATION_ASSIGNED,
      expectedRevision: 1,
      status: "closed",
    });
  });

  it("allows owner/admin internal management, fixes template classification server-side, and never activates resume", async () => {
    await inbox.assignConversation(owner, {
      conversationId: CONVERSATION_OWNER,
      expectedRevision: 0,
      targetMembershipId: MEMBER_2,
    });
    await inbox.assignConversation(admin, {
      conversationId: CONVERSATION_OWNER,
      expectedRevision: 1,
      targetMembershipId: null,
    });
    await inbox.requestAutomationResume(admin, {
      conversationId: CONVERSATION_OWNER,
      expectedRevision: 2,
      note: "Resume when safe",
    });
    const root = await inbox.createMessageTemplate(owner, {
      channelScopeId: SCOPE_A,
      channel: "whatsapp",
      name: "promo_july",
      locale: "en_MY",
    });
    await inbox.createMessageTemplateVersion(admin, {
      templateId: root.resource.id,
      body: "Hello {{name}}",
      variables: [{ key: "name", sample: "Aisyah" }],
      purposeClass: "transactional",
      category: "utility",
    } as never);
    const conversation = await prisma.customerConversation.findFirstOrThrow({
      where: { ownerId: ORG_A, id: CONVERSATION_OWNER },
    });
    expect(conversation.automationState).toBe("disabled");
    expect(conversation.assigneeMembershipId).toBeNull();
    const version = await prisma.customerMessageTemplateVersion.findFirstOrThrow({
      where: { ownerId: ORG_A, templateId: root.resource.id },
    });
    expect(version).toMatchObject({
      purposeClass: "proactive_non_transactional",
      category: "marketing",
      submissionState: "draft",
      reviewState: "not_submitted",
      availabilityState: "unavailable",
    });
  });

  it("fails closed for non-active/deleted/unknown memberships and makes impersonation read-only", async () => {
    const before = await ownerCounts();
    for (const membershipId of [SUSPENDED, REVOKED, DELETED, UNKNOWN]) {
      const principal = { ownerId: ORG_A, membershipId, impersonating: false };
      await expectCode(inbox.listConversations(principal, { view: "all" }), "ACTION_DENIED");
      await expectCode(
        inbox.assignConversation(principal, {
          conversationId: CONVERSATION_UNASSIGNED,
          expectedRevision: 0,
          targetMembershipId: membershipId,
        }),
        "ACTION_DENIED",
      );
    }
    const impersonating = { ...owner, impersonating: true };
    await expect(inbox.listConversations(impersonating, { view: "all" })).resolves.toBeDefined();
    await expectCode(
      inbox.setConversationStatus(impersonating, {
        conversationId: CONVERSATION_OWNER,
        expectedRevision: 0,
        status: "closed",
      }),
      "IMPERSONATION_READ_ONLY",
    );
    expect(await ownerCounts()).toEqual(before);
  });
});

describe("C4b-M2 tenant-qualified ID swaps", () => {
  it("treats foreign and missing IDs alike, leaks nothing, and leaves both tenants unchanged", async () => {
    const beforeA = await ownerCounts(ORG_A);
    const beforeB = await ownerCounts(ORG_B);
    const foreignAndMissing = [CONVERSATION_B, "c4b-m2-test-missing-conversation"];
    for (const conversationId of foreignAndMissing) {
      await expectCode(inbox.getConversation(owner, { conversationId }), "RESOURCE_NOT_FOUND");
      await expectCode(inbox.getHistory(owner, { conversationId }), "RESOURCE_NOT_FOUND");
    }
    await expect(
      customerInboxGateway.getConversation({
        conversationId: CONVERSATION_B,
        ownerId: ORG_B,
      } as never),
    ).resolves.toEqual({ ok: false, error: "RESOURCE_NOT_FOUND" });
    await expectCode(
      inbox.assignConversation(owner, {
        conversationId: CONVERSATION_OWNER,
        expectedRevision: 0,
        targetMembershipId: MEMBER_B,
      }),
      "RESOURCE_NOT_FOUND",
    );
    await expectCode(
      inbox.createMessageTemplate(owner, {
        channelScopeId: SCOPE_B,
        channel: "whatsapp",
        name: "foreign_scope",
        locale: "en_MY",
      }),
      "RESOURCE_NOT_FOUND",
    );
    await expectCode(
      inbox.createMessageTemplateVersion(owner, {
        templateId: TEMPLATE_B,
        body: "No leak",
        variables: [],
      }),
      "RESOURCE_NOT_FOUND",
    );
    await expectCode(
      inbox.writeNormalizedInbound({
        ownerId: ORG_A,
        contactIdentityId: IDENTITY_B,
        sourceEventKey: "scope-a:foreign-identity",
        sourcePayloadHash: "payload-foreign",
        canonicalizationVersion: "v1",
        text: "Do not attach",
      }),
      "RESOURCE_NOT_FOUND",
    );
    const list = JSON.stringify(await inbox.listConversations(owner, { view: "all" }));
    const search = JSON.stringify(await inbox.searchConversations(owner, { query: "Bravo tenant secret" }));
    const history = JSON.stringify(await inbox.getHistory(owner, { conversationId: CONVERSATION_ASSIGNED }));
    const templates = JSON.stringify(await inbox.listTemplates(owner, {}));
    for (const serialized of [list, search, history, templates]) {
      expect(serialized).not.toContain(CONVERSATION_B);
      expect(serialized).not.toContain(MESSAGE_B);
      expect(serialized).not.toContain(IDENTITY_B);
      expect(serialized).not.toContain(TEMPLATE_B);
      expect(serialized).not.toContain(TEMPLATE_VERSION_B);
    }
    expect(await ownerCounts(ORG_A)).toEqual(beforeA);
    expect(await ownerCounts(ORG_B)).toEqual(beforeB);
    expect(recordingAdapter.submitReply).not.toHaveBeenCalled();
    expect(recordingAdapter.submitTemplateReview).not.toHaveBeenCalled();
  });
});

describe("C4b-M2 assignment, takeover, draft, and status CAS races", () => {
  it.each([
    ["assignment", () => inbox.assignConversation(owner, { conversationId: CONVERSATION_UNASSIGNED, expectedRevision: 0, targetMembershipId: MEMBER })],
    ["takeover", () => inbox.takeOverConversation(member, { conversationId: CONVERSATION_OTTO, expectedRevision: 0 })],
    ["status", () => inbox.setConversationStatus(owner, { conversationId: CONVERSATION_OWNER, expectedRevision: 0, status: "closed" })],
  ] as Array<[string, () => Promise<unknown>]>)(
    "allows exactly one %s writer at the same conversation revision",
    async (_label, write) => {
      const settled = await Promise.allSettled([write(), write()]);
      expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const loser = settled.find((result) => result.status === "rejected") as PromiseRejectedResult;
      expect(errorCode(loser.reason)).toBe("CAS_CONFLICT");
    },
  );

  it("allows exactly one draft writer at the same conversation and draft revisions", async () => {
    const input = {
      conversationId: CONVERSATION_ASSIGNED,
      conversationBaseRevision: 1,
      draftBaseRevision: null,
      text: "Concurrent draft",
    };
    const settled = await Promise.allSettled([
      inbox.saveConversationDraft(member, input),
      inbox.saveConversationDraft(member, input),
    ]);
    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const loser = settled.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(errorCode(loser.reason)).toBe("CAS_CONFLICT");
    await expect(
      prisma.customerConversationDraft.count({
        where: { ownerId: ORG_A, conversationId: CONVERSATION_ASSIGNED },
      }),
    ).resolves.toBe(1);
  });
});

describe("C4b-M2 event/projection transaction rollback", () => {
  it("rolls back the projection when event insertion is forced to fail", async () => {
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION c4b_m2_fail_event_for_test() RETURNS trigger AS $$
      BEGIN
        IF NEW."kind" = 'closed' THEN
          RAISE EXCEPTION 'forced c4b m2 event failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER c4b_m2_fail_event_for_test
      BEFORE INSERT ON "CustomerConversationEvent"
      FOR EACH ROW EXECUTE FUNCTION c4b_m2_fail_event_for_test()
    `);
    try {
      await expect(
        inbox.setConversationStatus(owner, {
          conversationId: CONVERSATION_OWNER,
          expectedRevision: 0,
          status: "closed",
        }),
      ).rejects.toBeDefined();
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS c4b_m2_fail_event_for_test ON "CustomerConversationEvent"`,
      );
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS c4b_m2_fail_event_for_test()`);
    }
    await expect(
      prisma.customerConversation.findFirstOrThrow({
        where: { ownerId: ORG_A, id: CONVERSATION_OWNER },
      }),
    ).resolves.toMatchObject({ status: "open", revision: 0 });
    await expect(
      prisma.customerConversationEvent.count({
        where: { ownerId: ORG_A, conversationId: CONVERSATION_OWNER },
      }),
    ).resolves.toBe(0);
  });
});

describe("C4b-M2 normalized inbound idempotency", () => {
  it("makes same-key/same-hash replay a no-op and same-key/different-hash a conflict", async () => {
    const input = {
      ownerId: ORG_A,
      contactIdentityId: IDENTITY_A,
      sourceEventKey: "scope-a:inbound-idempotency",
      sourcePayloadHash: "payload-same",
      canonicalizationVersion: "v1",
      text: "A new inbound message",
    };
    const first = await inbox.writeNormalizedInbound(input);
    const replay = await inbox.writeNormalizedInbound(input);
    expect(first.duplicate).toBe(false);
    expect(replay.duplicate).toBe(true);
    const beforeConflict = await ownerCounts();
    await expectCode(
      inbox.writeNormalizedInbound({ ...input, sourcePayloadHash: "payload-different", text: "Changed" }),
      "IDEMPOTENCY_CONFLICT",
    );
    expect(await ownerCounts()).toEqual(beforeConflict);
    await expect(
      prisma.customerMessage.count({ where: { ownerId: ORG_A, sourceEventKey: input.sourceEventKey } }),
    ).resolves.toBe(1);
  });

  it("reopens a closed thread with one visible event in the same accepted write", async () => {
    await prisma.customerConversation.updateMany({
      where: { ownerId: ORG_A, id: CONVERSATION_ASSIGNED, revision: 1 },
      data: { status: "closed" },
    });
    await inbox.writeNormalizedInbound({
      ownerId: ORG_A,
      contactIdentityId: IDENTITY_A,
      sourceEventKey: "scope-a:reopen-inbound",
      sourcePayloadHash: "payload-reopen",
      canonicalizationVersion: "v1",
      text: "Please reopen",
    });
    await expect(
      prisma.customerConversation.findFirstOrThrow({
        where: { ownerId: ORG_A, id: CONVERSATION_ASSIGNED },
      }),
    ).resolves.toMatchObject({ status: "open", revision: 2 });
    await expect(
      prisma.customerConversationEvent.count({
        where: { ownerId: ORG_A, conversationId: CONVERSATION_ASSIGNED, kind: "opened", revision: 2 },
      }),
    ).resolves.toBe(1);
  });
});

describe("C4b-M2 hard-disabled external ports", () => {
  it("returns stable unavailable errors and never calls the recording adapter or changes storage", async () => {
    const before = await ownerCounts();
    await expectCode(
      inbox.submitConversationReply(owner, {
        conversationId: CONVERSATION_ASSIGNED,
        conversationRevision: 1,
        draftRevision: 0,
      }),
      "SEND_PATH_UNAVAILABLE",
    );
    await expectCode(
      inbox.submitTemplateReview(owner, {
        templateVersionId: TEMPLATE_VERSION_A,
        reviewRevision: 0,
      }),
      "TEMPLATE_SUBMISSION_UNAVAILABLE",
    );
    expect(recordingAdapter.submitReply).not.toHaveBeenCalled();
    expect(recordingAdapter.submitTemplateReview).not.toHaveBeenCalled();
    expect(await ownerCounts()).toEqual(before);
  });
});

describe("C4b-M2 gateway principal resolution", () => {
  it("routes every gateway export through resolvePrincipal, denying NOT_AUTHORIZED when requireOwner fails", async () => {
    const mockedRequireOwner = vi.mocked(requireOwner);
    // Enumerate the module's OWN exports at runtime rather than a hard-coded list, so a
    // future export that bypasses resolvePrincipal (e.g. hits Prisma directly) fails this
    // test instead of silently shipping unauthenticated.
    const exportNames = Object.keys(customerInboxGateway).filter(
      (name) => typeof (customerInboxGateway as Record<string, unknown>)[name] === "function",
    );
    expect(exportNames.length).toBeGreaterThan(0);
    for (const name of exportNames) {
      mockedRequireOwner.mockResolvedValueOnce({ error: "Not authorized." });
      const fn = (
        customerInboxGateway as Record<string, (input?: unknown) => Promise<unknown>>
      )[name];
      await expect(fn(undefined)).resolves.toEqual({ ok: false, error: "NOT_AUTHORIZED" });
    }
  });

  it("denies ACTION_DENIED when the session resolves but no active membership matches", async () => {
    const mockedRequireOwner = vi.mocked(requireOwner);
    // c4b-m2-b@example.test only has a membership in ORG_B; claiming ORG_A leaves the
    // membership lookup at customer-inbox-gateway.ts:34-42 with no active, non-deleted row.
    mockedRequireOwner.mockResolvedValueOnce({ email: "c4b-m2-b@example.test", ownerId: ORG_A });
    await expect(
      customerInboxGateway.getConversation({ conversationId: CONVERSATION_ASSIGNED }),
    ).resolves.toEqual({ ok: false, error: "ACTION_DENIED" });
  });
});

describe("C4b-M2 gateway mutation routing", () => {
  it("saveConversationDraft succeeds through the gateway", async () => {
    const result = await customerInboxGateway.saveConversationDraft({
      conversationId: CONVERSATION_ASSIGNED,
      conversationBaseRevision: 1,
      draftBaseRevision: null,
      text: "Gateway draft",
    });
    expect(result).toMatchObject({ ok: true, change: { kind: "draft_saved" } });
  });

  it("assignConversation succeeds through the gateway", async () => {
    const result = await customerInboxGateway.assignConversation({
      conversationId: CONVERSATION_UNASSIGNED,
      expectedRevision: 0,
      targetMembershipId: MEMBER,
    });
    expect(result).toMatchObject({ ok: true, change: { kind: "assigned" } });
  });

  it("maps a CustomerInboxError to a structured {ok:false,error} instead of a raw rejection", async () => {
    await expect(
      customerInboxGateway.assignConversation({
        conversationId: CONVERSATION_UNASSIGNED,
        expectedRevision: 999,
        targetMembershipId: MEMBER,
      }),
    ).resolves.toEqual({ ok: false, error: "CAS_CONFLICT" });
  });

  it("takeOverConversation succeeds through the gateway", async () => {
    const result = await customerInboxGateway.takeOverConversation({
      conversationId: CONVERSATION_OTTO,
      expectedRevision: 0,
    });
    expect(result).toMatchObject({ ok: true, change: { kind: "takeover" } });
  });

  it("handOffConversation succeeds through the gateway", async () => {
    const result = await customerInboxGateway.handOffConversation({
      conversationId: CONVERSATION_ASSIGNED,
      expectedRevision: 1,
      targetMembershipId: MEMBER_2,
      note: "Gateway handoff",
    });
    expect(result).toMatchObject({ ok: true, change: { kind: "handoff" } });
  });

  it("setConversationStatus succeeds through the gateway", async () => {
    const result = await customerInboxGateway.setConversationStatus({
      conversationId: CONVERSATION_ASSIGNED,
      expectedRevision: 1,
      status: "closed",
    });
    expect(result).toMatchObject({ ok: true, change: { kind: "closed" } });
  });

  it("requestAutomationResume succeeds through the gateway", async () => {
    const result = await customerInboxGateway.requestAutomationResume({
      conversationId: CONVERSATION_OWNER,
      expectedRevision: 0,
      note: "Gateway resume",
    });
    expect(result).toMatchObject({
      ok: true,
      change: { kind: "automation_resume_requested" },
    });
  });

  it("createMessageTemplate succeeds through the gateway", async () => {
    const result = await customerInboxGateway.createMessageTemplate({
      channelScopeId: SCOPE_A,
      channel: "whatsapp",
      name: "gateway_template",
      locale: "en_MY",
    });
    expect(result).toMatchObject({ ok: true, change: { kind: "template_created" } });
  });

  it("createMessageTemplateVersion succeeds through the gateway", async () => {
    const result = await customerInboxGateway.createMessageTemplateVersion({
      templateId: TEMPLATE_A,
      body: "Gateway body {{name}}",
      variables: [{ key: "name", sample: "Aisyah" }],
    });
    expect(result).toMatchObject({
      ok: true,
      change: { kind: "template_version_created" },
    });
  });

  it("submitConversationReply stays hard-disabled through the gateway", async () => {
    await expect(
      customerInboxGateway.submitConversationReply({
        conversationId: CONVERSATION_ASSIGNED,
        conversationRevision: 1,
        draftRevision: 0,
      }),
    ).resolves.toEqual({ ok: false, error: "SEND_PATH_UNAVAILABLE" });
  });

  it("submitTemplateReview stays hard-disabled through the gateway", async () => {
    await expect(
      customerInboxGateway.submitTemplateReview({
        templateVersionId: TEMPLATE_VERSION_A,
        reviewRevision: 0,
      }),
    ).resolves.toEqual({ ok: false, error: "TEMPLATE_SUBMISSION_UNAVAILABLE" });
  });
});

describe("C4b-M2 role-denial branches", () => {
  it("denies saveConversationDraft to a non-assignee member", async () => {
    await expectCode(
      inbox.saveConversationDraft(member2, {
        conversationId: CONVERSATION_ASSIGNED,
        conversationBaseRevision: 1,
        draftBaseRevision: null,
        text: "Not my conversation",
      }),
      "ACTION_DENIED",
    );
  });

  it("denies takeOverConversation to a non-assignee member", async () => {
    await expectCode(
      inbox.takeOverConversation(member2, {
        conversationId: CONVERSATION_OTTO,
        expectedRevision: 0,
      }),
      "ACTION_DENIED",
    );
  });

  it("denies handOffConversation to a non-assignee member", async () => {
    await expectCode(
      inbox.handOffConversation(member2, {
        conversationId: CONVERSATION_ASSIGNED,
        expectedRevision: 1,
        targetMembershipId: MEMBER_2,
      }),
      "ACTION_DENIED",
    );
  });

  it("denies setConversationStatus to a non-assignee member", async () => {
    await expectCode(
      inbox.setConversationStatus(member2, {
        conversationId: CONVERSATION_ASSIGNED,
        expectedRevision: 1,
        status: "closed",
      }),
      "ACTION_DENIED",
    );
  });

  it("denies requestAutomationResume to a member", async () => {
    await expectCode(
      inbox.requestAutomationResume(member, {
        conversationId: CONVERSATION_OWNER,
        expectedRevision: 0,
        note: "Please resume",
      }),
      "ACTION_DENIED",
    );
  });

  it("denies createMessageTemplate to a member", async () => {
    await expectCode(
      inbox.createMessageTemplate(member, {
        channelScopeId: SCOPE_A,
        channel: "whatsapp",
        name: "member_template",
        locale: "en_MY",
      }),
      "ACTION_DENIED",
    );
  });

  it("denies createMessageTemplateVersion to a member", async () => {
    await expectCode(
      inbox.createMessageTemplateVersion(member, {
        templateId: TEMPLATE_A,
        body: "Member body",
        variables: [],
      }),
      "ACTION_DENIED",
    );
  });

  it("denies submitTemplateReview to a member", async () => {
    await expectCode(
      inbox.submitTemplateReview(member, {
        templateVersionId: TEMPLATE_VERSION_A,
        reviewRevision: 0,
      }),
      "ACTION_DENIED",
    );
  });
});

describe("C4b-M2 preflight capability gate", () => {
  it("blocks internalCapability for a non-assignee member", async () => {
    const preflight = await inbox.getConversationPreflight(member2, {
      conversationId: CONVERSATION_ASSIGNED,
    });
    expect(preflight.internalCapability.status).toBe("block");
  });
});

describe("C4b-M2 principal identity cross-tenant check", () => {
  it("denies a membershipId whose real orgId doesn't match the claimed ownerId", async () => {
    // MEMBER_B genuinely exists, but under ORG_B — pairing it with a claimed ORG_A
    // ownerId must be denied by activeMembership's orgId predicate, not silently matched.
    const crossTenant = { ownerId: ORG_A, membershipId: MEMBER_B, impersonating: false };
    await expectCode(inbox.listConversations(crossTenant, { view: "all" }), "ACTION_DENIED");
  });
});

describe("C4b-M2 needs_reply view integrity", () => {
  it("does not drop a genuine needs_reply conversation behind a burst of waiting_on_customer activity", async () => {
    const floodCount = 60; // overflow the old fixed top-50-by-recency window
    const flood = Array.from({ length: floodCount }, (_, i) => ({
      identityId: `c4b-m2-test-identity-flood-${i}`,
      conversationId: `c4b-m2-test-conversation-flood-${i}`,
      messageId: `c4b-m2-test-message-flood-${i}`,
      externalId: `+601999${String(i).padStart(6, "0")}`,
      // Each flood row is more recently active than CONVERSATION_ASSIGNED (NOW).
      activity: new Date(NOW.getTime() + (i + 1) * 1000),
    }));
    await prisma.contactIdentity.createMany({
      data: flood.map((f) => ({
        id: f.identityId,
        ownerId: ORG_A,
        contactId: CONTACT_A,
        channelScopeId: SCOPE_A,
        channel: "whatsapp",
        externalId: f.externalId,
      })),
    });
    await prisma.customerConversation.createMany({
      data: flood.map((f) => ({
        id: f.conversationId,
        ownerId: ORG_A,
        contactIdentityId: f.identityId,
        status: "open",
        revision: 0,
        lastMessageAt: f.activity,
        lastActivityAt: f.activity,
      })),
    });
    await prisma.customerMessage.createMany({
      data: flood.map((f) => ({
        id: f.messageId,
        ownerId: ORG_A,
        conversationId: f.conversationId,
        direction: "outbound",
        actorKind: "merchant_member",
        kind: "text",
        contentJson: { schemaVersion: 1, type: "text", text: "We'll follow up shortly" },
        searchText: "We'll follow up shortly",
        contentHash: `flood-content-${f.messageId}`,
        canonicalizationVersion: "v1",
        receivedAt: f.activity,
      })),
    });

    const results = await inbox.listConversations(owner, { view: "needs_reply" });
    expect(results.some((row) => (row as { id: string }).id === CONVERSATION_ASSIGNED)).toBe(
      true,
    );
  });
});

describe("C4b-M2 control-character validation", () => {
  it("rejects a control character but allows tabs and newlines in bounded text", async () => {
    await expectCode(
      inbox.createMessageTemplate(owner, {
        channelScopeId: SCOPE_A,
        channel: "whatsapp",
        name: "bad\x07name",
        locale: "en_MY",
      }),
      "INVALID_ARGUMENT",
    );
    const saved = await inbox.saveConversationDraft(member, {
      conversationId: CONVERSATION_ASSIGNED,
      conversationBaseRevision: 1,
      draftBaseRevision: null,
      text: "Line one\nLine two\twith a tab",
    });
    expect(saved.resource.contentJson).toMatchObject({
      text: "Line one\nLine two\twith a tab",
    });
  });
});
