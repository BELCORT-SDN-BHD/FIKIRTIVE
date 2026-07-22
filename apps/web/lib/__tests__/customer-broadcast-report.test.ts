import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@fikirtive/db";
import * as customerBroadcastReportGateway from "../customer-broadcast-report-gateway";
import {
  createCustomerBroadcastReportService,
  type CustomerBroadcastReportPrincipal,
} from "../customer-broadcast-report-service";
import { requireOwner } from "../auth-guard";
import { isImpersonating } from "../better-auth/compat";

vi.mock("../auth-guard", () => ({
  requireOwner: vi.fn(async () => ({
    email: "c6-m2-owner-a@example.test",
    ownerId: "c6-m2-org-a",
  })),
}));

vi.mock("../better-auth/compat", () => ({
  isImpersonating: vi.fn(async () => false),
}));

const NOW = new Date("2026-07-22T10:00:00.000Z");
const ORG_A = "c6-m2-org-a";
const ORG_B = "c6-m2-org-b";
const USER_OWNER_A = "c6-m2-user-owner-a";
const USER_ADMIN_A = "c6-m2-user-admin-a";
const USER_MEMBER_A = "c6-m2-user-member-a";
const USER_OWNER_B = "c6-m2-user-owner-b";
const OWNER_A = "c6-m2-membership-owner-a";
const ADMIN_A = "c6-m2-membership-admin-a";
const MEMBER_A = "c6-m2-membership-member-a";
const OWNER_B = "c6-m2-membership-owner-b";
const SCOPE_A = "c6-m2-scope-a";
const SCOPE_B = "c6-m2-scope-b";
const CONNECTION_B = "c6-m2-connection-b";
const RUN_A = "c6-m2-run-a";
const RUN_B = "c6-m2-run-b";
const CONTACT_ATTEMPTED = "c6-m2-contact-attempted";
const CONTACT_PENDING = "c6-m2-contact-pending";
const CONTACT_SKIPPED = "c6-m2-contact-skipped";
const CONTACT_UNAVAILABLE = "c6-m2-contact-unavailable";
const CONTACT_B = "c6-m2-contact-b";
const IDENTITY_ATTEMPTED = "c6-m2-identity-attempted";
const IDENTITY_PENDING = "c6-m2-identity-pending";
const IDENTITY_SKIPPED = "c6-m2-identity-skipped";
const IDENTITY_UNAVAILABLE = "c6-m2-identity-unavailable";
const IDENTITY_B = "c6-m2-identity-b";
const AUDIENCE_ATTEMPTED = "c6-m2-audience-attempted";
const AUDIENCE_PENDING = "c6-m2-audience-pending";
const AUDIENCE_SKIPPED = "c6-m2-audience-skipped";
const AUDIENCE_UNAVAILABLE = "c6-m2-audience-unavailable";
const AUDIENCE_B = "c6-m2-audience-b";
const FOREIGN_EVENT = "c6-m2-foreign-event";
const OWNER_IDS = [ORG_A, ORG_B];

const owner: CustomerBroadcastReportPrincipal = {
  ownerId: ORG_A,
  membershipId: OWNER_A,
  impersonating: false,
};
const admin: CustomerBroadcastReportPrincipal = {
  ownerId: ORG_A,
  membershipId: ADMIN_A,
  impersonating: false,
};
const member: CustomerBroadcastReportPrincipal = {
  ownerId: ORG_A,
  membershipId: MEMBER_A,
  impersonating: false,
};

const reportService = createCustomerBroadcastReportService({ clock: () => NOW });

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
  await prisma.messageDeliveryState.deleteMany({ where: { ownerId: { in: OWNER_IDS } } });
  await prisma.messageDeliveryEvent.deleteMany({ where: { ownerId: { in: OWNER_IDS } } });
  await prisma.contactSendFrequencyEvent.deleteMany({ where: { ownerId: { in: OWNER_IDS } } });
  await prisma.broadcastAudienceMember.deleteMany({ where: { ownerId: { in: OWNER_IDS } } });
  await prisma.broadcastRun.deleteMany({ where: { ownerId: { in: OWNER_IDS } } });
  await prisma.channelConnection.deleteMany({ where: { ownerId: { in: OWNER_IDS } } });
  await prisma.contactIdentity.deleteMany({ where: { ownerId: { in: OWNER_IDS } } });
  await prisma.channelScope.deleteMany({ where: { ownerId: { in: OWNER_IDS } } });
  await prisma.contact.deleteMany({ where: { ownerId: { in: OWNER_IDS } } });
  await prisma.membership.deleteMany({ where: { orgId: { in: OWNER_IDS } } });
  await prisma.organization.deleteMany({ where: { id: { in: OWNER_IDS } } });
  await prisma.user.deleteMany({
    where: { id: { in: [USER_OWNER_A, USER_ADMIN_A, USER_MEMBER_A, USER_OWNER_B] } },
  });
}

