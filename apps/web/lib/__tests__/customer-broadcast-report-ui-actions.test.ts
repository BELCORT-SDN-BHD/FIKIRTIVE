import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@fikirtive/db";
import * as customerBroadcastReportUiActions from "../customer-broadcast-report-ui-actions";
import { requireOwner } from "../auth-guard";

// C6-M3 (issue #412): prove the client-callable wrapper preserves the frozen report
// gateway's owner wall and result shapes, and cannot silently widen beyond its two reads.
vi.mock("../auth-guard", () => ({
  requireOwner: vi.fn(async () => ({
    email: "c6-m3-report-owner@example.test",
    ownerId: "c6-m3-report-org-a",
  })),
}));
vi.mock("../better-auth/compat", () => ({
  isImpersonating: vi.fn(async () => false),
}));

const ORG_A = "c6-m3-report-org-a";
const USER_OWNER = "c6-m3-report-user-owner";
const OWNER = "c6-m3-report-membership-owner";
const SCOPE_A = "c6-m3-report-scope-a";
const CONTACT_A = "c6-m3-report-contact-a";
const IDENTITY_A = "c6-m3-report-identity-a";
const RUN_A = "c6-m3-report-run-a";
const AUDIENCE_A = "c6-m3-report-audience-a";
const NOW = new Date("2026-07-22T12:00:00.000Z");

async function cleanup(): Promise<void> {
  await prisma.messageDeliveryState.deleteMany({ where: { ownerId: ORG_A } });
  await prisma.messageDeliveryEvent.deleteMany({ where: { ownerId: ORG_A } });
  await prisma.contactSendFrequencyEvent.deleteMany({ where: { ownerId: ORG_A } });
  await prisma.broadcastAudienceMember.deleteMany({ where: { ownerId: ORG_A } });
  await prisma.broadcastRun.deleteMany({ where: { ownerId: ORG_A } });
  await prisma.contactIdentity.deleteMany({ where: { ownerId: ORG_A } });
  await prisma.channelScope.deleteMany({ where: { ownerId: ORG_A } });
  await prisma.contact.deleteMany({ where: { ownerId: ORG_A } });
  await prisma.membership.deleteMany({ where: { orgId: ORG_A } });
  await prisma.organization.deleteMany({ where: { id: ORG_A } });
  await prisma.user.deleteMany({ where: { id: USER_OWNER } });
}

async function seed(): Promise<void> {
  await prisma.organization.create({ data: { id: ORG_A } });
  await prisma.user.create({ data: { id: USER_OWNER, email: "c6-m3-report-owner@example.test" } });
  await prisma.membership.create({
    data: { id: OWNER, userId: USER_OWNER, orgId: ORG_A, role: "owner" },
  });
  await prisma.channelScope.create({
    data: { id: SCOPE_A, ownerId: ORG_A, channel: "whatsapp", scopeKey: "c6-m3-report-waba-a" },
  });
  await prisma.contact.create({
    data: {
      id: CONTACT_A,
      ownerId: ORG_A,
      name: "Aisyah",
      source: "whatsapp",
      firstTouchAt: NOW,
      lastSeenAt: NOW,
    },
  });
  await prisma.contactIdentity.create({
    data: {
      id: IDENTITY_A,
      ownerId: ORG_A,
      contactId: CONTACT_A,
      channelScopeId: SCOPE_A,
      channel: "whatsapp",
      externalId: "c6-m3-report-recipient-a",
    },
  });
  await prisma.broadcastRun.create({
    data: {
      id: RUN_A,
      ownerId: ORG_A,
      channelScopeId: SCOPE_A,
      channel: "whatsapp",
      purpose: "marketing",
      status: "completed",
      audienceRevision: 1,
      revision: 3,
      creationIdempotencyKey: "c6-m3-report-create-a",
      createdByMembershipId: OWNER,
      frozenAt: NOW,
      confirmedAt: NOW,
      executedAt: NOW,
    },
  });
  await prisma.broadcastAudienceMember.create({
    data: {
      id: AUDIENCE_A,
      ownerId: ORG_A,
      broadcastRunId: RUN_A,
      contactId: CONTACT_A,
      contactIdentityId: IDENTITY_A,
      audienceRevision: 1,
      eligibilityVerdictJson: {},
      verdictHash: "c6-m3-report-verdict-a",
      includedByMerchant: true,
      sendState: "simulated_sent",
    },
  });
}

describe("customer-broadcast-report-ui-actions pass-through", () => {
  beforeEach(async () => {
    await cleanup();
    await seed();
    vi.clearAllMocks();
  });

  afterAll(cleanup);

  it("passes the three separate aggregate axes through verbatim", async () => {
    const result = await customerBroadcastReportUiActions.getCustomerBroadcastReport({
      broadcastRunId: RUN_A,
    });
    expect(result).toMatchObject({
      ok: true,
      resource: {
        broadcastRunId: RUN_A,
        simulatedEra: true,
        sending: { attempted: { status: "known", value: 1 } },
        delivery: {
          delivered: { status: "unknown", value: null },
          read: { status: "unknown", value: null },
          failed: { status: "unknown", value: null },
        },
        reconciliation: { pending: { status: "known", value: 1 } },
      },
    });
  });

  it("passes a simulated per-recipient receipt through verbatim", async () => {
    const result = await customerBroadcastReportUiActions.getBroadcastDeliveryReceipt({
      broadcastRunId: RUN_A,
      audienceMemberId: AUDIENCE_A,
    });
    expect(result).toMatchObject({
      ok: true,
      resource: {
        logicalSendRef: AUDIENCE_A,
        lifecycle: "unknown",
        reconciliation: "pending",
        simulatedAttempt: true,
        lastProviderEventAt: null,
      },
    });
  });

  it("passes structured not-found and authorization failures through verbatim", async () => {
    await expect(
      customerBroadcastReportUiActions.getCustomerBroadcastReport({ broadcastRunId: "missing" }),
    ).resolves.toEqual({ ok: false, error: "RESOURCE_NOT_FOUND" });

    vi.mocked(requireOwner).mockResolvedValueOnce({ error: "Not authorized." });
    await expect(
      customerBroadcastReportUiActions.getCustomerBroadcastReport({ broadcastRunId: RUN_A }),
    ).resolves.toEqual({ ok: false, error: "NOT_AUTHORIZED" });
  });

});

describe("customer-broadcast-report-ui-actions surface", () => {
  it("exposes only the two frozen report reads, under their exact names", () => {
    const approvedExports = ["getBroadcastDeliveryReceipt", "getCustomerBroadcastReport"].sort();
    expect(Object.keys(customerBroadcastReportUiActions).sort()).toEqual(approvedExports);

    const sourcePath = path.resolve(__dirname, "../customer-broadcast-report-ui-actions.ts");
    const source = fs.readFileSync(sourcePath, "utf8");
    const gatewayImports = [
      ...source.matchAll(
        /import\s*\{([^}]*)\}\s*from\s*["']\.\/customer-broadcast-report-gateway["']/g,
      ),
    ];
    expect(gatewayImports).toHaveLength(1);
    const importedNames = gatewayImports.flatMap((match) =>
      match[1]!
        .split(",")
        .map((specifier) => specifier.trim())
        .filter(Boolean)
        .map((specifier) => specifier.split(/\s+as\s+/)[0]!.trim()),
    );
    expect(importedNames.sort()).toEqual(approvedExports);
  });
});
