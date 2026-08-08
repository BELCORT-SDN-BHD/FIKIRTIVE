import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  prisma,
  recordContactDndEvent,
  recordConsentEvent,
  recordProviderRefusalEvent,
  recordSendFrequencyEvent,
} from "@fikirtive/db";
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
const CONNECTION_EXPIRED = "c4b-m2-test-connection-expired";
const CONNECTION_ACTIVE = "c4b-m2-test-connection-active";
const CONNECTION_ACTIVE_SECOND = "c4b-m2-test-connection-active-second";
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
  // C5-M2 preflight wiring (ledger #386): the four axes now read real consent/DND/frequency
  // facts, so tests that write them need cleanup before Contact's onDelete:Restrict FKs below.
  await prisma.contactSendFrequencyEvent.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.providerRefusalState.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.providerRefusalEvent.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.consentStateProjection.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.consentEvent.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.contactDndEvent.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.customerMessageTemplateVersion.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.customerMessageTemplate.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.customerConversationDraft.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.customerConversationEvent.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.customerMessage.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.customerConversation.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.contactIdentity.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.channelConnection.deleteMany({ where: { ownerId: { in: OWNERS } } });
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
  await prisma.membershipRole.createMany({
    data: [
      { membershipId: OWNER, role: "owner" },
      { membershipId: ADMIN, role: "admin" },
      { membershipId: MEMBER, role: "member" },
      { membershipId: MEMBER_2, role: "member" },
      { membershipId: SUSPENDED, role: "member" },
      { membershipId: REVOKED, role: "member" },
      { membershipId: DELETED, role: "member" },
      { membershipId: MEMBER_B, role: "owner" },
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
    await inbox.handOffConversation(member, {
      conversationId: CONVERSATION_OTTO,
      expectedRevision: 0,
      targetMembershipId: MEMBER_2,
      note: "Please continue",
    });
    const handedOff = await prisma.customerConversation.findFirstOrThrow({
      where: { ownerId: ORG_A, id: CONVERSATION_OTTO },
    });
    // #810 P3-1: the hand-off moves the assignee and nothing else. The legacy automationState
    // is left exactly as it was found — no action in the product writes it any more.
    expect(handedOff).toMatchObject({
      assigneeMembershipId: MEMBER_2,
      automationState: "otto_active",
      revision: 1,
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

describe("C4b-M2 assignment, draft, and status CAS races", () => {
  it.each([
    ["assignment", () => inbox.assignConversation(owner, { conversationId: CONVERSATION_UNASSIGNED, expectedRevision: 0, targetMembershipId: MEMBER })],
    ["handoff", () => inbox.handOffConversation(member, { conversationId: CONVERSATION_ASSIGNED, expectedRevision: 1, targetMembershipId: MEMBER_2 })],
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

  // The CAS check must run before every state precondition: the loser of a revision
  // race (or a stale replay) must learn CAS_CONFLICT, never a misleading
  // ACTION_DENIED/INVALID_ARGUMENT produced by the winner's own effect on the state.
  it("reports stale assignment and handoff replays as revision conflicts", async () => {
    await inbox.assignConversation(owner, {
      conversationId: CONVERSATION_UNASSIGNED,
      expectedRevision: 0,
      targetMembershipId: MEMBER,
    });
    await expectCode(
      inbox.assignConversation(owner, {
        conversationId: CONVERSATION_UNASSIGNED,
        expectedRevision: 0,
        targetMembershipId: MEMBER,
      }),
      "CAS_CONFLICT",
    );
    await inbox.handOffConversation(member, {
      conversationId: CONVERSATION_OTTO,
      expectedRevision: 0,
      targetMembershipId: MEMBER_2,
    });
    await expectCode(
      inbox.handOffConversation(member, {
        conversationId: CONVERSATION_OTTO,
        expectedRevision: 0,
        targetMembershipId: MEMBER_2,
      }),
      "CAS_CONFLICT",
    );
  });

  // #810 P3-1: the server used to refuse a draft on an `otto_active` conversation with
  // "Take over the conversation from Otto…" — pointing at a button the page no longer has,
  // for a state nothing in the product writes. A merchant carrying that value from an older
  // release could not edit their own draft. The stored value is still reported honestly; it
  // simply stops blocking anyone.
  it("a conversation still carrying the legacy otto_active value can be drafted in", async () => {
    const saved = await inbox.saveConversationDraft(member, {
      conversationId: CONVERSATION_OTTO,
      conversationBaseRevision: 0,
      draftBaseRevision: null,
      text: "Typing my own reply, thanks",
    });
    expect(saved).toBeTruthy();
    const draft = await prisma.customerConversationDraft.findFirstOrThrow({
      where: { ownerId: ORG_A, conversationId: CONVERSATION_OTTO },
    });
    expect(draft.contentJson).toMatchObject({ text: "Typing my own reply, thanks" });
    // The stored automation value is untouched — the guard is gone, not the history.
    const conversation = await prisma.customerConversation.findFirstOrThrow({
      where: { ownerId: ORG_A, id: CONVERSATION_OTTO },
    });
    expect(conversation.automationState).toBe("otto_active");
  });

  it("reports a stale same-status replay as a revision conflict", async () => {
    await inbox.setConversationStatus(owner, {
      conversationId: CONVERSATION_OWNER,
      expectedRevision: 0,
      status: "closed",
    });

    await expectCode(
      inbox.setConversationStatus(owner, {
        conversationId: CONVERSATION_OWNER,
        expectedRevision: 0,
        status: "closed",
      }),
      "CAS_CONFLICT",
    );
  });

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

// #729 — a template version is an immutable record and the payload of every broadcast, so a
// body whose {{placeholders}} disagree with the declared variables can never be corrected once
// written. The screen teaches the {{name}} convention; this is what enforces it.
describe("#729 template placeholders must line up with the declared variables", () => {
  it("refuses a version that uses undeclared placeholders and declares an unused variable, and writes nothing", async () => {
    const before = await ownerCounts();
    let refusal: unknown;
    try {
      await inbox.createMessageTemplateVersion(admin, {
        templateId: TEMPLATE_A,
        body: "Hi {{name}}, weekend special: 20% off all beans at {{shop}}.",
        variables: [{ key: "firstName", sample: "Aisyah" }],
      });
      throw new Error("Expected TEMPLATE_VARIABLE_MISMATCH");
    } catch (error) {
      if (error instanceof Error && error.message === "Expected TEMPLATE_VARIABLE_MISMATCH") throw error;
      refusal = error;
    }
    expect(errorCode(refusal)).toBe("TEMPLATE_VARIABLE_MISMATCH");
    // Both directions, named: what the message asked for and what the list promised.
    const detail = (refusal as { detail?: string }).detail ?? "";
    expect(detail).toContain("{{name}}");
    expect(detail).toContain("{{shop}}");
    expect(detail).toContain("firstName");
    expect(await ownerCounts()).toEqual(before);
  });

  it("still accepts a body and variables that agree, including a body with no placeholders", async () => {
    await expect(inbox.createMessageTemplateVersion(admin, {
      templateId: TEMPLATE_A,
      body: "Hi {{name}}, your order is ready at {{shop}}.",
      variables: [{ key: "name", sample: "Aisyah" }, { key: "shop", sample: "Kedai Kopi" }],
    })).resolves.toMatchObject({ ok: true, change: { kind: "template_version_created" } });
    await expect(inbox.createMessageTemplateVersion(admin, {
      templateId: TEMPLATE_A,
      body: "Our shop is closed this Monday.",
      variables: [],
    })).resolves.toMatchObject({ ok: true, change: { kind: "template_version_created" } });
  });

  it("gives a caller that bypasses the UI the same sentence, not a bare code", async () => {
    const result = await customerInboxGateway.createMessageTemplateVersion({
      templateId: TEMPLATE_A,
      body: "Hi {{name}}",
      variables: [],
    });
    expect(result).toMatchObject({ ok: false, error: "TEMPLATE_VARIABLE_MISMATCH" });
    expect((result as { detail?: string }).detail).toContain("{{name}}");
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

describe("C4b-M3 preflight freshness contract (issue #378)", () => {
  it("returns the three freshness timestamps separately, honest about missing provider/health evidence", async () => {
    const preflight = await inbox.getConversationPreflight(owner, {
      conversationId: CONVERSATION_ASSIGNED,
    });
    // Per §7.3: never merge these into one synthetic "last synced" — a missing value is
    // honest unknown, not a guess from unrelated evidence.
    expect(preflight.freshness).toEqual({
      lastProviderEventAt: null,
      lastHealthCheckedAt: null,
      lastDataLoadedAt: NOW,
    });
    // Additive-only: the pre-existing checkedAt field is untouched.
    expect(preflight.checkedAt).toEqual(NOW);
  });
});

describe("C5-M2 preflight provider-connection resolution", () => {
  async function createConnection(
    id: string,
    status: "active" | "expired",
    createdAt: Date,
  ) {
    return prisma.channelConnection.create({
      data: {
        id,
        ownerId: ORG_A,
        kind: "whatsapp",
        channelScopeId: SCOPE_A,
        externalId: id,
        accessTokenEnc: `ciphertext:${id}`,
        status,
        createdAt,
      },
    });
  }

  async function providerRefusalAxis() {
    const preflight = await inbox.getConversationPreflight(owner, {
      conversationId: CONVERSATION_ASSIGNED,
    });
    return preflight.providerRefusal;
  }

  it("ignores an expired connection's refusal", async () => {
    await createConnection(
      CONNECTION_EXPIRED,
      "expired",
      new Date("2026-07-01T00:00:00Z"),
    );
    await createConnection(
      CONNECTION_ACTIVE,
      "active",
      new Date("2026-07-02T00:00:00Z"),
    );
    await recordProviderRefusalEvent({
      ownerId: ORG_A,
      providerConnectionId: CONNECTION_EXPIRED,
      kind: "account_level",
      action: "block",
      providerCode: "account_suspended",
      receiptRef: "receipt:c4b-expired-block",
      idempotencyKey: "c4b-provider-expired-block",
    });

    const axisResult = await providerRefusalAxis();
    expect(axisResult.status).toBe("pass");
    expect(axisResult.reason).toBeUndefined();
  });

  it("uses the sole active connection", async () => {
    await createConnection(
      CONNECTION_ACTIVE,
      "active",
      new Date("2026-07-02T00:00:00Z"),
    );
    await recordProviderRefusalEvent({
      ownerId: ORG_A,
      providerConnectionId: CONNECTION_ACTIVE,
      kind: "account_level",
      action: "block",
      providerCode: "account_suspended",
      receiptRef: "receipt:c4b-active-block",
      idempotencyKey: "c4b-provider-active-block",
    });

    expect(await providerRefusalAxis()).toMatchObject({
      status: "block",
      reason: "account_level_block",
    });
  });

  it("preserves the no-connection refusal-axis shape when zero active connections match", async () => {
    await createConnection(
      CONNECTION_EXPIRED,
      "expired",
      new Date("2026-07-01T00:00:00Z"),
    );
    expect(await providerRefusalAxis()).toMatchObject({
      status: "pass",
      reason: "no_provider_connection",
    });
  });

  it("returns the typed gateway conflict when more than one active connection matches", async () => {
    await createConnection(
      CONNECTION_ACTIVE,
      "active",
      new Date("2026-07-01T00:00:00Z"),
    );
    await createConnection(
      CONNECTION_ACTIVE_SECOND,
      "active",
      new Date("2026-07-02T00:00:00Z"),
    );

    await expect(
      customerInboxGateway.getConversationPreflight({
        conversationId: CONVERSATION_ASSIGNED,
      }),
    ).resolves.toEqual({ ok: false, error: "PROVIDER_CONNECTION_CONFLICT" });
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

describe("C4b-M3 needs_reply keyset pagination (ledger #359 item 21)", () => {
  it("returns exactly `limit` needs_reply conversations, most-recent-first, when more exist", async () => {
    const poolSize = 8;
    const requestedLimit = 5;
    const pool = Array.from({ length: poolSize }, (_, i) => ({
      identityId: `c4b-m3-test-identity-needs-reply-${i}`,
      conversationId: `c4b-m3-test-conversation-needs-reply-${i}`,
      messageId: `c4b-m3-test-message-needs-reply-${i}`,
      externalId: `+601998${String(i).padStart(6, "0")}`,
      // Strictly increasing, all more recent than the seeded conversations, so ranking
      // within the pool is unambiguous regardless of what else exists for ORG_A.
      activity: new Date(NOW.getTime() + (i + 1) * 1000),
    }));
    await prisma.contactIdentity.createMany({
      data: pool.map((p) => ({
        id: p.identityId,
        ownerId: ORG_A,
        contactId: CONTACT_A,
        channelScopeId: SCOPE_A,
        channel: "whatsapp",
        externalId: p.externalId,
      })),
    });
    await prisma.customerConversation.createMany({
      data: pool.map((p) => ({
        id: p.conversationId,
        ownerId: ORG_A,
        contactIdentityId: p.identityId,
        status: "open",
        revision: 0,
        lastMessageAt: p.activity,
        lastActivityAt: p.activity,
      })),
    });
    await prisma.customerMessage.createMany({
      data: pool.map((p) => ({
        id: p.messageId,
        ownerId: ORG_A,
        conversationId: p.conversationId,
        direction: "inbound",
        actorKind: "customer",
        kind: "text",
        contentJson: { schemaVersion: 1, type: "text", text: "Still waiting on a reply" },
        searchText: "Still waiting on a reply",
        contentHash: `needs-reply-content-${p.messageId}`,
        canonicalizationVersion: "v1",
        receivedAt: p.activity,
      })),
    });

    const results = await inbox.listConversations(owner, {
      view: "needs_reply",
      limit: requestedLimit,
    });
    expect(results).toHaveLength(requestedLimit);

    const expectedIds = [...pool]
      .sort((a, b) => b.activity.getTime() - a.activity.getTime())
      .slice(0, requestedLimit)
      .map((p) => p.conversationId);
    expect(results.map((row) => (row as { id: string }).id)).toEqual(expectedIds);
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
    // C1 control (U+0080-U+009F) and Unicode line separator (U+2028) must also be
    // rejected — ledger #359 item 24 extended CONTROL_CHARS past the old C0-only class.
    await expectCode(
      inbox.createMessageTemplate(owner, {
        channelScopeId: SCOPE_A,
        channel: "whatsapp",
        name: "bad\u0080name",
        locale: "en_MY",
      }),
      "INVALID_ARGUMENT",
    );
    await expectCode(
      inbox.createMessageTemplate(owner, {
        channelScopeId: SCOPE_A,
        channel: "whatsapp",
        name: "bad\u2028name",
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

// Wraps the real Prisma client so the first `membership.findFirst` call matching
// `membershipId` — the outer, pre-transaction read done by requireWriteMembership — is
// followed by a real, committed role change against Postgres, before that read's own
// promise resolves back to the caller. This reproduces "the caller was demoted between
// the outer check and the in-transaction recheck" deterministically (no timing race):
// the demotion is chained directly onto the intercepted call, so it is guaranteed to
// commit before the outer check returns and before the function reaches its
// `db.$transaction(...)` call. The transaction's own tx-scoped `activeMembership` read
// goes through Prisma's real transaction client, which this harness never touches, so it
// genuinely re-reads the now-demoted row from Postgres — this exercises real committed
// state, not a stub of the recheck logic under test.
//
// A pure-trigger approach (as used by the rollback test above) does not reach here:
// Postgres triggers fire on DML, not on SELECT, so there is no BEFORE-SELECT hook to fire
// the demotion exactly between the two reads. Racing a concurrent UPDATE against the
// few-microsecond gap between the two awaited reads would be non-deterministic. Chaining
// the demotion onto the intercepted call — a minimal, commented interception at the
// `db` seam the service already accepts as a constructor option — is the smallest change
// that keeps the timing exact while leaving every other query real.
function createRoleDemotionHarness(membershipId: string, demoteTo: string): typeof prisma {
  let intercepted = false;
  const membershipProxy = new Proxy(prisma.membership, {
    get(target, prop, receiver) {
      if (prop !== "findFirst") return Reflect.get(target, prop, receiver);
      return async (...args: unknown[]) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (target.findFirst as any)(...args);
        if (!intercepted && result?.id === membershipId) {
          intercepted = true;
          await prisma.$transaction([
            prisma.membership.update({
              where: { id: membershipId },
              data: { role: demoteTo },
            }),
            prisma.membershipRole.deleteMany({ where: { membershipId } }),
            prisma.membershipRole.create({ data: { membershipId, role: demoteTo } }),
          ]);
        }
        return result;
      };
    },
  });
  return new Proxy(prisma, {
    get(target, prop, receiver) {
      if (prop === "membership") return membershipProxy;
      const value = Reflect.get(target, prop, receiver);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return typeof value === "function" ? (value as any).bind(target) : value;
    },
  }) as typeof prisma;
}

describe("C4b-M3 transaction-time role recheck (ledger #359 item 25)", () => {
  it("denies createMessageTemplate when the caller is demoted to member between the outer check and the tx-scoped recheck", async () => {
    const demotingInbox = createCustomerInboxService({
      db: createRoleDemotionHarness(ADMIN, "member"),
      clock: () => NOW,
      id: () => `c4b-m3-test-generated-${++sequence}`,
    });
    await expectCode(
      demotingInbox.createMessageTemplate(admin, {
        channelScopeId: SCOPE_A,
        channel: "whatsapp",
        name: "demoted_admin_template",
        locale: "en_MY",
      }),
      "ACTION_DENIED",
    );
    await expect(
      prisma.membership.findFirstOrThrow({ where: { id: ADMIN } }),
    ).resolves.toMatchObject({ role: "member" });
    expect(
      await prisma.customerMessageTemplate.count({
        where: { ownerId: ORG_A, name: "demoted_admin_template" },
      }),
    ).toBe(0);
  });

  it("denies createMessageTemplateVersion when the caller is demoted to member between the outer check and the tx-scoped recheck", async () => {
    const demotingInbox = createCustomerInboxService({
      db: createRoleDemotionHarness(ADMIN, "member"),
      clock: () => NOW,
      id: () => `c4b-m3-test-generated-${++sequence}`,
    });
    await expectCode(
      demotingInbox.createMessageTemplateVersion(admin, {
        templateId: TEMPLATE_A,
        body: "Demoted admin body",
        variables: [],
      }),
      "ACTION_DENIED",
    );
    await expect(
      prisma.membership.findFirstOrThrow({ where: { id: ADMIN } }),
    ).resolves.toMatchObject({ role: "member" });
    expect(
      await prisma.customerMessageTemplateVersion.count({
        where: { ownerId: ORG_A, templateId: TEMPLATE_A, revision: { gt: 1 } },
      }),
    ).toBe(0);
  });

  it("denies requestAutomationResume when the caller is demoted to member between the outer check and the tx-scoped recheck", async () => {
    const demotingInbox = createCustomerInboxService({
      db: createRoleDemotionHarness(ADMIN, "member"),
      clock: () => NOW,
      id: () => `c4b-m3-test-generated-${++sequence}`,
    });
    await expectCode(
      demotingInbox.requestAutomationResume(admin, {
        conversationId: CONVERSATION_OWNER,
        expectedRevision: 0,
        note: "Demoted resume attempt",
      }),
      "ACTION_DENIED",
    );
    await expect(
      prisma.membership.findFirstOrThrow({ where: { id: ADMIN } }),
    ).resolves.toMatchObject({ role: "member" });
    await expect(
      prisma.customerConversation.findFirstOrThrow({
        where: { ownerId: ORG_A, id: CONVERSATION_OWNER },
      }),
    ).resolves.toMatchObject({ revision: 0 });
  });
});

describe("C5-M2 preflight four-axis wiring (ledger #386)", () => {
  it("reads the live evaluator instead of the c5_not_read_in_m2 placeholders, honest empty-state defaults", async () => {
    const preflight = await inbox.getConversationPreflight(owner, {
      conversationId: CONVERSATION_ASSIGNED,
    });
    for (const axis of [
      preflight.consentStop,
      preflight.doNotDisturb,
      preflight.providerRefusal,
      preflight.frequency,
    ]) {
      expect(axis.source).not.toBe("c5_not_read_in_m2");
    }
    // No consent/DND/refusal/frequency facts exist yet for CONTACT_A/IDENTITY_A: unknown
    // consent state reads risk for the human-membership preflight caller (§4.2.1), and the
    // other three axes are honestly empty (pass).
    expect(preflight.consentStop).toMatchObject({ status: "risk", source: "consent_state_projection" });
    expect(preflight.doNotDisturb).toMatchObject({ status: "pass", source: "contact_dnd_fold" });
    expect(preflight.providerRefusal).toMatchObject({ status: "pass", source: "provider_refusal_state" });
    expect(preflight.frequency).toMatchObject({ status: "pass", source: "send_frequency_counter" });
    // C5 lighting the four axes never lights the send path itself (§7).
    expect(preflight.sendEligibility).toEqual({ status: "unavailable", reason: "SEND_PATH_UNAVAILABLE" });
  });

  it("reflects a DND block on the doNotDisturb axis", async () => {
    await recordContactDndEvent({
      ownerId: ORG_A,
      contactId: CONTACT_A,
      sourceKind: "crm_ui",
      action: "set",
      idempotencyKey: "c5-m2-preflight-test-dnd-set",
    });
    const preflight = await inbox.getConversationPreflight(owner, {
      conversationId: CONVERSATION_ASSIGNED,
    });
    expect(preflight.doNotDisturb).toMatchObject({ status: "block", reason: "dnd_set" });
  });

  it("reflects an effective_revoke consent block on the consentStop axis", async () => {
    await recordConsentEvent({
      ownerId: ORG_A,
      contactId: CONTACT_A,
      channel: "whatsapp",
      purpose: "marketing",
      sourceKind: "unsubscribe_link",
      action: "revoke",
      evidenceRef: "evidence:c5-m2-preflight-test",
      idempotencyKey: "c5-m2-preflight-test-consent-revoke",
    });
    const preflight = await inbox.getConversationPreflight(owner, {
      conversationId: CONVERSATION_ASSIGNED,
    });
    expect(preflight.consentStop).toMatchObject({ status: "block", reason: "effective_revoke" });
  });

  it("reflects a frequency-cap block on the frequency axis once the rolling window is spent", async () => {
    await recordSendFrequencyEvent({
      ownerId: ORG_A,
      contactId: CONTACT_A,
      channel: "whatsapp",
      purposeClass: "proactive_non_transactional",
      sourceKind: "conversation_reply",
      sendRef: "c5-m2-preflight-test-send-1",
      simulated: true,
      idempotencyKey: "freq:conv:c4b-m2-test-org-a:c5-m2-preflight-test-send-1",
    });
    const preflight = await inbox.getConversationPreflight(owner, {
      conversationId: CONVERSATION_ASSIGNED,
    });
    expect(preflight.frequency).toMatchObject({ status: "block", reason: "frequency_cap_reached" });
  });
});