async function seed(): Promise<void> {
  await prisma.organization.createMany({ data: [{ id: ORG_A }, { id: ORG_B }] });
  await prisma.user.createMany({
    data: [
      { id: USER_OWNER_A, email: "c6-m2-owner-a@example.test" },
      { id: USER_ADMIN_A, email: "c6-m2-admin-a@example.test" },
      { id: USER_MEMBER_A, email: "c6-m2-member-a@example.test" },
      { id: USER_OWNER_B, email: "c6-m2-owner-b@example.test" },
    ],
  });
  await prisma.membership.createMany({
    data: [
      { id: OWNER_A, userId: USER_OWNER_A, orgId: ORG_A, role: "owner" },
      { id: ADMIN_A, userId: USER_ADMIN_A, orgId: ORG_A, role: "admin" },
      { id: MEMBER_A, userId: USER_MEMBER_A, orgId: ORG_A, role: "member" },
      { id: OWNER_B, userId: USER_OWNER_B, orgId: ORG_B, role: "owner" },
    ],
  });
  await prisma.channelScope.createMany({
    data: [
      { id: SCOPE_A, ownerId: ORG_A, channel: "whatsapp", scopeKey: "c6-m2-waba-a" },
      { id: SCOPE_B, ownerId: ORG_B, channel: "whatsapp", scopeKey: "c6-m2-waba-b" },
    ],
  });
  await prisma.channelConnection.create({
    data: {
      id: CONNECTION_B,
      ownerId: ORG_B,
      kind: "whatsapp",
      channelScopeId: SCOPE_B,
      externalId: "c6-m2-external-b",
      accessTokenEnc: "c6-m2-ciphertext-b",
    },
  });

  const contacts = [
    [CONTACT_ATTEMPTED, ORG_A, "Attempted"],
    [CONTACT_PENDING, ORG_A, "Pending"],
    [CONTACT_SKIPPED, ORG_A, "Skipped"],
    [CONTACT_UNAVAILABLE, ORG_A, "Unavailable"],
    [CONTACT_B, ORG_B, "Foreign"],
  ] as const;
  await prisma.contact.createMany({
    data: contacts.map(([id, ownerId, name]) => ({
      id,
      ownerId,
      name,
      source: "whatsapp",
      firstTouchAt: NOW,
      lastSeenAt: NOW,
    })),
  });

  const identities = [
    [IDENTITY_ATTEMPTED, ORG_A, CONTACT_ATTEMPTED, SCOPE_A, "contact-attempted"],
    [IDENTITY_PENDING, ORG_A, CONTACT_PENDING, SCOPE_A, "contact-pending"],
    [IDENTITY_SKIPPED, ORG_A, CONTACT_SKIPPED, SCOPE_A, "contact-skipped"],
    [IDENTITY_UNAVAILABLE, ORG_A, CONTACT_UNAVAILABLE, SCOPE_A, "contact-unavailable"],
    [IDENTITY_B, ORG_B, CONTACT_B, SCOPE_B, "contact-b"],
  ] as const;
  await prisma.contactIdentity.createMany({
    data: identities.map(([id, ownerId, contactId, channelScopeId, externalId]) => ({
      id,
      ownerId,
      contactId,
      channelScopeId,
      channel: "whatsapp",
      externalId,
    })),
  });

  await prisma.broadcastRun.createMany({
    data: [
      {
        id: RUN_A,
        ownerId: ORG_A,
        channelScopeId: SCOPE_A,
        channel: "whatsapp",
        purpose: "marketing",
        status: "completed",
        audienceRevision: 1,
        revision: 3,
        creationIdempotencyKey: "c6-m2-run-a-create",
        createdByMembershipId: OWNER_A,
        frozenAt: NOW,
        confirmedAt: NOW,
        executedAt: NOW,
      },
      {
        id: RUN_B,
        ownerId: ORG_B,
        channelScopeId: SCOPE_B,
        channel: "whatsapp",
        purpose: "marketing",
        status: "completed",
        audienceRevision: 1,
        revision: 3,
        creationIdempotencyKey: "c6-m2-run-b-create",
        createdByMembershipId: OWNER_B,
        frozenAt: NOW,
        confirmedAt: NOW,
        executedAt: NOW,
      },
    ],
  });

  const audience = [
    [AUDIENCE_ATTEMPTED, ORG_A, RUN_A, CONTACT_ATTEMPTED, IDENTITY_ATTEMPTED, "simulated_sent", null],
    [AUDIENCE_PENDING, ORG_A, RUN_A, CONTACT_PENDING, IDENTITY_PENDING, "pending", null],
    [
      AUDIENCE_SKIPPED,
      ORG_A,
      RUN_A,
      CONTACT_SKIPPED,
      IDENTITY_SKIPPED,
      "skipped_ineligible",
      "consentStop:effective_revoke",
    ],
    [
      AUDIENCE_UNAVAILABLE,
      ORG_A,
      RUN_A,
      CONTACT_UNAVAILABLE,
      IDENTITY_UNAVAILABLE,
      "send_unavailable",
      null,
    ],
    [AUDIENCE_B, ORG_B, RUN_B, CONTACT_B, IDENTITY_B, "simulated_sent", null],
  ] as const;
  await prisma.broadcastAudienceMember.createMany({
    data: audience.map(([id, ownerId, broadcastRunId, contactId, contactIdentityId, sendState, skipReason]) => ({
      id,
      ownerId,
      broadcastRunId,
      contactId,
      contactIdentityId,
      audienceRevision: 1,
      eligibilityVerdictJson: {},
      verdictHash: `c6-m2-verdict-${id}`,
      includedByMerchant: true,
      sendState,
      skipReason,
    })),
  });

  await prisma.messageDeliveryEvent.create({
    data: {
      id: FOREIGN_EVENT,
      ownerId: ORG_B,
      logicalSendRef: AUDIENCE_ATTEMPTED,
      channelScopeId: SCOPE_B,
      channel: "whatsapp",
      providerConnectionId: CONNECTION_B,
      factKind: "read",
      providerCode: "c6-m2-foreign-read",
      externalMessageRef: "c6-m2-foreign-message",
      receiptRef: "c6-m2-foreign-receipt",
      actorKind: "provider",
      sourceEventKey: "delivery_changed:c6-m2-foreign-event",
      sourcePayloadHash: "v1:c6-m2-foreign-hash",
      occurredAt: NOW,
      receivedAt: NOW,
    },
  });
  await prisma.messageDeliveryState.create({
    data: {
      ownerId: ORG_B,
      logicalSendRef: AUDIENCE_ATTEMPTED,
      lifecycle: "read",
      reconciliation: "converged",
      lastEventId: FOREIGN_EVENT,
      lastProviderEventAt: NOW,
      lastReconciledAt: NOW,
    },
  });
}

