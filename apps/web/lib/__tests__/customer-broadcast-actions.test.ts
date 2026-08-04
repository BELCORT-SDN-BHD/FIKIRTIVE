import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  prisma,
  recordProviderRefusalEvent,
  recordUnqualifiedStop,
  type Prisma,
} from "@fikirtive/db";
import * as customerBroadcastGateway from "../customer-broadcast-gateway";
import { createCustomerBroadcastService } from "../customer-broadcast-service";
import { createMemberDirectoryService } from "../member-directory-service";
import { requireOwner } from "../auth-guard";

vi.mock("../auth-guard", () => ({
  requireOwner: vi.fn(async () => ({
    email: "c5-m2-owner@example.test",
    ownerId: "c5-m2-test-org-a",
  })),
}));
vi.mock("../better-auth/compat", () => ({
  isImpersonating: vi.fn(async () => false),
}));

const ORG_A = "c5-m2-test-org-a";
const ORG_B = "c5-m2-test-org-b";
const USER_OWNER = "c5-m2-test-user-owner";
const USER_ADMIN = "c5-m2-test-user-admin";
const USER_MEMBER = "c5-m2-test-user-member";
const USER_B = "c5-m2-test-user-b";
const OWNER = "c5-m2-test-owner";
const ADMIN = "c5-m2-test-admin";
const MEMBER = "c5-m2-test-member";
const MEMBER_B = "c5-m2-test-member-b";
const CONTACT_A = "c5-m2-test-contact-a";
const CONTACT_A_OPTOUT = "c5-m2-test-contact-a-optout";
const CONTACT_GRANT = "c5-m2-test-contact-grant";
const CONTACT_B = "c5-m2-test-contact-b";
const SCOPE_A = "c5-m2-test-scope-a";
const SCOPE_A_OTHER = "c5-m2-test-scope-a-other";
const SCOPE_B = "c5-m2-test-scope-b";
const IDENTITY_A = "c5-m2-test-identity-a";
const IDENTITY_A_OPTOUT = "c5-m2-test-identity-a-optout";
const IDENTITY_GRANT = "c5-m2-test-identity-grant";
const IDENTITY_B = "c5-m2-test-identity-b";
const SEGMENT_A = "c5-m2-test-segment-a";
const SEGMENT_B = "c5-m2-test-segment-b";
const CAMPAIGN_B = "c5-m2-test-campaign-b";
const TEMPLATE_A = "c5-m2-test-template-a";
const TEMPLATE_A_ALT = "c5-m2-test-template-a-alt";
const TEMPLATE_A_UNMAPPABLE = "c5-m2-test-template-a-unmappable";
const TEMPLATE_A_OTHER_SCOPE = "c5-m2-test-template-a-other-scope";
const TEMPLATE_B = "c5-m2-test-template-b";
const TEMPLATE_VERSION_A = "c5-m2-test-template-version-a";
const TEMPLATE_VERSION_A_ALT = "c5-m2-test-template-version-a-alt";
const TEMPLATE_VERSION_A_UNMAPPABLE = "c5-m2-test-template-version-a-unmappable";
const TEMPLATE_VERSION_A_OTHER_SCOPE = "c5-m2-test-template-version-a-other-scope";
const TEMPLATE_VERSION_B = "c5-m2-test-template-version-b";
const CONNECTION_STALE = "c5-m2-test-connection-stale";
const CONNECTION_ACTIVE = "c5-m2-test-connection-active";
const CONNECTION_ACTIVE_SECOND = "c5-m2-test-connection-active-second";
const NOW = new Date("2026-07-21T08:00:00.000Z");
const OWNERS = [ORG_A, ORG_B];

let sequence = 0;
let broadcast = createCustomerBroadcastService({
  clock: () => NOW,
  id: () => `c5-m2-test-generated-${++sequence}`,
});

const owner = { ownerId: ORG_A, membershipId: OWNER, impersonating: false };
const admin = { ownerId: ORG_A, membershipId: ADMIN, impersonating: false };
const member = { ownerId: ORG_A, membershipId: MEMBER, impersonating: false };

const ALL_WHATSAPP_SEGMENT = {
  match: "all",
  rules: [
    { kind: "channel", channel: "whatsapp" },
    { kind: "contactability", value: "contactable" },
  ],
};

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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

type DbMethodHook = (
  invoke: () => Promise<unknown>,
  args: unknown[],
) => Promise<unknown>;

