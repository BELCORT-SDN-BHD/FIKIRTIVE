import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@fikirtive/db";
import * as customerBroadcastGateway from "../customer-broadcast-gateway";
import { createCustomerBroadcastService } from "../customer-broadcast-service";
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
const CONTACT_B = "c5-m2-test-contact-b";
const SCOPE_A = "c5-m2-test-scope-a";
const SCOPE_B = "c5-m2-test-scope-b";
const IDENTITY_A = "c5-m2-test-identity-a";
const IDENTITY_A_OPTOUT = "c5-m2-test-identity-a-optout";
const IDENTITY_B = "c5-m2-test-identity-b";
const SEGMENT_A = "c5-m2-test-segment-a";
const SEGMENT_B = "c5-m2-test-segment-b";
const CAMPAIGN_B = "c5-m2-test-campaign-b";
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

async function cleanup(): Promise<void> {
  await prisma.broadcastAudienceMember.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.broadcastRun.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.contactSendFrequencyEvent.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.consentStateProjection.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.consentEvent.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.customerMessageTemplateVersion.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.customerMessageTemplate.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.campaign.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.segment.deleteMany({ where: { ownerId: { in: OWNERS } } });
  await prisma.contactIdentity.deleteMany({ where: { ownerId: { in: OWNERS } } });
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
        marketingConsent: "opt_out",
      },
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
      { id: IDENTITY_A_OPTOUT, ownerId: ORG_A, contactId: CONTACT_A_OPTOUT, channelScopeId: SCOPE_A, channel: "whatsapp", externalId: "+60111111112" },
      { id: IDENTITY_B, ownerId: ORG_B, contactId: CONTACT_B, channelScopeId: SCOPE_B, channel: "whatsapp", externalId: "+60222222222" },
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
      purpose: "marketing" as const,
      creationIdempotencyKey: "c5-m2-test-create-key-1",
    };
    const first = await broadcast.createBroadcastRun(owner, input);
    expect(first.duplicate).toBe(false);
    expect(first.resource).toMatchObject({ status: "draft", audienceRevision: 0, revision: 0 });

    const settled = await Promise.allSettled([
      broadcast.createBroadcastRun(owner, { ...input, creationIdempotencyKey: "c5-m2-test-create-key-2" }),
      broadcast.createBroadcastRun(owner, { ...input, creationIdempotencyKey: "c5-m2-test-create-key-2" }),
    ]);
    expect(settled.every((r) => r.status === "fulfilled")).toBe(true);
    expect(await ownerCounts()).toEqual({ runs: 2, members: 0 });
  });

  it("returns IDEMPOTENCY_CONFLICT when the same key is reused with a different payload", async () => {
    const key = "c5-m2-test-conflict-key";
    await broadcast.createBroadcastRun(owner, {
      channelScopeId: SCOPE_A,
      channel: "whatsapp",
      purpose: "marketing",
      creationIdempotencyKey: key,
    });
    await expectCode(
      broadcast.createBroadcastRun(owner, {
        channelScopeId: SCOPE_A,
        channel: "whatsapp",
        purpose: "review_request",
        creationIdempotencyKey: key,
      }),
      "IDEMPOTENCY_CONFLICT",
    );
  });

  it("rejects a foreign campaignId/templateVersionId as RESOURCE_NOT_FOUND, zero writes", async () => {
    const before = await ownerCounts();
    await expectCode(
      broadcast.createBroadcastRun(owner, {
        channelScopeId: SCOPE_A,
        channel: "whatsapp",
        purpose: "marketing",
        campaignId: CAMPAIGN_B,
        creationIdempotencyKey: "c5-m2-test-foreign-campaign",
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
          purpose: "marketing",
          creationIdempotencyKey: `c5-m2-test-rbac-${principal.membershipId}`,
        }),
        "ACTION_DENIED",
      );
    }
  });
});

