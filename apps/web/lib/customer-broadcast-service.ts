import "server-only";

import { createHash } from "node:crypto";
import { newId } from "@fikirtive/core";
import { contactMatchesRules, validateSegmentRuleGroup, type SegmentContactFacts } from "@fikirtive/core";
import {
  evaluateSendEligibility,
  prisma as defaultDb,
  type Prisma,
  type SendEligibilityResult,
} from "@fikirtive/db";

/**
 * C5-M2 broadcast domain actions. Spec:
 * docs/superpowers/specs/2026-07-21-c5-broadcast-eligibility-physical-contract.md §6/§10.
 *
 * SCOPE NOTE (read before extending this file): §10's M2 boundary is explicit —
 * "实现 submitBroadcastRun 域动作（建/冻结受众/confirm + 冻结 verdict 快照），但执行/发送保持
 * SEND_PATH_UNAVAILABLE（真实与模拟都不发）" and the M2 "不做" list names "真实/模拟发送" — BOTH
 * real AND simulated sends are out of scope until M3. BroadcastRun.status's
 * executing/completed values and BroadcastAudienceMember.sendState's simulated_sent value are
 * therefore UNREACHABLE from this file by design (only draft/audience_frozen/confirmed/
 * cancelled are ever written here) — see the M2 worker report for the full deviation note
 * against a task brief that additionally asked for an M3-scope executeBroadcastRun mutation.
 *
 * RBAC NOTE: §14.2 lists "C5 broadcast creator/approver/org-role 的 exact capability matrix"
 * as Founder-Unknown, with an explicit instruction: "未决期间所有 mutation default deny". Every
 * mutation below is therefore restricted to role "owner" ONLY (the most conservative
 * available choice) until the Founder decides the real matrix — see the M2 worker report.
 * Reads stay open to every active role, matching customer-inbox-service.ts's read pattern
 * (the "default deny" instruction is scoped to "mutation" only).
 */

export const CUSTOMER_BROADCAST_ERROR_CODES = {
  NOT_AUTHORIZED: "NOT_AUTHORIZED",
  ACTION_DENIED: "ACTION_DENIED",
  RESOURCE_NOT_FOUND: "RESOURCE_NOT_FOUND",
  CAS_CONFLICT: "CAS_CONFLICT",
  IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_CONFLICT",
  SEND_PATH_UNAVAILABLE: "SEND_PATH_UNAVAILABLE",
  INVALID_ARGUMENT: "INVALID_ARGUMENT",
} as const;

export type CustomerBroadcastErrorCode =
  (typeof CUSTOMER_BROADCAST_ERROR_CODES)[keyof typeof CUSTOMER_BROADCAST_ERROR_CODES];

export class CustomerBroadcastError extends Error {
  constructor(public readonly code: CustomerBroadcastErrorCode) {
    super(code);
    this.name = "CustomerBroadcastError";
  }
}

export type CustomerBroadcastPrincipal = {
  ownerId: string;
  membershipId: string;
  impersonating?: boolean;
};

/** The two proactive purposes a broadcast run may ever carry (§5.2; transactional never broadcasts). */
const BROADCAST_PURPOSES = ["marketing", "review_request"] as const;
export type BroadcastPurpose = (typeof BROADCAST_PURPOSES)[number];

const BROADCAST_STATUSES_ALLOWING_FREEZE = new Set(["draft", "audience_frozen"]);
const BROADCAST_STATUSES_ALLOWING_CONFIRM = new Set(["audience_frozen"]);
const BROADCAST_STATUSES_ALLOWING_CANCEL = new Set(["draft", "audience_frozen", "confirmed"]);

type ActiveRole = "owner" | "admin" | "member";
type DatabaseClient = typeof defaultDb | Prisma.TransactionClient;

const ACTIVE_ROLES = new Set<ActiveRole>(["owner", "admin", "member"]);
const MAX_TEXT = 512;
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;
const TOKEN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export type ListBroadcastRunsInput = { limit?: number };
export type BroadcastRunIdInput = { broadcastRunId: string };

export type CreateBroadcastRunInput = {
  channelScopeId: string;
  channel: string;
  purpose: BroadcastPurpose;
  campaignId?: string | null;
  templateVersionId?: string | null;
  creationIdempotencyKey: string;
};