async function rowCounts() {
  const [runs, members, frequencies, events, states] = await Promise.all([
    prisma.broadcastRun.count({ where: { ownerId: { in: OWNER_IDS } } }),
    prisma.broadcastAudienceMember.count({ where: { ownerId: { in: OWNER_IDS } } }),
    prisma.contactSendFrequencyEvent.count({ where: { ownerId: { in: OWNER_IDS } } }),
    prisma.messageDeliveryEvent.count({ where: { ownerId: { in: OWNER_IDS } } }),
    prisma.messageDeliveryState.count({ where: { ownerId: { in: OWNER_IDS } } }),
  ]);
  return { runs, members, frequencies, events, states };
}

beforeEach(async () => {
  await cleanup();
  await seed();
  vi.clearAllMocks();
});

afterAll(cleanup);

describe("C6-M2 truthful simulated-era reads", () => {
  it("keeps A/B/C axes separate, reports delivery unknown, and performs zero writes or external calls", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const before = await rowCounts();
    try {
      const report = await reportService.getCustomerBroadcastReport(owner, { broadcastRunId: RUN_A });
      expect(report.sending).toMatchObject({
        attempted: { status: "known", value: 1 },
        pending: { status: "known", value: 1 },
        skipped: {
          status: "known",
          value: 1,
          byReason: { "consentStop:effective_revoke": 1 },
        },
        unavailable: { status: "known", value: 1 },
      });
      expect(report.delivery).toMatchObject({
        delivered: { status: "unknown", value: null },
        read: { status: "unknown", value: null },
        failed: { status: "unknown", value: null },
      });
      expect(report.reconciliation).toMatchObject({
        pending: { status: "known", value: 1 },
        conflict: { status: "known", value: 0 },
        timeoutUnknown: { status: "known", value: 0 },
      });
      expect(report.replyRate).toEqual({ status: "deferred", value: null });
      expect(report.delivery.freshness.lastProviderEventAt).toBeNull();
      expect(report.reconciliation.freshness.lastReconciledAt).toBe(NOW.toISOString());
      expect(JSON.stringify(report)).not.toContain("c6-m2-foreign-receipt");

      const receipt = await reportService.getBroadcastDeliveryReceipt(owner, {
        broadcastRunId: RUN_A,
        audienceMemberId: AUDIENCE_ATTEMPTED,
      });
      expect(receipt).toMatchObject({
        logicalSendRef: AUDIENCE_ATTEMPTED,
        lifecycle: "unknown",
        reconciliation: "pending",
        simulatedAttempt: true,
        lastProviderEventAt: null,
        lastReconciledAt: NOW.toISOString(),
      });
      expect(await rowCounts()).toEqual(before);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("filters by an owner-scoped contact without recomputing the sending axes", async () => {
    const report = await reportService.getCustomerBroadcastReport(owner, {
      broadcastRunId: RUN_A,
      contactId: CONTACT_ATTEMPTED,
    });
    expect(report.contactId).toBe(CONTACT_ATTEMPTED);
    expect(report.sending).toMatchObject({
      attempted: { status: "known", value: 1 },
      pending: { status: "known", value: 0 },
      skipped: { status: "known", value: 0, byReason: {} },
      unavailable: { status: "known", value: 0 },
    });
    expect(report.delivery.delivered).toEqual({ status: "unknown", value: null });
  });
});

describe("C6-M2 owner-only and adversarial tenant boundary", () => {
  it("default-denies admin, member, and impersonating owner principals", async () => {
    const before = await rowCounts();
    for (const principal of [admin, member, { ...owner, impersonating: true }]) {
      await expectCode(
        reportService.getCustomerBroadcastReport(principal, { broadcastRunId: RUN_A }),
        "ACTION_DENIED",
      );
    }
    expect(await rowCounts()).toEqual(before);
  });

  it("makes foreign and missing run, audience-member, and contact identifiers indistinguishable", async () => {
    const before = await rowCounts();
    for (const broadcastRunId of [RUN_B, "c6-m2-missing-run"]) {
      await expectCode(
        reportService.getCustomerBroadcastReport(owner, { broadcastRunId }),
        "RESOURCE_NOT_FOUND",
      );
    }
    for (const audienceMemberId of [AUDIENCE_B, "c6-m2-missing-audience"]) {
      await expectCode(
        reportService.getBroadcastDeliveryReceipt(owner, {
          broadcastRunId: RUN_A,
          audienceMemberId,
        }),
        "RESOURCE_NOT_FOUND",
      );
    }
    for (const contactId of [CONTACT_B, "c6-m2-missing-contact"]) {
      await expectCode(
        reportService.getCustomerBroadcastReport(owner, { broadcastRunId: RUN_A, contactId }),
        "RESOURCE_NOT_FOUND",
      );
    }
    expect(await rowCounts()).toEqual(before);
  });

  it("rejects caller-supplied owner, logical-send, and state selectors before any resource read", async () => {
    const before = await rowCounts();
    for (const input of [
      { broadcastRunId: RUN_A, ownerId: ORG_B },
      { broadcastRunId: RUN_A, logicalSendRef: AUDIENCE_B },
      { broadcastRunId: RUN_A, messageDeliveryStateId: AUDIENCE_B },
    ]) {
      await expectCode(
        reportService.getCustomerBroadcastReport(owner, input as { broadcastRunId: string }),
        "INVALID_ARGUMENT",
      );
    }
    expect(await rowCounts()).toEqual(before);
  });
});

describe("C6-M2 report gateway identity derivation", () => {
  it("maps missing session identity and non-owner membership to stable failures", async () => {
    const mockedRequireOwner = vi.mocked(requireOwner);
    mockedRequireOwner.mockResolvedValueOnce({ error: "Not authorized." });
    await expect(customerBroadcastReportGateway.getCustomerBroadcastReport({ broadcastRunId: RUN_A })).resolves.toEqual({
      ok: false,
      error: "NOT_AUTHORIZED",
    });

    mockedRequireOwner.mockResolvedValueOnce({ email: "c6-m2-admin-a@example.test", ownerId: ORG_A });
    await expect(customerBroadcastReportGateway.getCustomerBroadcastReport({ broadcastRunId: RUN_A })).resolves.toEqual({
      ok: false,
      error: "ACTION_DENIED",
    });
  });

  it("returns an owner-scoped report and denies an impersonating owner", async () => {
    const mockedImpersonating = vi.mocked(isImpersonating);
    const result = await customerBroadcastReportGateway.getCustomerBroadcastReport({ broadcastRunId: RUN_A });
    expect(result).toMatchObject({
      ok: true,
      resource: {
        broadcastRunId: RUN_A,
        sending: { attempted: { status: "known", value: 1 } },
        delivery: { delivered: { status: "unknown", value: null } },
      },
    });

    mockedImpersonating.mockResolvedValueOnce(true);
    await expect(customerBroadcastReportGateway.getBroadcastDeliveryReceipt({
      broadcastRunId: RUN_A,
      audienceMemberId: AUDIENCE_ATTEMPTED,
    })).resolves.toEqual({ ok: false, error: "ACTION_DENIED" });
  });
});