describe("C5-M2 freezeAudience — unknown consent stays in audience, never culled", () => {
  it("includes both an unknown-consent contact and a known-opt-out-excluded-by-segment contact honestly", async () => {
    const run = await broadcast.createBroadcastRun(owner, {
      channelScopeId: SCOPE_A,
      channel: "whatsapp",
      purpose: "marketing",
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
      purpose: "marketing",
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
      purpose: "marketing",
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
      purpose: "marketing",
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
      where: { ownerId_contactId_channel_purpose: { ownerId: ORG_A, contactId: CONTACT_A, channel: "whatsapp", purpose: "marketing" } },
      data: { state: "effective_revoke" },
    });

    // The FROZEN row is untouched (point-in-time snapshot, display/audit only — §5.3).
    const stillFrozen = await broadcast.getBroadcastRun(owner, { broadcastRunId: run.resource.id });
    const staleMember = stillFrozen.members.find((m) => m.contactIdentityId === IDENTITY_A)!;
    expect((staleMember.eligibilityVerdictJson as { consentStop: { status: string } }).consentStop.status).toBe(
      "pass",
    );
    // A fresh preview (the live evaluator, exactly what any future execution step must call
    // instead of trusting the frozen row) correctly reflects the flip.
    const freshPreview = await broadcast.previewAudienceEligibility(owner, {
      segmentId: SEGMENT_A,
      channelScopeId: SCOPE_A,
      channel: "whatsapp",
      purpose: "marketing",
    });
    const freshMember = freshPreview.members.find((m) => m.contactIdentityId === IDENTITY_A)!;
    expect(freshMember.verdict.consentStop.status).toBe("block");
  });
});

describe("C5-M2 confirmBroadcastRun / cancelBroadcastRun lifecycle", () => {
  it("confirm requires audience_frozen; wrong status is denied", async () => {
    const run = await broadcast.createBroadcastRun(owner, {
      channelScopeId: SCOPE_A,
      channel: "whatsapp",
      purpose: "marketing",
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
      purpose: "marketing",
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
      purpose: "marketing",
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
        purpose: "marketing",
        creationIdempotencyKey: "c5-m2-test-b-run",
      },
    );
    for (const broadcastRunId of [foreignRun.resource.id, "c5-m2-test-missing-run"]) {
      await expectCode(broadcast.submitBroadcastRun(owner, { broadcastRunId }), "RESOURCE_NOT_FOUND");
    }
  });
});

describe("C5-M2 static no-second-send-path", () => {
  it("submitBroadcastRun is the only send chokepoint; no code path writes an M3-only status/sendState literal", () => {
    const source = readFileSync(path.join(__dirname, "../customer-broadcast-service.ts"), "utf8");
    // M2's frozen boundary (§10): real AND simulated sends are both out of scope. These
    // literals only ever become reachable once an M3-scope execute action exists.
    for (const forbidden of ['"executing"', '"completed"', '"simulated_sent"', '"send_unavailable"']) {
      expect(source).not.toContain(forbidden);
    }
    // Exactly one function fails with SEND_PATH_UNAVAILABLE, and it never reaches an adapter.
    const submitBody = source.slice(source.indexOf("async function submitBroadcastRun"));
    expect(submitBody).toContain("SEND_PATH_UNAVAILABLE");
    // "adapter." (a real property access / call) never appears — only the comment explaining
    // its deliberate absence, which reads "no adapter call" (no trailing dot) and must not
    // trip this check.
    expect(submitBody.slice(0, submitBody.indexOf("\n\n"))).not.toMatch(/adapter\s*\.|fetch\(|axios|http\.request/i);
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
        purpose: "marketing",
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
        purpose: "marketing",
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
      purpose: "marketing",
      creationIdempotencyKey: "c5-m2-test-gateway-create",
    });
    expect(result).toMatchObject({ ok: true, duplicate: false, resource: { status: "draft" } });
  });

  it("submitBroadcastRun stays hard-disabled through the gateway", async () => {
    const run = await customerBroadcastGateway.createBroadcastRun({
      channelScopeId: SCOPE_A,
      channel: "whatsapp",
      purpose: "marketing",
      creationIdempotencyKey: "c5-m2-test-gateway-submit",
    });
    await expect(
      customerBroadcastGateway.submitBroadcastRun({
        broadcastRunId: (run as { resource: { id: string } }).resource.id,
      }),
    ).resolves.toEqual({ ok: false, error: "SEND_PATH_UNAVAILABLE" });
  });
});