function proxyDatabaseDelegates(
  client: Prisma.TransactionClient | typeof prisma,
  hooks: Record<string, DbMethodHook>,
): Prisma.TransactionClient | typeof prisma {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (typeof prop === "string") {
        const matchingHooks = Object.entries(hooks).filter(([key]) =>
          key.startsWith(`${prop}.`),
        );
        if (matchingHooks.length > 0) {
          const delegate = Reflect.get(target, prop, receiver) as object;
          return new Proxy(delegate, {
            get(delegateTarget, delegateProp, delegateReceiver) {
              const value = Reflect.get(delegateTarget, delegateProp, delegateReceiver);
              const hook = hooks[`${prop}.${String(delegateProp)}`];
              if (hook && typeof value === "function") {
                return (...args: unknown[]) =>
                  hook(
                    () => Reflect.apply(value, delegateTarget, args) as Promise<unknown>,
                    args,
                  );
              }
              return typeof value === "function" ? value.bind(delegateTarget) : value;
            },
          });
        }
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function createHookedBroadcastDb(hooks: Record<string, DbMethodHook>): typeof prisma {
  const directClient = proxyDatabaseDelegates(prisma, hooks);
  return new Proxy(directClient, {
    get(target, prop, receiver) {
      if (prop === "$transaction") {
        return async <T>(
          callback: (tx: Prisma.TransactionClient) => Promise<T>,
        ): Promise<T> =>
          prisma.$transaction((tx) =>
            callback(
              proxyDatabaseDelegates(tx, hooks) as Prisma.TransactionClient,
            ),
          );
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as typeof prisma;
}

function createBroadcastRunP2002RaceDb(creationIdempotencyKey: string) {
  const bothInitialReadsFinished = deferred<void>();
  let initialReadCount = 0;
  let p2002Count = 0;
  const db = createHookedBroadcastDb({
    "broadcastRun.findFirst": async (invoke, args) => {
      const result = await invoke();
      const where = (
        args[0] as { where?: { creationIdempotencyKey?: string } } | undefined
      )?.where;
      if (
        where?.creationIdempotencyKey === creationIdempotencyKey &&
        result === null &&
        initialReadCount < 2
      ) {
        initialReadCount += 1;
        if (initialReadCount === 2) bothInitialReadsFinished.resolve();
        await bothInitialReadsFinished.promise;
      }
      return result;
    },
  });
  const countedDb = new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "$transaction") {
        const transaction = Reflect.get(target, prop, receiver) as (
          callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
        ) => Promise<unknown>;
        return async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
          try {
            return await transaction(callback);
          } catch (error) {
            if (errorCode(error) === "P2002") p2002Count += 1;
            throw error;
          }
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as typeof prisma;
  return { db: countedDb, p2002Count: () => p2002Count };
}

async function cleanup(): Promise<void> {
  await prisma.broadcastAudienceMember.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.broadcastRun.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.contactSendFrequencyEvent.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.providerRefusalState.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.providerRefusalEvent.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.consentStateProjection.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.consentEvent.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.customerMessageTemplateVersion.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.customerMessageTemplate.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.campaign.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.segment.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.contactIdentity.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.channelConnection.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.channelScope.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.contact.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.membership.deleteMany({ where: { orgId: { in: OWNERS } } });
  await prisma.organization.deleteMany({ where: { id: { in: OWNERS } } });
  await prisma.user.deleteMany({ where: { id: { in: [USER_OWNER, USER_ADMIN, USER_MEMBER, USER_B] } } });
}

async function seed(): Promise<void> {
  await prisma.organization.createMany({ data: [{ id: ORG_A }, { id: ORG_B }] });
  await prisma.user.createMany({
    data: [
      { id: USER_OWNER, email: "c5-m2-owner@example.test" },
      { id: USER_ADMIN, email: "c5-m2-admin@example.test" },
      { id: USER_MEMBER, email: "c5-m2-member@example.test" },
      { id: USER_B, email: "c5-m2-b@example.test" },
    ],
  });
  await prisma.membership.createMany({
    data: [
      { id: OWNER, userId: USER_OWNER, orgId: ORG_A, role: "owner" },
      { id: ADMIN, userId: USER_ADMIN, orgId: ORG_A, role: "admin" },
      { id: MEMBER, userId: USER_MEMBER, orgId: ORG_A, role: "member" },
      { id: MEMBER_B, userId: USER_B, orgId: ORG_B, role: "owner" },
    ],
  });
  await prisma.membershipRole.createMany({
    data: [
      { membershipId: OWNER, role: "owner" },
      { membershipId: ADMIN, role: "admin" },
      { membershipId: MEMBER, role: "member" },
      { membershipId: MEMBER_B, role: "owner" },
    ],
  });
  await prisma.contact.createMany({
    data: [
      { id: CONTACT_A, ownerId: ORG_A, name: "Aisyah", source: "whatsapp", firstTouchAt: NOW, lastSeenAt: NOW },
      {
        id: CONTACT_A_OPTOUT,
        ownerId: ORG_A,
        name: "Bakri",
        source: "whatsapp",
        firstTouchAt: NOW,
        lastSeenAt: NOW,
        // Legacy column kept opt_out ON PURPOSE: ledger #35 proves the estimate no longer reads
        // it. The exclusion below is now sourced from the effective_revoke ConsentStateProjection.
        marketingConsent: "opt_out",
      },
      {
        // Fully eligible: verified_grant consent (below), no DND, no provider refusal, whatsapp
        // (a channel with a frequency policy). A simulated run marks this contact simulated_sent.
        id: CONTACT_GRANT,
        ownerId: ORG_A,
        name: "Chandra",
        source: "whatsapp",
        firstTouchAt: NOW,
        lastSeenAt: NOW,
      },
      { id: CONTACT_B, ownerId: ORG_B, name: "Mei", source: "whatsapp", firstTouchAt: NOW, lastSeenAt: NOW },
    ],
  });
  await prisma.channelScope.createMany({
    data: [
      { id: SCOPE_A, ownerId: ORG_A, channel: "whatsapp", scopeKey: "waba-a" },
      { id: SCOPE_A_OTHER, ownerId: ORG_A, channel: "whatsapp", scopeKey: "waba-a-other" },
      { id: SCOPE_B, ownerId: ORG_B, channel: "whatsapp", scopeKey: "waba-b" },
    ],
  });
  await prisma.customerMessageTemplate.createMany({
    data: [
      { id: TEMPLATE_A, ownerId: ORG_A, channelScopeId: SCOPE_A, channel: "whatsapp", name: "offer_a", locale: "en_MY" },
      { id: TEMPLATE_A_ALT, ownerId: ORG_A, channelScopeId: SCOPE_A, channel: "whatsapp", name: "offer_a_alt", locale: "en_MY" },
      { id: TEMPLATE_A_UNMAPPABLE, ownerId: ORG_A, channelScopeId: SCOPE_A, channel: "whatsapp", name: "utility_a", locale: "en_MY" },
      { id: TEMPLATE_A_OTHER_SCOPE, ownerId: ORG_A, channelScopeId: SCOPE_A_OTHER, channel: "whatsapp", name: "offer_a_other_scope", locale: "en_MY" },
      { id: TEMPLATE_B, ownerId: ORG_B, channelScopeId: SCOPE_B, channel: "whatsapp", name: "offer_b", locale: "en_MY" },
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
        definitionJson: { schemaVersion: 1, body: "Offer A", variables: [] },
        contentHash: "template-a",
        createdByMembershipId: OWNER,
      },
      {
        id: TEMPLATE_VERSION_A_ALT,
        ownerId: ORG_A,
        templateId: TEMPLATE_A_ALT,
        revision: 1,
        purposeClass: "proactive_non_transactional",
        category: "marketing",
        definitionJson: { schemaVersion: 1, body: "Offer A alt", variables: [] },
        contentHash: "template-a-alt",
        createdByMembershipId: OWNER,
      },
      {
        id: TEMPLATE_VERSION_A_UNMAPPABLE,
        ownerId: ORG_A,
        templateId: TEMPLATE_A_UNMAPPABLE,
        revision: 1,
        purposeClass: "transactional",
        category: "utility",
        definitionJson: { schemaVersion: 1, body: "Utility A", variables: [] },
        contentHash: "template-a-unmappable",
        createdByMembershipId: OWNER,
      },
      {
        id: TEMPLATE_VERSION_A_OTHER_SCOPE,
        ownerId: ORG_A,
        templateId: TEMPLATE_A_OTHER_SCOPE,
        revision: 1,
        purposeClass: "proactive_non_transactional",
        category: "marketing",
        definitionJson: { schemaVersion: 1, body: "Offer A other scope", variables: [] },
        contentHash: "template-a-other-scope",
        createdByMembershipId: OWNER,
      },
      {
        id: TEMPLATE_VERSION_B,
        ownerId: ORG_B,
        templateId: TEMPLATE_B,
        revision: 1,
        purposeClass: "proactive_non_transactional",
        category: "marketing",
        definitionJson: { schemaVersion: 1, body: "Offer B", variables: [] },
        contentHash: "template-b",
        createdByMembershipId: MEMBER_B,
      },
    ],
  });
  await prisma.contactIdentity.createMany({
    data: [
      { id: IDENTITY_A, ownerId: ORG_A, contactId: CONTACT_A, channelScopeId: SCOPE_A, channel: "whatsapp", externalId: "+60111111111" },
      { id: IDENTITY_A_OPTOUT, ownerId: ORG_A, contactId: CONTACT_A_OPTOUT, channelScopeId: SCOPE_A, channel: "whatsapp", externalId: "+60111111112" },
      { id: IDENTITY_GRANT, ownerId: ORG_A, contactId: CONTACT_GRANT, channelScopeId: SCOPE_A, channel: "whatsapp", externalId: "+60111111113" },
      { id: IDENTITY_B, ownerId: ORG_B, contactId: CONTACT_B, channelScopeId: SCOPE_B, channel: "whatsapp", externalId: "+60222222222" },
    ],
  });
  // Consent authority (R-010). ledger #35: the audience estimate reads THESE projections, not
  // Contact.marketingConsent. CONTACT_A has no projection (unknown → kept + flagged).
  await prisma.consentStateProjection.createMany({
    data: [
      {
        ownerId: ORG_A,
        contactId: CONTACT_A_OPTOUT,
        channel: "whatsapp",
        purpose: "marketing",
        state: "effective_revoke",
        lastEventId: "c5-m2-test-proj-optout-event",
        lastReceivedAt: NOW,
        stateActorKind: "customer",
        stateSourceKind: "explicit_inbox_optout",
        evidenceStatus: "verified",
      },
      {
        ownerId: ORG_A,
        contactId: CONTACT_GRANT,
        channel: "whatsapp",
        purpose: "marketing",
        state: "verified_grant",
        lastEventId: "c5-m2-test-proj-grant-event",
        lastReceivedAt: NOW,
        stateActorKind: "customer",
        stateSourceKind: "explicit_inbox_optin",
        evidenceStatus: "verified",
      },
    ],
  });
  await prisma.segment.createMany({
    data: [
      { id: SEGMENT_A, ownerId: ORG_A, name: "All WhatsApp", phrase: "channel is whatsapp", rulesJson: ALL_WHATSAPP_SEGMENT, kind: "custom", createdAt: NOW },
      { id: SEGMENT_B, ownerId: ORG_B, name: "All WhatsApp B", phrase: "channel is whatsapp", rulesJson: ALL_WHATSAPP_SEGMENT, kind: "custom", createdAt: NOW },
    ],
  });
  await prisma.campaign.createMany({
    data: [
      {
        id: CAMPAIGN_B,
        ownerId: ORG_B,
        name: "Foreign campaign",
        status: "ACTIVE",
        goal: "awareness",
        startAt: NOW,
        endAt: NOW,
        planJson: {},
      },
    ],
  });
}

async function ownerCounts(ownerId = ORG_A) {
  const [runs, members] = await Promise.all([
    prisma.broadcastRun.count({ where: { ownerId } }),
    prisma.broadcastAudienceMember.count({ where: { ownerId } }),
  ]);
  return { runs, members };
}

/** create -> freeze(SEGMENT_A) -> confirm; returns the confirmed run id + its current revision. */
async function createFrozenConfirmedRun(key: string, segmentId = SEGMENT_A) {
  const created = await broadcast.createBroadcastRun(owner, {
    channelScopeId: SCOPE_A,
    channel: "whatsapp",
    templateVersionId: TEMPLATE_VERSION_A,
    creationIdempotencyKey: key,
  });
  const frozen = await broadcast.freezeAudience(owner, {
    broadcastRunId: created.resource.id,
    expectedRevision: 0,
    segmentId,
  });
  const confirmed = await broadcast.confirmBroadcastRun(owner, {
    broadcastRunId: created.resource.id,
    expectedRevision: frozen.resource.revision,
  });
  return { id: created.resource.id, revision: confirmed.resource.revision };
}

const freqCount = (contactId: string, ownerId = ORG_A) =>
  prisma.contactSendFrequencyEvent.count({ where: { ownerId, contactId } });

beforeEach(async () => {
  await cleanup();
  await seed();
  sequence = 0;
  vi.clearAllMocks();
  broadcast = createCustomerBroadcastService({
    clock: () => NOW,
    id: () => `c5-m2-test-generated-${++sequence}`,
  });
});

afterAll(cleanup);

describe("C5-M2 createBroadcastRun", () => {
  it("creates a draft run for an owner and is idempotent on a double-click with the same payload", async () => {
    const input = {
      channelScopeId: SCOPE_A,
      channel: "whatsapp",
      templateVersionId: TEMPLATE_VERSION_A,
      creationIdempotencyKey: "c5-m2-test-create-key-1",
    };
    const first = await broadcast.createBroadcastRun(owner, input);
    expect(first.duplicate).toBe(false);
    expect(first.resource).toMatchObject({ status: "draft", audienceRevision: 0, revision: 0 });

    const creationIdempotencyKey = "c5-m2-test-create-key-2";
    const race = createBroadcastRunP2002RaceDb(creationIdempotencyKey);
    const racingBroadcast = createCustomerBroadcastService({
      db: race.db,
      clock: () => NOW,
      id: () => `c5-m2-test-generated-${++sequence}`,
    });
    const settled = await Promise.allSettled([
      racingBroadcast.createBroadcastRun(owner, { ...input, creationIdempotencyKey }),
      racingBroadcast.createBroadcastRun(owner, { ...input, creationIdempotencyKey }),
    ]);
    expect(race.p2002Count()).toBe(1);
    expect(settled.every((r) => r.status === "fulfilled")).toBe(true);
    const fulfilled = settled.map((result) => {
      if (result.status !== "fulfilled") throw result.reason;
      return result.value;
    });
    expect(fulfilled.map((result) => result.duplicate).sort()).toEqual([false, true]);
    expect(new Set(fulfilled.map((result) => result.resource.id)).size).toBe(1);
    expect(fulfilled[0]!.resource).toMatchObject({
      ownerId: ORG_A,
      channelScopeId: SCOPE_A,
      channel: "whatsapp",
      templateVersionId: TEMPLATE_VERSION_A,
      purpose: "marketing",
    });
    expect(await ownerCounts()).toEqual({ runs: 2, members: 0 });
  });

  it("unwinds a genuine concurrent P2002 and returns IDEMPOTENCY_CONFLICT for a different payload", async () => {
    const key = "c5-m2-test-conflict-key";
    const race = createBroadcastRunP2002RaceDb(key);
    const racingBroadcast = createCustomerBroadcastService({
      db: race.db,
      clock: () => NOW,
      id: () => `c5-m2-test-generated-${++sequence}`,
    });
    const inputs = [
      {
        channelScopeId: SCOPE_A,
        channel: "whatsapp",
        templateVersionId: TEMPLATE_VERSION_A,
        creationIdempotencyKey: key,
      },
      {
        channelScopeId: SCOPE_A,
        channel: "whatsapp",
        templateVersionId: TEMPLATE_VERSION_A_ALT,
        creationIdempotencyKey: key,
      },
    ];
    const settled = await Promise.allSettled(
      inputs.map((input) => racingBroadcast.createBroadcastRun(owner, input)),
    );
    expect(race.p2002Count()).toBe(1);
    const fulfilledIndexes = settled.flatMap((result, index) =>
      result.status === "fulfilled" ? [index] : [],
    );
    const rejected = settled.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(fulfilledIndexes).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(errorCode(rejected[0]!.reason)).toBe("IDEMPOTENCY_CONFLICT");
    const winner = await prisma.broadcastRun.findFirstOrThrow({
      where: { ownerId: ORG_A, creationIdempotencyKey: key },
    });
    expect(winner.templateVersionId).toBe(inputs[fulfilledIndexes[0]!]!.templateVersionId);
    expect(await prisma.broadcastRun.count({ where: { ownerId: ORG_A, creationIdempotencyKey: key } })).toBe(1);
  });

  it("rejects a foreign campaignId/templateVersionId as RESOURCE_NOT_FOUND, zero writes", async () => {
    const before = await ownerCounts();
    await expectCode(
      broadcast.createBroadcastRun(owner, {
        channelScopeId: SCOPE_A,
        channel: "whatsapp",
        templateVersionId: TEMPLATE_VERSION_A,
        campaignId: CAMPAIGN_B,
        creationIdempotencyKey: "c5-m2-test-foreign-campaign",
      }),
      "RESOURCE_NOT_FOUND",
    );
    await expectCode(
      broadcast.createBroadcastRun(owner, {
        channelScopeId: SCOPE_A,
        channel: "whatsapp",
        templateVersionId: TEMPLATE_VERSION_B,
        creationIdempotencyKey: "c5-m2-test-foreign-template",
      }),
      "RESOURCE_NOT_FOUND",
    );
    expect(await ownerCounts()).toEqual(before);
  });

  it("denies admin and member (owner-only mutation, §14.2 default deny)", async () => {
    for (const principal of [admin, member]) {
      await expectCode(
        broadcast.createBroadcastRun(principal, {
          channelScopeId: SCOPE_A,
          channel: "whatsapp",
          templateVersionId: TEMPLATE_VERSION_A,
          creationIdempotencyKey: `c5-m2-test-rbac-${principal.membershipId}`,
        }),
        "ACTION_DENIED",
      );
    }
  });

  it("rejects forged client purpose on create and preview", async () => {
    const forgedCreate = {
      channelScopeId: SCOPE_A,
      channel: "whatsapp",
      templateVersionId: TEMPLATE_VERSION_A,
      creationIdempotencyKey: "c5-m2-test-forged-create",
      purpose: "review_request",
    };
    await expectCode(broadcast.createBroadcastRun(owner, forgedCreate as never), "INVALID_ARGUMENT");
    const forgedPreview = {
      segmentId: SEGMENT_A,
      channelScopeId: SCOPE_A,
      channel: "whatsapp",
      templateVersionId: TEMPLATE_VERSION_A,
      purpose: "review_request",
    };
    await expectCode(
      broadcast.previewAudienceEligibility(owner, forgedPreview as never),
      "INVALID_ARGUMENT",
    );
    expect(await ownerCounts()).toEqual({ runs: 0, members: 0 });
  });

  it("derives the same purpose from the template for preview and create", async () => {
    const preview = await broadcast.previewAudienceEligibility(owner, {
      segmentId: SEGMENT_A,
      channelScopeId: SCOPE_A,
      channel: "whatsapp",
      templateVersionId: TEMPLATE_VERSION_A,
    });
    const created = await broadcast.createBroadcastRun(owner, {
      channelScopeId: SCOPE_A,
      channel: "whatsapp",
      templateVersionId: TEMPLATE_VERSION_A,
      creationIdempotencyKey: "c5-m2-test-derived-purpose",
    });
    expect(preview.purpose).toBe("marketing");
    expect(created.resource.purpose).toBe(preview.purpose);
  });

  it("fails closed on an unmappable template classification for create and preview", async () => {
    await expectCode(
      broadcast.createBroadcastRun(owner, {
        channelScopeId: SCOPE_A,
        channel: "whatsapp",
        templateVersionId: TEMPLATE_VERSION_A_UNMAPPABLE,
        creationIdempotencyKey: "c5-m2-test-unmappable",
      }),
      "TEMPLATE_CLASSIFICATION_UNSUPPORTED",
    );
    await expectCode(
      broadcast.previewAudienceEligibility(owner, {
        segmentId: SEGMENT_A,
        channelScopeId: SCOPE_A,
        channel: "whatsapp",
        templateVersionId: TEMPLATE_VERSION_A_UNMAPPABLE,
      }),
      "TEMPLATE_CLASSIFICATION_UNSUPPORTED",
    );
    expect(await ownerCounts()).toEqual({ runs: 0, members: 0 });
  });

  it("fails closed when the template belongs to another channel scope", async () => {
    await expectCode(
      broadcast.createBroadcastRun(owner, {
        channelScopeId: SCOPE_A,
        channel: "whatsapp",
        templateVersionId: TEMPLATE_VERSION_A_OTHER_SCOPE,
        creationIdempotencyKey: "c5-m2-test-template-scope",
      }),
      "TEMPLATE_CHANNEL_MISMATCH",
    );
    await expectCode(
      broadcast.previewAudienceEligibility(owner, {
        segmentId: SEGMENT_A,
        channelScopeId: SCOPE_A,
        channel: "whatsapp",
        templateVersionId: TEMPLATE_VERSION_A_OTHER_SCOPE,
      }),
      "TEMPLATE_CHANNEL_MISMATCH",
    );
    expect(await ownerCounts()).toEqual({ runs: 0, members: 0 });
  });
});

describe("C5-M2 provider-connection resolution", () => {
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

  async function previewGrantedProviderAxis() {
    const preview = await broadcast.previewAudienceEligibility(owner, {
      segmentId: SEGMENT_A,
      channelScopeId: SCOPE_A,
      channel: "whatsapp",
      templateVersionId: TEMPLATE_VERSION_A,
    });
    return preview.members.find((row) => row.contactIdentityId === IDENTITY_GRANT)!
      .verdict.providerRefusal;
  }

  it("ignores an expired oldest connection and blocks on the one active connection's refusal", async () => {
    await createConnection(CONNECTION_STALE, "expired", new Date("2026-07-01T00:00:00Z"));
    await createConnection(CONNECTION_ACTIVE, "active", new Date("2026-07-02T00:00:00Z"));
    await recordProviderRefusalEvent({
      ownerId: ORG_A,
      providerConnectionId: CONNECTION_ACTIVE,
      kind: "account_level",
      action: "block",
      providerCode: "account_suspended",
      receiptRef: "receipt:c5-active-block",
      idempotencyKey: "c5-provider-active-block",
    });

    expect(await previewGrantedProviderAxis()).toMatchObject({
      status: "block",
      reason: "account_level_block",
    });
  });

  it("does not adopt an expired oldest connection's refusal when the sole active connection is clear", async () => {
    await createConnection(CONNECTION_STALE, "expired", new Date("2026-07-01T00:00:00Z"));
    await createConnection(CONNECTION_ACTIVE, "active", new Date("2026-07-02T00:00:00Z"));
    await recordProviderRefusalEvent({
      ownerId: ORG_A,
      providerConnectionId: CONNECTION_STALE,
      kind: "account_level",
      action: "block",
      providerCode: "account_suspended",
      receiptRef: "receipt:c5-stale-block",
      idempotencyKey: "c5-provider-stale-block",
    });

    expect(await previewGrantedProviderAxis()).toMatchObject({ status: "pass" });
  });

  it("fails closed with a distinct typed conflict when more than one active connection matches", async () => {
    await createConnection(CONNECTION_ACTIVE, "active", new Date("2026-07-01T00:00:00Z"));
    await createConnection(
      CONNECTION_ACTIVE_SECOND,
      "active",
      new Date("2026-07-02T00:00:00Z"),
    );

    await expectCode(
      broadcast.previewAudienceEligibility(owner, {
        segmentId: SEGMENT_A,
        channelScopeId: SCOPE_A,
        channel: "whatsapp",
        templateVersionId: TEMPLATE_VERSION_A,
      }),
      "PROVIDER_CONNECTION_CONFLICT",
    );
  });

  it("preserves the existing no-connection refusal-axis shape when zero active connections match", async () => {
    await createConnection(CONNECTION_STALE, "expired", new Date("2026-07-01T00:00:00Z"));
    expect(await previewGrantedProviderAxis()).toMatchObject({
      status: "pass",
      reason: "no_provider_connection",
    });
  });
});

describe("C5-M2 freezeAudience — unknown consent stays in audience, never culled", () => {
  it("includes both an unknown-consent contact and a known-opt-out-excluded-by-segment contact honestly", async () => {
    const run = await broadcast.createBroadcastRun(owner, {
      channelScopeId: SCOPE_A,
      channel: "whatsapp",
      templateVersionId: TEMPLATE_VERSION_A,
      creationIdempotencyKey: "c5-m2-test-freeze-1",
    });
    const frozen = await broadcast.freezeAudience(owner, {
      broadcastRunId: run.resource.id,
      expectedRevision: 0,
      segmentId: SEGMENT_A,
    });
    expect(frozen.resource).toMatchObject({ status: "audience_frozen", audienceRevision: 1, revision: 1 });
    const memberIds = frozen.members.map((m) => m.contactIdentityId);
    // CONTACT_A has unknown marketingConsent (default) — it must stay in the audience,
    // flagged via the verdict (risk/block), never silently excluded (B0-44/§3.2).
    expect(memberIds).toContain(IDENTITY_A);
    const unknownMember = frozen.members.find((m) => m.contactIdentityId === IDENTITY_A)!;
    expect(unknownMember.includedByMerchant).toBe(true);
    expect((unknownMember.eligibilityVerdictJson as { consentStop: { status: string } }).consentStop.status).toBe(
      "risk",
    );
    // CONTACT_A_OPTOUT is a known opt-out, excluded by the SEGMENT's own contactability
    // estimate (not by the eligibility axis) — segment-level filtering is a separate,
    // documented concern from axis-level "unknown stays included".
    expect(memberIds).not.toContain(IDENTITY_A_OPTOUT);
  });

  it("re-freezing bumps audienceRevision and refreshes every member's verdict", async () => {
    const run = await broadcast.createBroadcastRun(owner, {
      channelScopeId: SCOPE_A,
      channel: "whatsapp",
      templateVersionId: TEMPLATE_VERSION_A,
      creationIdempotencyKey: "c5-m2-test-refreeze",
    });
    const first = await broadcast.freezeAudience(owner, {
      broadcastRunId: run.resource.id,
      expectedRevision: 0,
      segmentId: SEGMENT_A,
    });
    const second = await broadcast.freezeAudience(owner, {
      broadcastRunId: run.resource.id,
      expectedRevision: first.resource.revision,
      segmentId: SEGMENT_A,
    });
    expect(second.resource.audienceRevision).toBe(2);
    expect(second.resource.revision).toBe(2);
    // Re-freezing must not create a second row per identity (upsert, not insert-again).
    expect(await prisma.broadcastAudienceMember.count({ where: { ownerId: ORG_A, broadcastRunId: run.resource.id } })).toBe(
      second.members.length,
    );
  });

  it("wrong expectedRevision -> CAS_CONFLICT, zero writes", async () => {
    const run = await broadcast.createBroadcastRun(owner, {
      channelScopeId: SCOPE_A,
      channel: "whatsapp",
      templateVersionId: TEMPLATE_VERSION_A,
      creationIdempotencyKey: "c5-m2-test-freeze-cas",
    });
    const before = await ownerCounts();
    await expectCode(
      broadcast.freezeAudience(owner, { broadcastRunId: run.resource.id, expectedRevision: 99, segmentId: SEGMENT_A }),
      "CAS_CONFLICT",
    );
    expect(await ownerCounts()).toEqual(before);
  });
});

describe("C5-M2 frozen snapshot is display/audit-only, never live authority", () => {
  it("a frozen PASS verdict does not update itself when consent later flips (proves execution MUST re-read, not trust the snapshot)", async () => {
    await prisma.consentEvent.create({
      data: {
        id: "c5-m2-test-consent-event-1",
        ownerId: ORG_A,
        contactId: CONTACT_A,
        channel: "whatsapp",
        purpose: "marketing",
        action: "grant",
        actorKind: "customer",
        entryMode: "interactive",
        sourceKind: "explicit_inbox_optin",
        evidenceStatus: "verified",
        evidenceRef: "evidence:frozen-test",
        operationId: "c5-m2-test-consent-op-1",
        idempotencyKey: "c5-m2-test-consent-idem-1",
        receivedAt: NOW,
      },
    });
    await prisma.consentStateProjection.create({
      data: {
        ownerId: ORG_A,
        contactId: CONTACT_A,
        channel: "whatsapp",
        purpose: "marketing",
        state: "verified_grant",
        lastEventId: "c5-m2-test-consent-event-1",
        lastReceivedAt: NOW,
        stateActorKind: "customer",
        stateSourceKind: "explicit_inbox_optin",
        evidenceStatus: "verified",
      },
    });

    const run = await broadcast.createBroadcastRun(owner, {
      channelScopeId: SCOPE_A,
      channel: "whatsapp",
      templateVersionId: TEMPLATE_VERSION_A,
      creationIdempotencyKey: "c5-m2-test-frozen-snapshot",
    });
    const frozen = await broadcast.freezeAudience(owner, {
      broadcastRunId: run.resource.id,
      expectedRevision: 0,
      segmentId: SEGMENT_A,
    });
    const frozenMember = frozen.members.find((m) => m.contactIdentityId === IDENTITY_A)!;
    expect((frozenMember.eligibilityVerdictJson as { consentStop: { status: string } }).consentStop.status).toBe(
      "pass",
    );

    // Consent flips to effective_revoke AFTER the freeze.
    await prisma.consentStateProjection.update({
      where: { ownerId: ORG_A, ownerId_contactId_channel_purpose: { ownerId: ORG_A, contactId: CONTACT_A, channel: "whatsapp", purpose: "marketing" } },
      data: { state: "effective_revoke" },
    });

    // The FROZEN row is untouched (point-in-time snapshot, display/audit only — §5.3).
    const stillFrozen = await broadcast.getBroadcastRun(owner, { broadcastRunId: run.resource.id });
    const staleMember = stillFrozen.members.find((m) => m.contactIdentityId === IDENTITY_A)!;
    expect((staleMember.eligibilityVerdictJson as { consentStop: { status: string } }).consentStop.status).toBe(
      "pass",
    );
    // The live preflight re-evaluates the SAME frozen member against live authority (exactly what
    // execution does) and correctly reflects the flip to block — while the frozen snapshot above
    // stays pass. This is the frozen-vs-live divergence the workbench surfaces as "stale".
    const livePreflight = await broadcast.getBroadcastRunLivePreflight(owner, { broadcastRunId: run.resource.id });
    const liveMember = livePreflight.members.find((m) => m.contactIdentityId === IDENTITY_A)!;
    expect((liveMember.liveVerdict as { consentStop: { status: string } }).consentStop.status).toBe("block");
    expect((liveMember.frozenVerdict as { consentStop: { status: string } }).consentStop.status).toBe("pass");
    expect(liveMember.eligibleNow).toBe(false);

    // #35 note: a fresh AUDIENCE ESTIMATE now derives from ConsentStateProjection, so it drops the
    // just-revoked contact entirely (unknown/verified stay in; effective_revoke is excluded).
    const freshPreview = await broadcast.previewAudienceEligibility(owner, {
      segmentId: SEGMENT_A,
      channelScopeId: SCOPE_A,
      channel: "whatsapp",
      templateVersionId: TEMPLATE_VERSION_A,
    });
    expect(freshPreview.members.map((m) => m.contactIdentityId)).not.toContain(IDENTITY_A);
  });
});

describe("C5-M2 confirmBroadcastRun / cancelBroadcastRun lifecycle", () => {
  it("confirm requires audience_frozen; wrong status is denied", async () => {
    const run = await broadcast.createBroadcastRun(owner, {
      channelScopeId: SCOPE_A,
      channel: "whatsapp",
      templateVersionId: TEMPLATE_VERSION_A,
      creationIdempotencyKey: "c5-m2-test-confirm-1",
    });
    await expectCode(
      broadcast.confirmBroadcastRun(owner, { broadcastRunId: run.resource.id, expectedRevision: 0 }),
      "ACTION_DENIED",
    );
    const frozen = await broadcast.freezeAudience(owner, {
      broadcastRunId: run.resource.id,
      expectedRevision: 0,
      segmentId: SEGMENT_A,
    });
    const confirmed = await broadcast.confirmBroadcastRun(owner, {
      broadcastRunId: run.resource.id,
      expectedRevision: frozen.resource.revision,
    });
    expect(confirmed.resource).toMatchObject({ status: "confirmed" });
    expect(confirmed.resource.confirmedAt).toEqual(NOW);
  });

  it("cancel is allowed from draft/audience_frozen/confirmed but not from a terminal cancelled run", async () => {
    const run = await broadcast.createBroadcastRun(owner, {
      channelScopeId: SCOPE_A,
      channel: "whatsapp",
      templateVersionId: TEMPLATE_VERSION_A,
      creationIdempotencyKey: "c5-m2-test-cancel-1",
    });
    const cancelled = await broadcast.cancelBroadcastRun(owner, {
      broadcastRunId: run.resource.id,
      expectedRevision: 0,
    });
    expect(cancelled.resource).toMatchObject({ status: "cancelled" });
    await expectCode(
      broadcast.cancelBroadcastRun(owner, { broadcastRunId: run.resource.id, expectedRevision: 1 }),
      "ACTION_DENIED",
    );
  });
});

describe("C5-M2 submitBroadcastRun — hard-disabled chokepoint", () => {
  it("always fails SEND_PATH_UNAVAILABLE, zero writes, regardless of run status", async () => {
    const run = await broadcast.createBroadcastRun(owner, {
      channelScopeId: SCOPE_A,
      channel: "whatsapp",
      templateVersionId: TEMPLATE_VERSION_A,
      creationIdempotencyKey: "c5-m2-test-submit-1",
    });
    const before = await ownerCounts();
    await expectCode(broadcast.submitBroadcastRun(owner, { broadcastRunId: run.resource.id }), "SEND_PATH_UNAVAILABLE");
    expect(await ownerCounts()).toEqual(before);
    const untouched = await broadcast.getBroadcastRun(owner, { broadcastRunId: run.resource.id });
    expect(untouched.run.status).toBe("draft");
  });

  it("a foreign broadcastRunId is RESOURCE_NOT_FOUND, indistinguishable from missing", async () => {
    const foreignRun = await broadcast.createBroadcastRun(
      { ownerId: ORG_B, membershipId: MEMBER_B, impersonating: false },
      {
        channelScopeId: SCOPE_B,
        channel: "whatsapp",
        templateVersionId: TEMPLATE_VERSION_B,
        creationIdempotencyKey: "c5-m2-test-b-run",
      },
    );
    for (const broadcastRunId of [foreignRun.resource.id, "c5-m2-test-missing-run"]) {
      await expectCode(broadcast.submitBroadcastRun(owner, { broadcastRunId }), "RESOURCE_NOT_FOUND");
    }
  });
});

describe("C5-M3 static no-second-REAL-send-path (simulated executor excepted)", () => {
  // Evolved from M2's no-second-send-path test in the SAME spirit: M3 adds the SIMULATED
  // executor (executeBroadcastRun), so the executing/completed/simulated_sent literals are now
  // legitimately reachable — but the file must still statically prove ZERO real provider entry
  // point, and the executor is called out as the single, isolated exception.
  const source = readFileSync(path.join(__dirname, "../customer-broadcast-service.ts"), "utf8");

  it("has zero real provider entry point anywhere; the real-send chokepoint stays hard-disabled", () => {
    // No real provider I/O anywhere in the domain file — not in submit, not in the simulated
    // executor. Every "send" is a DB write to BroadcastAudienceMember / ContactSendFrequencyEvent.
    expect(source).not.toMatch(/\badapter\s*\.|\.adapter\b|fetch\s*\(|\baxios\b|https?\.request|new WebSocket/i);

    // submitBroadcastRun (the REAL send path) always fails SEND_PATH_UNAVAILABLE and never
    // re-reads eligibility or writes a frequency row — its body is unchanged from M2.
    const submitStart = source.indexOf("async function submitBroadcastRun");
    const submitEnd = source.indexOf("async function", submitStart + 1);
    const submitBody = source.slice(submitStart, submitEnd);
    expect(submitBody).toContain("SEND_PATH_UNAVAILABLE");
    expect(submitBody).not.toContain("recordSendFrequencyEvent");
    expect(submitBody).not.toContain("simulated_sent");
  });

  it("confines the simulated-send transitions to executeBroadcastRun (the single exception)", () => {
    const execStart = source.indexOf("async function executeBroadcastRun");
    expect(execStart).toBeGreaterThan(-1);
    // The M3-only transitions appear ONLY at/after the executor — no earlier function moves a run
    // into an execution/terminal-send state or marks a member simulated.
    for (const literal of ['"simulated_sent"', '"executing"', '"completed"']) {
      expect(source.indexOf(literal), `${literal} must not appear before executeBroadcastRun`).toBeGreaterThan(
        execStart,
      );
    }
    // The simulated frequency counter is written ONLY from the executor.
    expect(source.indexOf("recordSendFrequencyEventInTransaction(")).toBeGreaterThan(execStart);
  });
});

describe("C5-M3 ledger #35: audience estimate derives from ConsentStateProjection, not legacy marketingConsent", () => {
  it("keeps a legacy opt_out contact once its projection is not effective_revoke (legacy column no longer read)", async () => {
    // CONTACT_A_OPTOUT keeps its legacy marketingConsent=opt_out column, but flip its projection
    // to verified_grant. The estimate must now KEEP it — proving the legacy column is ignored.
    await prisma.consentStateProjection.update({
      where: {
        ownerId: ORG_A,
        ownerId_contactId_channel_purpose: { ownerId: ORG_A, contactId: CONTACT_A_OPTOUT, channel: "whatsapp", purpose: "marketing" },
      },
      data: { state: "verified_grant" },
    });
    const preview = await broadcast.previewAudienceEligibility(owner, {
      segmentId: SEGMENT_A,
      channelScopeId: SCOPE_A,
      channel: "whatsapp",
      templateVersionId: TEMPLATE_VERSION_A,
    });
    expect(preview.members.map((m) => m.contactIdentityId)).toContain(IDENTITY_A_OPTOUT);
  });

  it("excludes a contact whose projection is effective_revoke regardless of the legacy column", async () => {
    await prisma.consentStateProjection.update({
      where: {
        ownerId: ORG_A,
        ownerId_contactId_channel_purpose: { ownerId: ORG_A, contactId: CONTACT_GRANT, channel: "whatsapp", purpose: "marketing" },
      },
      data: { state: "effective_revoke" },
    });
    const preview = await broadcast.previewAudienceEligibility(owner, {
      segmentId: SEGMENT_A,
      channelScopeId: SCOPE_A,
      channel: "whatsapp",
      templateVersionId: TEMPLATE_VERSION_A,
    });
    expect(preview.members.map((m) => m.contactIdentityId)).not.toContain(IDENTITY_GRANT);
  });

  it("keeps estimate and verdict separate: an unknown-consent contact is kept by the estimate but its verdict is not pass", async () => {
    const preview = await broadcast.previewAudienceEligibility(owner, {
      segmentId: SEGMENT_A,
      channelScopeId: SCOPE_A,
      channel: "whatsapp",
      templateVersionId: TEMPLATE_VERSION_A,
    });
    const kept = preview.members.find((m) => m.contactIdentityId === IDENTITY_A)!;
    expect(kept.includedByMerchant).toBe(true); // estimate keeps unknown (flag + keep)
    expect(kept.verdict.consentStop.status).toBe("risk"); // verdict flags it — the two are separate
  });
});

describe("C5-M3 executeBroadcastRun — simulated provider execution (zero real send, zero spend)", () => {
  it("marks a four-axis-pass contact simulated_sent with exactly one frequency event, and skips a consent-risk contact with zero", async () => {
    const run = await createFrozenConfirmedRun("c5-m3-exec-e2e");
    const result = await broadcast.executeBroadcastRun(owner, { broadcastRunId: run.id, expectedRevision: run.revision });
    expect(result.resource.status).toBe("completed");
    expect(result.alreadyComplete).toBe(false);

    const byIdentity = new Map(result.members.map((m) => [m.contactIdentityId, m]));
    const granted = byIdentity.get(IDENTITY_GRANT)!;
    expect(granted.sendState).toBe("simulated_sent");
    expect(granted.skipReason).toBeNull();
    const risky = byIdentity.get(IDENTITY_A)!;
    expect(risky.sendState).toBe("skipped_ineligible");
    expect(risky.skipReason).toContain("consentStop");

    // Exactly one frequency event for the granted contact; zero for the skipped one.
    expect(await freqCount(CONTACT_GRANT)).toBe(1);
    expect(await freqCount(CONTACT_A)).toBe(0);
    const freq = await prisma.contactSendFrequencyEvent.findFirstOrThrow({ where: { ownerId: ORG_A, contactId: CONTACT_GRANT } });
    expect(freq.simulated).toBe(true);
    expect(freq.sourceKind).toBe("broadcast_run");
    expect(freq.purposeClass).toBe("proactive_non_transactional");
  });

  it("a completed run re-executed is an idempotent no-op with zero extra frequency rows (retry double-counts zero)", async () => {
    const run = await createFrozenConfirmedRun("c5-m3-exec-retry");
    const first = await broadcast.executeBroadcastRun(owner, { broadcastRunId: run.id, expectedRevision: run.revision });
    const afterFirst = await prisma.contactSendFrequencyEvent.count({ where: { ownerId: ORG_A } });
    const second = await broadcast.executeBroadcastRun(owner, { broadcastRunId: run.id, expectedRevision: first.resource.revision });
    expect(second.alreadyComplete).toBe(true);
    expect(second.resource.status).toBe("completed");
    expect(await prisma.contactSendFrequencyEvent.count({ where: { ownerId: ORG_A } })).toBe(afterFirst);
  });

  it("resumes an interrupted (executing) run: a pre-recorded frequency event finishes as simulated_sent, never re-counted or mis-skipped", async () => {
    const run = await createFrozenConfirmedRun("c5-m3-exec-resume");
    // Simulate a crash right AFTER recording the granted contact's frequency event but BEFORE the
    // member sendState flipped: run is executing, the member is still pending, the freq row exists.
    await prisma.broadcastRun.update({ where: { id: run.id, ownerId: ORG_A }, data: { status: "executing" } });
    const executing = await prisma.broadcastRun.findUniqueOrThrow({ where: { id: run.id, ownerId: ORG_A } });
    const key = `freq:${ORG_A}:${run.id}:${IDENTITY_GRANT}:whatsapp:proactive_non_transactional`;
    await prisma.contactSendFrequencyEvent.create({
      data: {
        id: "c5-m3-resume-freq",
        ownerId: ORG_A,
        contactId: CONTACT_GRANT,
        channel: "whatsapp",
        purposeClass: "proactive_non_transactional",
        sourceKind: "broadcast_run",
        sendRef: "prior-attempt",
        simulated: true,
        idempotencyKey: key,
        countedAt: new Date(),
      },
    });
    // Flip consent to revoke AFTER the freq event: recovery must NOT re-read and mis-skip a send
    // that already spent cap.
    await prisma.consentStateProjection.update({
      where: {
        ownerId: ORG_A,
        ownerId_contactId_channel_purpose: { ownerId: ORG_A, contactId: CONTACT_GRANT, channel: "whatsapp", purpose: "marketing" },
      },
      data: { state: "effective_revoke" },
    });

    const result = await broadcast.executeBroadcastRun(owner, { broadcastRunId: run.id, expectedRevision: executing.revision });
    expect(result.resource.status).toBe("completed");
    const granted = result.members.find((m) => m.contactIdentityId === IDENTITY_GRANT)!;
    expect(granted.sendState).toBe("simulated_sent"); // recovered from the pre-recorded event
    expect(await freqCount(CONTACT_GRANT)).toBe(1); // exactly one — zero double-count
  });

  it("triggers the frequency cap on a second broadcast to the same contact: skipped with exactly one count total", async () => {
    const run1 = await createFrozenConfirmedRun("c5-m3-freq-1");
    await broadcast.executeBroadcastRun(owner, { broadcastRunId: run1.id, expectedRevision: run1.revision });
    expect(await freqCount(CONTACT_GRANT)).toBe(1);

    const run2 = await createFrozenConfirmedRun("c5-m3-freq-2");
    const result2 = await broadcast.executeBroadcastRun(owner, { broadcastRunId: run2.id, expectedRevision: run2.revision });
    const granted2 = result2.members.find((m) => m.contactIdentityId === IDENTITY_GRANT)!;
    expect(granted2.sendState).toBe("skipped_ineligible");
    expect(granted2.skipReason).toBe("frequency:frequency_cap_reached");
    expect(await freqCount(CONTACT_GRANT)).toBe(1); // the cap held; no second count
  });

  it("resolves a concurrent last-cap-slot race across two runs: exactly one simulated_sent, one skipped, one frequency row", async () => {
    const runA = await createFrozenConfirmedRun("c5-m3-race-a");
    const runB = await createFrozenConfirmedRun("c5-m3-race-b");
    const [resA, resB] = await Promise.all([
      broadcast.executeBroadcastRun(owner, { broadcastRunId: runA.id, expectedRevision: runA.revision }),
      broadcast.executeBroadcastRun(owner, { broadcastRunId: runB.id, expectedRevision: runB.revision }),
    ]);
    const grantedStates = [resA, resB].map((r) => r.members.find((m) => m.contactIdentityId === IDENTITY_GRANT)!.sendState);
    expect(grantedStates.filter((s) => s === "simulated_sent")).toHaveLength(1);
    expect(grantedStates.filter((s) => s === "skipped_ineligible")).toHaveLength(1);
    expect(await freqCount(CONTACT_GRANT)).toBe(1);
  });

  it("serializes two resumers finalizing the same pending member so state and frequency event cannot contradict", async () => {
    const run = await createFrozenConfirmedRun("c5-m3-same-member-finalize-race");
    await prisma.broadcastRun.update({
      where: { id: run.id, ownerId: ORG_A },
      data: { status: "executing" },
    });
    const executing = await prisma.broadcastRun.findUniqueOrThrow({ where: { id: run.id, ownerId: ORG_A } });
    const grantedMember = await prisma.broadcastAudienceMember.findFirstOrThrow({
      where: {
        ownerId: ORG_A,
        broadcastRunId: run.id,
        contactIdentityId: IDENTITY_GRANT,
      },
    });
    const frequencyKey = `freq:${ORG_A}:${run.id}:${IDENTITY_GRANT}:whatsapp:proactive_non_transactional`;
    const bothEventChecksFinished = deferred<void>();
    const sentClaimed = deferred<void>();
    let eventCheckCount = 0;

    const sharedHooks: Record<string, DbMethodHook> = {
      "contactSendFrequencyEvent.findFirst": async (invoke, args) => {
        const result = await invoke();
        const key = (
          args[0] as { where?: { idempotencyKey?: string } } | undefined
        )?.where?.idempotencyKey;
        if (key === frequencyKey && result === null && eventCheckCount < 2) {
          eventCheckCount += 1;
          if (eventCheckCount === 2) bothEventChecksFinished.resolve();
          await bothEventChecksFinished.promise;
        }
        return result;
      },
    };
    const senderDb = createHookedBroadcastDb({
      ...sharedHooks,
      "broadcastAudienceMember.updateMany": async (invoke, args) => {
        const update = args[0] as {
          where?: { id?: string };
          data?: { sendState?: string };
        };
        const result = await invoke();
        if (
          update.where?.id === grantedMember.id &&
          update.data?.sendState === "simulated_sent"
        ) {
          sentClaimed.resolve();
        }
        return result;
      },
    });
    const blockerDb = createHookedBroadcastDb({
      ...sharedHooks,
      "consentStateProjection.findUnique": async (invoke, args) => {
        const key = (
          args[0] as {
            where?: {
              ownerId_contactId_channel_purpose?: {
                ownerId?: string;
                contactId?: string;
                channel?: string;
                purpose?: string;
              };
            };
          } | undefined
        )?.where?.ownerId_contactId_channel_purpose;
        if (
          key?.ownerId === ORG_A &&
          key.contactId === CONTACT_GRANT &&
          key.channel === "whatsapp" &&
          key.purpose === "marketing"
        ) {
          return { state: "effective_revoke" };
        }
        return invoke();
      },
      "broadcastAudienceMember.updateMany": async (invoke, args) => {
        const update = args[0] as {
          where?: { id?: string };
          data?: { sendState?: string };
        };
        if (
          update.where?.id === grantedMember.id &&
          update.data?.sendState === "skipped_ineligible"
        ) {
          await sentClaimed.promise;
        }
        return invoke();
      },
    });
    const sender = createCustomerBroadcastService({
      db: senderDb,
      clock: () => NOW,
      id: () => `c5-m3-sender-${++sequence}`,
    });
    const blocker = createCustomerBroadcastService({
      db: blockerDb,
      clock: () => NOW,
      id: () => `c5-m3-blocker-${++sequence}`,
    });

    const settled = await Promise.allSettled([
      sender.executeBroadcastRun(owner, {
        broadcastRunId: run.id,
        expectedRevision: executing.revision,
      }),
      blocker.executeBroadcastRun(owner, {
        broadcastRunId: run.id,
        expectedRevision: executing.revision,
      }),
    ]);
    expect(settled.every((result) => result.status === "fulfilled")).toBe(true);

    const terminal = await prisma.broadcastAudienceMember.findFirstOrThrow({
      where: { id: grantedMember.id, ownerId: ORG_A },
    });
    const frequencyEvents = await prisma.contactSendFrequencyEvent.count({
      where: { ownerId: ORG_A, idempotencyKey: frequencyKey },
    });
    expect(["simulated_sent", "skipped_ineligible"]).toContain(terminal.sendState);
    expect(frequencyEvents).toBe(terminal.sendState === "simulated_sent" ? 1 : 0);
  });

  it("lets the blocked loser reclaim a member after the winner's frequency-cap rollback", async () => {
    const run = await createFrozenConfirmedRun("c5-m3-same-member-cap-rollback");
    await prisma.broadcastRun.update({
      where: { id: run.id, ownerId: ORG_A },
      data: { status: "executing" },
    });
    const executing = await prisma.broadcastRun.findUniqueOrThrow({ where: { id: run.id, ownerId: ORG_A } });
    const grantedMember = await prisma.broadcastAudienceMember.findFirstOrThrow({
      where: {
        ownerId: ORG_A,
        broadcastRunId: run.id,
        contactIdentityId: IDENTITY_GRANT,
      },
    });
    const frequencyKey = `freq:${ORG_A}:${run.id}:${IDENTITY_GRANT}:whatsapp:proactive_non_transactional`;
    const bothEventChecksFinished = deferred<void>();
    const winnerClaimed = deferred<void>();
    const loserUpdateStarted = deferred<void>();
    let eventCheckCount = 0;
    let winnerClaimCount = 0;
    let loserClaimCount = 0;
    let winnerFrequencyCountCalls = 0;
    let injectedCapCount = 0;

    const sharedHooks: Record<string, DbMethodHook> = {
      "contactSendFrequencyEvent.findFirst": async (invoke, args) => {
        const result = await invoke();
        const key = (
          args[0] as { where?: { idempotencyKey?: string } } | undefined
        )?.where?.idempotencyKey;
        if (key === frequencyKey && result === null && eventCheckCount < 2) {
          eventCheckCount += 1;
          if (eventCheckCount === 2) bothEventChecksFinished.resolve();
          await bothEventChecksFinished.promise;
        }
        return result;
      },
    };
    const winnerDb = createHookedBroadcastDb({
      ...sharedHooks,
      "broadcastAudienceMember.updateMany": async (invoke, args) => {
        const update = args[0] as {
          where?: { id?: string };
          data?: { sendState?: string };
        };
        const result = (await invoke()) as { count: number };
        if (
          update.where?.id === grantedMember.id &&
          update.data?.sendState === "simulated_sent" &&
          result.count === 1
        ) {
          winnerClaimCount += 1;
          winnerClaimed.resolve();
          await loserUpdateStarted.promise;
        }
        return result;
      },
      "contactSendFrequencyEvent.count": async (invoke, args) => {
        const where = (
          args[0] as {
            where?: {
              ownerId?: string;
              contactId?: string;
              channel?: string;
              purposeClass?: string;
            };
          } | undefined
        )?.where;
        if (
          where?.ownerId === ORG_A &&
          where.contactId === CONTACT_GRANT &&
          where.channel === "whatsapp" &&
          where.purposeClass === "proactive_non_transactional"
        ) {
          winnerFrequencyCountCalls += 1;
          if (winnerFrequencyCountCalls === 2) {
            injectedCapCount += 1;
            return 1;
          }
        }
        return invoke();
      },
    });
    const loserDb = createHookedBroadcastDb({
      ...sharedHooks,
      "broadcastAudienceMember.updateMany": async (invoke, args) => {
        const update = args[0] as {
          where?: { id?: string };
          data?: { sendState?: string };
        };
        if (
          update.where?.id === grantedMember.id &&
          update.data?.sendState === "simulated_sent"
        ) {
          await winnerClaimed.promise;
          const blockedUpdate = invoke() as Promise<{ count: number }>;
          loserUpdateStarted.resolve();
          const result = await blockedUpdate;
          if (result.count === 1) loserClaimCount += 1;
          return result;
        }
        return invoke();
      },
    });
    const winner = createCustomerBroadcastService({
      db: winnerDb,
      clock: () => NOW,
      id: () => `c5-m3-cap-winner-${++sequence}`,
    });
    const loser = createCustomerBroadcastService({
      db: loserDb,
      clock: () => NOW,
      id: () => `c5-m3-cap-loser-${++sequence}`,
    });

    const settled = await Promise.allSettled([
      winner.executeBroadcastRun(owner, {
        broadcastRunId: run.id,
        expectedRevision: executing.revision,
      }),
      loser.executeBroadcastRun(owner, {
        broadcastRunId: run.id,
        expectedRevision: executing.revision,
      }),
    ]);
    expect(settled.every((result) => result.status === "fulfilled")).toBe(true);
    expect(winnerClaimCount).toBe(1);
    expect(injectedCapCount).toBe(1);
    expect(loserClaimCount).toBe(1);

    const terminalRows = await prisma.broadcastAudienceMember.findMany({
      where: { id: grantedMember.id, ownerId: ORG_A },
    });
    expect(terminalRows).toHaveLength(1);
    expect(terminalRows.filter((row) => row.sendState !== "pending")).toHaveLength(1);
    expect(terminalRows[0].sendState).toBe("simulated_sent");

    const frequencyEvents = await prisma.contactSendFrequencyEvent.count({
      where: { ownerId: ORG_A, idempotencyKey: frequencyKey },
    });
    expect(frequencyEvents).toBe(
      terminalRows[0].sendState === "simulated_sent" ? 1 : 0,
    );
    await expect(
      prisma.broadcastAudienceMember.count({
        where: { id: grantedMember.id, ownerId: ORG_A, sendState: "pending" },
      }),
    ).resolves.toBe(0);
  });

  it("skips a DND-blocked contact with a doNotDisturb reason and zero frequency rows", async () => {
    await prisma.contact.update({ where: { id: CONTACT_GRANT, ownerId: ORG_A }, data: { doNotDisturb: true } });
    const run = await createFrozenConfirmedRun("c5-m3-dnd");
    const result = await broadcast.executeBroadcastRun(owner, { broadcastRunId: run.id, expectedRevision: run.revision });
    const granted = result.members.find((m) => m.contactIdentityId === IDENTITY_GRANT)!;
    expect(granted.sendState).toBe("skipped_ineligible");
    expect(granted.skipReason).toBe("doNotDisturb:dnd_set");
    expect(await freqCount(CONTACT_GRANT)).toBe(0);
  });

  it("never simulated-sends a consent-risk contact — the D5 override is unreachable (fail closed)", async () => {
    const run = await createFrozenConfirmedRun("c5-m3-d5");
    const result = await broadcast.executeBroadcastRun(owner, { broadcastRunId: run.id, expectedRevision: run.revision });
    const risky = result.members.find((m) => m.contactIdentityId === IDENTITY_A)!;
    expect(risky.sendState).toBe("skipped_ineligible");
    expect(risky.skipReason).toContain("consentStop");
    expect(await freqCount(CONTACT_A)).toBe(0);
  });

  it("only a confirmed run may start execution; draft and audience_frozen are denied", async () => {
    const created = await broadcast.createBroadcastRun(owner, {
      channelScopeId: SCOPE_A,
      channel: "whatsapp",
      templateVersionId: TEMPLATE_VERSION_A,
      creationIdempotencyKey: "c5-m3-status",
    });
    await expectCode(broadcast.executeBroadcastRun(owner, { broadcastRunId: created.resource.id, expectedRevision: 0 }), "ACTION_DENIED");
    const frozen = await broadcast.freezeAudience(owner, { broadcastRunId: created.resource.id, expectedRevision: 0, segmentId: SEGMENT_A });
    await expectCode(
      broadcast.executeBroadcastRun(owner, { broadcastRunId: created.resource.id, expectedRevision: frozen.resource.revision }),
      "ACTION_DENIED",
    );
    expect(await prisma.contactSendFrequencyEvent.count({ where: { ownerId: ORG_A } })).toBe(0);
  });

  it("a stale expectedRevision on a confirmed run is CAS_CONFLICT, zero sends", async () => {
    const run = await createFrozenConfirmedRun("c5-m3-cas");
    await expectCode(broadcast.executeBroadcastRun(owner, { broadcastRunId: run.id, expectedRevision: 99 }), "CAS_CONFLICT");
    expect(await prisma.contactSendFrequencyEvent.count({ where: { ownerId: ORG_A } })).toBe(0);
    const untouched = await prisma.broadcastRun.findUniqueOrThrow({ where: { id: run.id, ownerId: ORG_A } });
    expect(untouched.status).toBe("confirmed");
  });

  it("denies admin and member from executing (owner-only, transaction-recheck path), zero sends", async () => {
    const run = await createFrozenConfirmedRun("c5-m3-rbac");
    for (const principal of [admin, member]) {
      await expectCode(broadcast.executeBroadcastRun(principal, { broadcastRunId: run.id, expectedRevision: run.revision }), "ACTION_DENIED");
    }
    expect(await prisma.contactSendFrequencyEvent.count({ where: { ownerId: ORG_A } })).toBe(0);
    const untouched = await prisma.broadcastRun.findUniqueOrThrow({ where: { id: run.id, ownerId: ORG_A } });
    expect(untouched.status).toBe("confirmed");
  });

  it("treats a foreign run as RESOURCE_NOT_FOUND on execute, zero writes", async () => {
    const foreign = await broadcast.createBroadcastRun(
      { ownerId: ORG_B, membershipId: MEMBER_B, impersonating: false },
      {
        channelScopeId: SCOPE_B,
        channel: "whatsapp",
        templateVersionId: TEMPLATE_VERSION_B,
        creationIdempotencyKey: "c5-m3-foreign",
      },
    );
    await expectCode(broadcast.executeBroadcastRun(owner, { broadcastRunId: foreign.resource.id, expectedRevision: 0 }), "RESOURCE_NOT_FOUND");
    expect(await prisma.contactSendFrequencyEvent.count({ where: { ownerId: { in: OWNERS } } })).toBe(0);
  });

  it("prunes stale members on a re-freeze to a narrower segment; execution never touches the dropped ones", async () => {
    // Give CONTACT_GRANT a spend so a spend-gated narrow segment matches ONLY it (not CONTACT_A).
    await prisma.contact.update({ where: { id: CONTACT_GRANT, ownerId: ORG_A }, data: { totalOrdersMyr: 100 } });
    await prisma.segment.create({
      data: {
        id: "c5-m3-narrow-seg",
        ownerId: ORG_A,
        name: "Big spenders",
        phrase: "spend at least 50",
        kind: "custom",
        createdAt: NOW,
        rulesJson: {
          match: "all",
          rules: [
            { kind: "lifetime_spend", comparison: "at_least", amountMyr: 50 },
            { kind: "channel", channel: "whatsapp" },
            { kind: "contactability", value: "contactable" },
          ],
        },
      },
    });

    const created = await broadcast.createBroadcastRun(owner, {
      channelScopeId: SCOPE_A,
      channel: "whatsapp",
      templateVersionId: TEMPLATE_VERSION_A,
      creationIdempotencyKey: "c5-m3-prune",
    });
    // Wide freeze: SEGMENT_A matches CONTACT_A (unknown, kept) + CONTACT_GRANT.
    const wide = await broadcast.freezeAudience(owner, {
      broadcastRunId: created.resource.id,
      expectedRevision: 0,
      segmentId: SEGMENT_A,
    });
    expect(wide.members.map((m) => m.contactIdentityId).sort()).toEqual([IDENTITY_A, IDENTITY_GRANT].sort());

    // Re-freeze to the narrow segment (only CONTACT_GRANT): CONTACT_A must be PRUNED, not left behind.
    const narrow = await broadcast.freezeAudience(owner, {
      broadcastRunId: created.resource.id,
      expectedRevision: wide.resource.revision,
      segmentId: "c5-m3-narrow-seg",
    });
    expect(narrow.resource.audienceRevision).toBe(2);
    expect(narrow.members.map((m) => m.contactIdentityId)).toEqual([IDENTITY_GRANT]);
    // The member table itself holds ONLY CONTACT_GRANT at the new revision — zero stale rows.
    const rowsNow = await prisma.broadcastAudienceMember.findMany({
      where: { ownerId: ORG_A, broadcastRunId: created.resource.id },
    });
    expect(rowsNow.map((r) => r.contactIdentityId)).toEqual([IDENTITY_GRANT]);
    expect(rowsNow.every((r) => r.audienceRevision === 2)).toBe(true);

    // Confirm + execute: only CONTACT_GRANT is processed; CONTACT_A leaves zero frequency + zero residue.
    const confirmed = await broadcast.confirmBroadcastRun(owner, {
      broadcastRunId: created.resource.id,
      expectedRevision: narrow.resource.revision,
    });
    const result = await broadcast.executeBroadcastRun(owner, {
      broadcastRunId: created.resource.id,
      expectedRevision: confirmed.resource.revision,
    });
    expect(result.members.map((m) => m.contactIdentityId)).toEqual([IDENTITY_GRANT]);
    expect(result.members[0]!.sendState).toBe("simulated_sent");
    expect(await freqCount(CONTACT_GRANT)).toBe(1);
    expect(await freqCount(CONTACT_A)).toBe(0);
    expect(
      await prisma.broadcastAudienceMember.count({
        where: { ownerId: ORG_A, broadcastRunId: created.resource.id, contactIdentityId: IDENTITY_A },
      }),
    ).toBe(0);
  });

  it("re-reads live authority at execute time: a member revoked via consent-runtime after freeze+confirm is skipped with zero frequency rows", async () => {
    const run = await createFrozenConfirmedRun("c5-m3-live-reread");
    // At freeze+confirm CONTACT_GRANT passed all four axes. Revoke through the REAL writer
    // (consent-runtime STOP fan-out) AFTER confirm — proving execution re-reads live authority
    // directly, not just the read-only getBroadcastRunLivePreflight surface.
    const stop = await recordUnqualifiedStop({
      ownerId: ORG_A,
      contactId: CONTACT_GRANT,
      channel: "whatsapp",
      sourceKind: "stop_keyword",
      channelEventRef: "test:inbound",
      opaqueMessageId: "c5-m3-stop-1",
    });
    expect(stop.duplicate).toBe(false);

    const result = await broadcast.executeBroadcastRun(owner, { broadcastRunId: run.id, expectedRevision: run.revision });
    const granted = result.members.find((m) => m.contactIdentityId === IDENTITY_GRANT)!;
    expect(granted.sendState).toBe("skipped_ineligible");
    expect(granted.skipReason).toContain("consentStop"); // effective_revoke, re-read at execute time
    expect(await freqCount(CONTACT_GRANT)).toBe(0);
  });
});

describe("C5-M3 member directory (#27)", () => {
  const directory = createMemberDirectoryService();

  it("returns the owner-scoped memberships with a server-derived self, marking isSelf, no cross-tenant leak", async () => {
    const result = await directory.listMemberDirectory({ ownerId: ORG_A, membershipId: OWNER });
    expect(result.self).toEqual({ membershipId: OWNER, role: "owner", roles: ["owner"] });
    const ids = result.members.map((m) => m.membershipId).sort();
    expect(ids).toEqual([ADMIN, MEMBER, OWNER].sort());
    expect(result.members.find((m) => m.membershipId === OWNER)!.isSelf).toBe(true);
    expect(result.members.find((m) => m.membershipId === ADMIN)!.isSelf).toBe(false);
    expect(ids).not.toContain(MEMBER_B); // ORG_B membership never appears
  });

  it("derives self and role from the passed membership (server-derived), falling back to email for the display name", async () => {
    const result = await directory.listMemberDirectory({ ownerId: ORG_A, membershipId: MEMBER });
    expect(result.self).toEqual({ membershipId: MEMBER, role: "member", roles: ["member"] });
    const self = result.members.find((m) => m.membershipId === MEMBER)!;
    expect(self.displayName).toBe("c5-m2-member@example.test"); // user row has no name -> email
  });

  it("fails closed when the principal is not an active member of the org", async () => {
    await expectCode(
      directory.listMemberDirectory({ ownerId: ORG_A, membershipId: "c5-m3-not-a-member" }),
      "ACTION_DENIED",
    );
  });
});

describe("C5-M2 cross-tenant ID swaps", () => {
  it("treats foreign and missing broadcastRunId/segmentId alike, leaks nothing, writes nothing", async () => {
    const beforeA = await ownerCounts(ORG_A);
    const foreignRun = await broadcast.createBroadcastRun(
      { ownerId: ORG_B, membershipId: MEMBER_B, impersonating: false },
      {
        channelScopeId: SCOPE_B,
        channel: "whatsapp",
        templateVersionId: TEMPLATE_VERSION_B,
        creationIdempotencyKey: "c5-m2-test-cross-b-run",
      },
    );
    // Captured AFTER seeding the one legitimate ORG_B fixture run above — the assertion below
    // is about ORG_A's cross-tenant attempts leaving ORG_B untouched, not about ORG_B's own
    // setup activity.
    const beforeB = await ownerCounts(ORG_B);
    for (const broadcastRunId of [foreignRun.resource.id, "c5-m2-test-missing"]) {
      await expectCode(broadcast.getBroadcastRun(owner, { broadcastRunId }), "RESOURCE_NOT_FOUND");
      await expectCode(
        broadcast.confirmBroadcastRun(owner, { broadcastRunId, expectedRevision: 0 }),
        "RESOURCE_NOT_FOUND",
      );
      await expectCode(
        broadcast.cancelBroadcastRun(owner, { broadcastRunId, expectedRevision: 0 }),
        "RESOURCE_NOT_FOUND",
      );
    }
    await expectCode(
      broadcast.freezeAudience(owner, {
        broadcastRunId: foreignRun.resource.id,
        expectedRevision: 0,
        segmentId: SEGMENT_B,
      }),
      "RESOURCE_NOT_FOUND",
    );
    await expectCode(
      broadcast.previewAudienceEligibility(owner, {
        segmentId: SEGMENT_B,
        channelScopeId: SCOPE_A,
        channel: "whatsapp",
        templateVersionId: TEMPLATE_VERSION_A,
      }),
      "RESOURCE_NOT_FOUND",
    );
    const list = JSON.stringify(await broadcast.listBroadcastRuns(owner, {}));
    expect(list).not.toContain(foreignRun.resource.id);
    expect(await ownerCounts(ORG_A)).toEqual(beforeA);
    expect(await ownerCounts(ORG_B)).toEqual(beforeB);
  });
});

describe("C5-M2 gateway principal resolution", () => {
  it("routes every gateway export through resolvePrincipal, denying NOT_AUTHORIZED when requireOwner fails", async () => {
    const mockedRequireOwner = vi.mocked(requireOwner);
    const exportNames = Object.keys(customerBroadcastGateway).filter(
      (name) => typeof (customerBroadcastGateway as Record<string, unknown>)[name] === "function",
    );
    expect(exportNames.length).toBeGreaterThan(0);
    for (const name of exportNames) {
      mockedRequireOwner.mockResolvedValueOnce({ error: "Not authorized." });
      const fn = (customerBroadcastGateway as Record<string, (input?: unknown) => Promise<unknown>>)[name];
      await expect(fn(undefined)).resolves.toEqual({ ok: false, error: "NOT_AUTHORIZED" });
    }
  });

  it("denies ACTION_DENIED when the session resolves but no active membership matches", async () => {
    const mockedRequireOwner = vi.mocked(requireOwner);
    mockedRequireOwner.mockResolvedValueOnce({ email: "c5-m2-b@example.test", ownerId: ORG_A });
    await expect(customerBroadcastGateway.listBroadcastRuns({})).resolves.toEqual({
      ok: false,
      error: "ACTION_DENIED",
    });
  });

  it("createBroadcastRun succeeds through the gateway", async () => {
    const result = await customerBroadcastGateway.createBroadcastRun({
      channelScopeId: SCOPE_A,
      channel: "whatsapp",
      templateVersionId: TEMPLATE_VERSION_A,
      creationIdempotencyKey: "c5-m2-test-gateway-create",
    });
    expect(result).toMatchObject({ ok: true, duplicate: false, resource: { status: "draft" } });
  });

  it("submitBroadcastRun stays hard-disabled through the gateway", async () => {
    const run = await customerBroadcastGateway.createBroadcastRun({
      channelScopeId: SCOPE_A,
      channel: "whatsapp",
      templateVersionId: TEMPLATE_VERSION_A,
      creationIdempotencyKey: "c5-m2-test-gateway-submit",
    });
    await expect(
      customerBroadcastGateway.submitBroadcastRun({
        broadcastRunId: (run as { resource: { id: string } }).resource.id,
      }),
    ).resolves.toEqual({ ok: false, error: "SEND_PATH_UNAVAILABLE" });
  });
});