export type FreezeAudienceInput = {
  broadcastRunId: string;
  expectedRevision: number;
  segmentId: string;
};

export type ConfirmBroadcastRunInput = { broadcastRunId: string; expectedRevision: number };
export type CancelBroadcastRunInput = { broadcastRunId: string; expectedRevision: number };
export type SubmitBroadcastRunInput = { broadcastRunId: string };

export type PreviewAudienceEligibilityInput = {
  segmentId: string;
  channelScopeId: string;
  channel: string;
  purpose: BroadcastPurpose;
  limit?: number;
};

type AudienceCandidate = {
  contactId: string;
  contactIdentityId: string;
};

function fail(code: CustomerBroadcastErrorCode): never {
  throw new CustomerBroadcastError(code);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function requiredString(value: unknown, max: number): string {
  if (!isNonEmptyString(value) || value.length > max) fail("INVALID_ARGUMENT");
  return (value as string).trim();
}

function requiredToken(value: unknown, max: number): string {
  const text = requiredString(value, max);
  if (!TOKEN.test(text)) fail("INVALID_ARGUMENT");
  return text;
}

function optionalString(value: unknown, max: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  return requiredString(value, max);
}

function requiredPurpose(value: unknown): BroadcastPurpose {
  if (!(BROADCAST_PURPOSES as readonly string[]).includes(value as string)) fail("INVALID_ARGUMENT");
  return value as BroadcastPurpose;
}

function revision(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0) fail("INVALID_ARGUMENT");
  return value as number;
}

function limit(value: unknown, fallback = DEFAULT_LIMIT): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > MAX_LIMIT) {
    fail("INVALID_ARGUMENT");
  }
  return value as number;
}

function prismaCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function verdictHash(verdict: unknown): string {
  return createHash("sha256").update("c5-eligibility-verdict:v1\0").update(JSON.stringify(verdict)).digest("hex");
}

function asConsent(value: string): SegmentContactFacts["marketingConsent"] {
  return value === "opt_in" || value === "opt_out" || value === "unknown" ? value : undefined;
}

export function createCustomerBroadcastService(
  options: {
    db?: typeof defaultDb;
    clock?: () => Date;
    id?: () => string;
  } = {},
) {
  const db = options.db ?? defaultDb;
  const clock = options.clock ?? (() => new Date());
  const issueId = options.id ?? newId;
  const now = () => new Date(clock().getTime());

  async function activeMembership(
    client: DatabaseClient,
    principal: CustomerBroadcastPrincipal,
  ): Promise<{ id: string; role: ActiveRole } | null> {
    if (!isNonEmptyString(principal?.ownerId) || !isNonEmptyString(principal?.membershipId)) {
      fail("NOT_AUTHORIZED");
    }
    const row = await client.membership.findFirst({
      where: { id: principal.membershipId, orgId: principal.ownerId, status: "active", deletedAt: null },
      select: { id: true, role: true },
    });
    if (!row || !ACTIVE_ROLES.has(row.role as ActiveRole)) return null;
    return { id: row.id, role: row.role as ActiveRole };
  }

  async function requireReadMembership(
    principal: CustomerBroadcastPrincipal,
  ): Promise<{ id: string; role: ActiveRole }> {
    const membership = await activeMembership(db, principal);
    if (!membership) fail("ACTION_DENIED");
    return membership;
  }

  /**
   * Every C5 mutation is owner-only pending the Founder's real capability matrix (§14.2
   * "default deny"). Impersonating sessions are read-only surfaces generally, but since even
   * an owner impersonation session should not spend a broadcast mutation, this denies it too
   * — matching customer-inbox-service.ts's IMPERSONATION_READ_ONLY intent via ACTION_DENIED
   * (this file does not carry the audit-log surface inbox uses, so it fails closed instead).
   */
  async function requireOwnerMutationMembership(
    principal: CustomerBroadcastPrincipal,
  ): Promise<{ id: string; role: ActiveRole }> {
    const membership = await activeMembership(db, principal);
    if (!membership || membership.role !== "owner") fail("ACTION_DENIED");
    if (principal.impersonating) fail("ACTION_DENIED");
    return membership;
  }

  async function requireBroadcastRun(client: DatabaseClient, ownerId: string, broadcastRunId: string) {
    const row = await client.broadcastRun.findFirst({ where: { id: broadcastRunId, ownerId } });
    if (!row) fail("RESOURCE_NOT_FOUND");
    return row;
  }

  async function resolveProviderConnectionId(
    client: DatabaseClient,
    ownerId: string,
    channelScopeId: string,
    channel: string,
  ): Promise<string | null> {
    const connection = await client.channelConnection.findFirst({
      where: { ownerId, channelScopeId, kind: channel },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    return connection?.id ?? null;
  }

  /**
   * Live segment-audience resolution shared by previewAudienceEligibility (no writes) and
   * freezeAudience (writes a frozen snapshot). Mirrors segment-actions.ts's contact/segment
   * matching (contactMatchesRules from @fikirtive/core) but is re-implemented locally: this
   * file's allowed surface does not include segment-actions.ts, and the two callers need the
   * result paired with per-identity eligibility rather than segment-actions.ts's aggregate
   * counts.
   */
  async function resolveSegmentAudience(
    client: DatabaseClient,
    ownerId: string,
    segmentId: string,
    channel: string,
  ): Promise<AudienceCandidate[]> {
    const segment = await client.segment.findFirst({
      where: { id: segmentId, ownerId, deletedAt: null },
      select: { rulesJson: true },
    });
    if (!segment) fail("RESOURCE_NOT_FOUND");
    const validated = validateSegmentRuleGroup(segment.rulesJson);
    if (!validated.ok) fail("INVALID_ARGUMENT");

    const contacts = await client.contact.findMany({
      where: { ownerId, deletedAt: null },
      select: {
        id: true,
        totalOrdersMyr: true,
        marketingConsent: true,
        doNotDisturb: true,
        identities: { where: { ownerId, channel, deletedAt: null }, select: { id: true, channel: true } },
      },
    });

    const evaluatedAt = now().toISOString();
    const candidates: AudienceCandidate[] = [];
    for (const contact of contacts) {
      const marketingConsent = asConsent(contact.marketingConsent) ?? "unknown";
      // Audience selection (not a send gate): unknown consent stays included (B0-44), only a
      // known opt-out is excluded from this segment-matching estimate. DND never filters here
      // — it is a separate axis the frozen verdict snapshot below carries honestly.
      const contactable = marketingConsent !== "opt_out";
      const facts: SegmentContactFacts = {
        lifetimeSpendMyr:
          contact.totalOrdersMyr === null || contact.totalOrdersMyr === undefined
            ? undefined
            : Number(contact.totalOrdersMyr),
        channels: [channel],
        marketingConsent: contactable ? "opt_in" : "opt_out",
        doNotDisturb: false,
      };
      if (!contactMatchesRules(facts, validated.value, { evaluatedAt })) continue;
      for (const identity of contact.identities) {
        candidates.push({ contactId: contact.id, contactIdentityId: identity.id });
      }
    }
    return candidates;
  }

  async function listBroadcastRuns(
    principal: CustomerBroadcastPrincipal,
    input: ListBroadcastRunsInput = {},
  ) {
    await requireReadMembership(principal);
    const take = limit(input.limit);
    return db.broadcastRun.findMany({
      where: { ownerId: principal.ownerId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
    });
  }

  async function getBroadcastRun(principal: CustomerBroadcastPrincipal, input: BroadcastRunIdInput) {
    await requireReadMembership(principal);
    const broadcastRunId = requiredString(input?.broadcastRunId, MAX_TEXT);
    const run = await requireBroadcastRun(db, principal.ownerId, broadcastRunId);
    const members = await db.broadcastAudienceMember.findMany({
      where: { ownerId: principal.ownerId, broadcastRunId },
      orderBy: [{ id: "asc" }],
    });
    return { run, members };
  }

  /**
   * READ-ONLY: evaluates a segment's contacts against the live four-axis evaluator without
   * writing anything (§3.2: previewing never manufactures consent or a snapshot). Unknown
   * consent stays in the returned audience, flagged via the verdict itself — never excluded.
   */
  async function previewAudienceEligibility(
    principal: CustomerBroadcastPrincipal,
    input: PreviewAudienceEligibilityInput,
  ) {
    await requireReadMembership(principal);
    const segmentId = requiredString(input?.segmentId, MAX_TEXT);
    const channelScopeId = requiredString(input?.channelScopeId, MAX_TEXT);
    const channel = requiredToken(input?.channel, 64);
    const purpose = requiredPurpose(input?.purpose);
    const take = limit(input?.limit);

    const scope = await db.channelScope.findFirst({
      where: { id: channelScopeId, ownerId: principal.ownerId, channel },
      select: { id: true },
    });
    if (!scope) fail("RESOURCE_NOT_FOUND");

    const candidates = (await resolveSegmentAudience(db, principal.ownerId, segmentId, channel)).slice(0, take);
    const providerConnectionId = await resolveProviderConnectionId(db, principal.ownerId, channelScopeId, channel);

    const members: Array<AudienceCandidate & { verdict: SendEligibilityResult; includedByMerchant: true }> = [];
    for (const candidate of candidates) {
      const verdict = await evaluateSendEligibility(db, {
        ownerId: principal.ownerId,
        contactId: candidate.contactId,
        contactIdentityId: candidate.contactIdentityId,
        channel,
        purpose,
        providerConnectionId,
        callerClass: "merchant_manual",
      });
      // §3.2 unknown-not-culled: every matched candidate stays included regardless of verdict.
      members.push({ ...candidate, verdict, includedByMerchant: true });
    }
    return { candidateCount: candidates.length, members };
  }

  /**
   * Draft creation. creationIdempotencyKey double-click/replay returns the existing row
   * (never a duplicate) as long as the semantic payload matches; a mismatched payload on the
   * same key is IDEMPOTENCY_CONFLICT (mirrors consent-runtime.ts's replay discipline).
   */
  async function createBroadcastRun(
    principal: CustomerBroadcastPrincipal,
    input: CreateBroadcastRunInput,
  ) {
    await requireOwnerMutationMembership(principal);
    const channelScopeId = requiredString(input?.channelScopeId, MAX_TEXT);
    const channel = requiredToken(input?.channel, 64);
    const purpose = requiredPurpose(input?.purpose);
    const campaignId = optionalString(input?.campaignId, MAX_TEXT);
    const templateVersionId = optionalString(input?.templateVersionId, MAX_TEXT);
    const creationIdempotencyKey = requiredString(input?.creationIdempotencyKey, MAX_TEXT);
    const at = now();

    return db.$transaction(async (tx) => {
      // Transaction-time recheck (mirrors customer-inbox-service.ts, ledger #359 item 25): a
      // caller demoted from owner between the outer check above and this write must not slip
      // a broadcast run through on the stale outer read.
      const membership = await activeMembership(tx, principal);
      if (!membership || membership.role !== "owner") fail("ACTION_DENIED");
      const scope = await tx.channelScope.findFirst({
        where: { id: channelScopeId, ownerId: principal.ownerId, channel },
        select: { id: true },
      });
      if (!scope) fail("RESOURCE_NOT_FOUND");
      if (campaignId) {
        const campaign = await tx.campaign.findFirst({
          where: { id: campaignId, ownerId: principal.ownerId },
          select: { id: true },
        });
        if (!campaign) fail("RESOURCE_NOT_FOUND");
      }
      if (templateVersionId) {
        const version = await tx.customerMessageTemplateVersion.findFirst({
          where: { id: templateVersionId, ownerId: principal.ownerId },
          select: { id: true },
        });
        if (!version) fail("RESOURCE_NOT_FOUND");
      }

      const existing = await tx.broadcastRun.findFirst({
        where: { ownerId: principal.ownerId, creationIdempotencyKey },
      });
      if (existing) {
        const same =
          existing.channelScopeId === channelScopeId &&
          existing.channel === channel &&
          existing.purpose === purpose &&
          existing.campaignId === campaignId &&
          existing.templateVersionId === templateVersionId;
        if (!same) fail("IDEMPOTENCY_CONFLICT");
        return { ok: true as const, duplicate: true as const, resource: existing };
      }

      const id = issueId();
      try {
        const resource = await tx.broadcastRun.create({
          data: {
            id,
            ownerId: principal.ownerId,
            channelScopeId,
            channel,
            campaignId,
            templateVersionId,
            purpose,
            status: "draft",
            audienceRevision: 0,
            revision: 0,
            creationIdempotencyKey,
            createdByMembershipId: membership.id,
            createdAt: at,
            updatedAt: at,
          },
        });
        return { ok: true as const, duplicate: false as const, resource };
      } catch (error) {
        if (prismaCode(error) === "P2002") {
          const raced = await tx.broadcastRun.findFirst({
            where: { ownerId: principal.ownerId, creationIdempotencyKey },
          });
          if (raced) return { ok: true as const, duplicate: true as const, resource: raced };
        }
        throw error;
      }
    });
  }

  /**
   * Snapshots the segment's current live-evaluator verdicts into BroadcastAudienceMember rows
   * (display/audit only — §5.3) and bumps both revision and audienceRevision. Re-freezing an
   * already-frozen run (status stays audience_frozen) is allowed and upserts every member's
   * verdict fresh; nothing here authorizes a send.
   */
  async function freezeAudience(principal: CustomerBroadcastPrincipal, input: FreezeAudienceInput) {
    await requireOwnerMutationMembership(principal);
    const broadcastRunId = requiredString(input?.broadcastRunId, MAX_TEXT);
    const expectedRevision = revision(input?.expectedRevision);
    const segmentId = requiredString(input?.segmentId, MAX_TEXT);
    const at = now();

    return db.$transaction(async (tx) => {
      const membership = await activeMembership(tx, principal);
      if (!membership || membership.role !== "owner") fail("ACTION_DENIED");
      const run = await requireBroadcastRun(tx, principal.ownerId, broadcastRunId);
      if (!BROADCAST_STATUSES_ALLOWING_FREEZE.has(run.status)) fail("ACTION_DENIED");
      if (run.revision !== expectedRevision) fail("CAS_CONFLICT");

      const candidates = await resolveSegmentAudience(tx, principal.ownerId, segmentId, run.channel);
      const providerConnectionId = await resolveProviderConnectionId(
        tx,
        principal.ownerId,
        run.channelScopeId,
        run.channel,
      );
      const nextAudienceRevision = run.audienceRevision + 1;
      const nextRevision = expectedRevision + 1;

      for (const candidate of candidates) {
        const verdict = await evaluateSendEligibility(tx, {
          ownerId: principal.ownerId,
          contactId: candidate.contactId,
          contactIdentityId: candidate.contactIdentityId,
          channel: run.channel,
          purpose: run.purpose as BroadcastPurpose,
          providerConnectionId,
          callerClass: "merchant_manual",
        });
        const snapshot = { ...verdict, evaluatedAt: verdict.checkedAt };
        await tx.broadcastAudienceMember.upsert({
          where: {
            ownerId_broadcastRunId_contactIdentityId: {
              ownerId: principal.ownerId,
              broadcastRunId,
              contactIdentityId: candidate.contactIdentityId,
            },
          },
          create: {
            id: issueId(),
            ownerId: principal.ownerId,
            broadcastRunId,
            contactId: candidate.contactId,
            contactIdentityId: candidate.contactIdentityId,
            audienceRevision: nextAudienceRevision,
            eligibilityVerdictJson: snapshot,
            verdictHash: verdictHash(snapshot),
            // §3.2/B0-44: unknown-permission members are flagged (via the verdict itself,
            // never silently dropped) and kept — every matched candidate defaults included.
            includedByMerchant: true,
            sendState: "pending",
            createdAt: at,
          },
          update: {
            audienceRevision: nextAudienceRevision,
            eligibilityVerdictJson: snapshot,
            verdictHash: verdictHash(snapshot),
          },
        });
      }

      const changed = await tx.broadcastRun.updateMany({
        where: { id: broadcastRunId, ownerId: principal.ownerId, revision: expectedRevision },
        data: {
          status: "audience_frozen",
          audienceRevision: nextAudienceRevision,
          revision: { increment: 1 },
          frozenAt: at,
          updatedAt: at,
        },
      });
      if (changed.count !== 1) fail("CAS_CONFLICT");

      const resource = await requireBroadcastRun(tx, principal.ownerId, broadcastRunId);
      const members = await tx.broadcastAudienceMember.findMany({
        where: { ownerId: principal.ownerId, broadcastRunId },
        orderBy: [{ id: "asc" }],
      });
      return { ok: true as const, resource, members, change: { revision: nextRevision, kind: "audience_frozen" } };
    });
  }

  async function confirmBroadcastRun(principal: CustomerBroadcastPrincipal, input: ConfirmBroadcastRunInput) {
    await requireOwnerMutationMembership(principal);
    const broadcastRunId = requiredString(input?.broadcastRunId, MAX_TEXT);
    const expectedRevision = revision(input?.expectedRevision);
    const at = now();

    return db.$transaction(async (tx) => {
      const membership = await activeMembership(tx, principal);
      if (!membership || membership.role !== "owner") fail("ACTION_DENIED");
      const run = await requireBroadcastRun(tx, principal.ownerId, broadcastRunId);
      if (!BROADCAST_STATUSES_ALLOWING_CONFIRM.has(run.status)) fail("ACTION_DENIED");
      if (run.revision !== expectedRevision) fail("CAS_CONFLICT");

      const changed = await tx.broadcastRun.updateMany({
        where: { id: broadcastRunId, ownerId: principal.ownerId, revision: expectedRevision },
        data: { status: "confirmed", confirmedAt: at, revision: { increment: 1 }, updatedAt: at },
      });
      if (changed.count !== 1) fail("CAS_CONFLICT");
      const resource = await requireBroadcastRun(tx, principal.ownerId, broadcastRunId);
      return { ok: true as const, resource, change: { revision: expectedRevision + 1, kind: "confirmed" } };
    });
  }

  async function cancelBroadcastRun(principal: CustomerBroadcastPrincipal, input: CancelBroadcastRunInput) {
    await requireOwnerMutationMembership(principal);
    const broadcastRunId = requiredString(input?.broadcastRunId, MAX_TEXT);
    const expectedRevision = revision(input?.expectedRevision);
    const at = now();

    return db.$transaction(async (tx) => {
      const membership = await activeMembership(tx, principal);
      if (!membership || membership.role !== "owner") fail("ACTION_DENIED");
      const run = await requireBroadcastRun(tx, principal.ownerId, broadcastRunId);
      if (!BROADCAST_STATUSES_ALLOWING_CANCEL.has(run.status)) fail("ACTION_DENIED");
      if (run.revision !== expectedRevision) fail("CAS_CONFLICT");

      const changed = await tx.broadcastRun.updateMany({
        where: { id: broadcastRunId, ownerId: principal.ownerId, revision: expectedRevision },
        data: { status: "cancelled", revision: { increment: 1 }, updatedAt: at },
      });
      if (changed.count !== 1) fail("CAS_CONFLICT");
      const resource = await requireBroadcastRun(tx, principal.ownerId, broadcastRunId);
      return { ok: true as const, resource, change: { revision: expectedRevision + 1, kind: "cancelled" } };
    });
  }

  /**
   * The C5 broadcast chokepoint (§6.2), same hard-disabled shape as
   * customer-inbox-service.ts's submitConversationReply: validates the run is real and
   * tenant-scoped, then unconditionally fails SEND_PATH_UNAVAILABLE. D8 manifest / two-confirm
   * carriers, atomic outbox, and adapter submission do not exist yet — steps 2-6 of §6.2 are
   * unreachable code that this function deliberately never contains, real or simulated.
   */
  async function submitBroadcastRun(
    principal: CustomerBroadcastPrincipal,
    input: SubmitBroadcastRunInput,
  ): Promise<never> {
    await requireOwnerMutationMembership(principal);
    const broadcastRunId = requiredString(input?.broadcastRunId, MAX_TEXT);
    await requireBroadcastRun(db, principal.ownerId, broadcastRunId);
    // Deliberately no adapter call, no eligibility re-read, no frequency write: D8/C6
    // carriers do not exist yet (same hard-disabled discipline as submitConversationReply).
    fail("SEND_PATH_UNAVAILABLE");
  }

  return {
    listBroadcastRuns,
    getBroadcastRun,
    previewAudienceEligibility,
    createBroadcastRun,
    freezeAudience,
    confirmBroadcastRun,
    cancelBroadcastRun,
    submitBroadcastRun,
  };
}

export const customerBroadcastService = createCustomerBroadcastService();
