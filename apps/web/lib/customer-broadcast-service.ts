import "server-only";

import { createHash } from "node:crypto";
import {
  effectiveOrgRoles,
  newId,
  orgRolesAllow,
  validateSegmentRuleGroup,
  type OrgRole,
  type SegmentContactFacts,
} from "@fikirtive/core";
import {
  evaluateSendEligibility,
  prisma as defaultDb,
  recordSendFrequencyEventInTransaction,
  SendEligibilityError,
  type EligibilityAxis,
  type Prisma,
  type SendEligibilityResult,
} from "@fikirtive/db";
import {
  contactChannelFacts,
  contactConsentTruth,
  countExcludedByConsent,
  isKnownOptOut,
  readContactConsentTruth,
  selectedIntoAudience,
  type ConsentExclusionCandidate,
} from "./consent-authority";
import {
  broadcastPurposeFromTemplateClassification,
  type BroadcastPurpose,
} from "./customer-broadcast-purpose";
import { resolveActiveProviderConnectionId } from "./channel-connection-resolve";

/**
 * C5 broadcast domain actions. Spec:
 * docs/superpowers/specs/2026-07-21-c5-broadcast-eligibility-physical-contract.md §5/§6/§10.
 *
 * M2 built create/freeze/confirm/cancel + the hard-disabled real-send chokepoint
 * (submitBroadcastRun, always SEND_PATH_UNAVAILABLE). M3 (issue #388) adds the SIMULATED
 * execution path — executeBroadcastRun — which is the ONLY function here that ever moves a run
 * into an execution or terminal-send state, or marks a member simulated. It runs entirely
 * on the simulated-provider layer (ledger #359 item 28): it re-reads live four-axis eligibility
 * per member, marks four-axes-pass members simulated_sent + records exactly one frequency event
 * (simulated=true), and marks any-axis-blocked members skipped_ineligible with a stable reason —
 * with ZERO real adapter/provider/webhook/credential/spend. The real-send path stays
 * SEND_PATH_UNAVAILABLE in submitBroadcastRun (unchanged from M2). See the M3 static
 * no-second-real-send-path test for the machine proof of "no real provider entry point".
 *
 * RBAC uses positive capabilities. Read paths require broadcast.read; mutations require
 * broadcast.manage. Today only the owner bundle contains broadcast.manage, but callers are never
 * denied merely because of a role name—the permission bundle is the authority.
 */

export const CUSTOMER_BROADCAST_ERROR_CODES = {
  NOT_AUTHORIZED: "NOT_AUTHORIZED",
  ACTION_DENIED: "ACTION_DENIED",
  RESOURCE_NOT_FOUND: "RESOURCE_NOT_FOUND",
  CAS_CONFLICT: "CAS_CONFLICT",
  IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_CONFLICT",
  SEND_PATH_UNAVAILABLE: "SEND_PATH_UNAVAILABLE",
  INVALID_ARGUMENT: "INVALID_ARGUMENT",
  TEMPLATE_CHANNEL_MISMATCH: "TEMPLATE_CHANNEL_MISMATCH",
  TEMPLATE_CLASSIFICATION_UNSUPPORTED: "TEMPLATE_CLASSIFICATION_UNSUPPORTED",
  PROVIDER_CONNECTION_CONFLICT: "PROVIDER_CONNECTION_CONFLICT",
  // Re-freeze found a stale member that had already advanced past `pending` — impossible under
  // the status gating (freeze is draft/audience_frozen only, sends need confirmed/executing), so
  // it signals corruption: fail closed and roll back rather than delete a member with send state.
  AUDIENCE_STATE_CONFLICT: "AUDIENCE_STATE_CONFLICT",
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

const BROADCAST_STATUSES_ALLOWING_FREEZE = new Set(["draft", "audience_frozen"]);
const BROADCAST_STATUSES_ALLOWING_CONFIRM = new Set(["audience_frozen"]);
// A confirmed run may still be cancelled; an executing/completed one may not (it has already
// spent frequency cap on simulated sends — cancelling would misrepresent what happened).
const BROADCAST_STATUSES_ALLOWING_CANCEL = new Set(["draft", "audience_frozen", "confirmed"]);
// Frequency counts on purposeClass, not the run's marketing/review_request purpose — both
// broadcast purposes are proactive_non_transactional (§5.4).
const BROADCAST_PURPOSE_CLASS = "proactive_non_transactional" as const;
// The four axes, in the fixed order a skip reason is derived from (first non-pass wins).
const AXIS_ORDER = ["consentStop", "doNotDisturb", "providerRefusal", "frequency"] as const;

type DatabaseClient = typeof defaultDb | Prisma.TransactionClient;
type ActiveMembership = { id: string; roles: OrgRole[] };

const MAX_TEXT = 512;
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;
const TOKEN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export type ListBroadcastRunsInput = { limit?: number };
export type BroadcastRunIdInput = { broadcastRunId: string };

export type CreateBroadcastRunInput = {
  channelScopeId: string;
  channel: string;
  campaignId?: string | null;
  templateVersionId: string;
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
export type ExecuteBroadcastRunInput = { broadcastRunId: string; expectedRevision: number };
export type BroadcastRunLivePreflightInput = { broadcastRunId: string };

export type PreviewAudienceEligibilityInput = {
  segmentId: string;
  channelScopeId: string;
  channel: string;
  templateVersionId: string;
  limit?: number;
};

type AudienceCandidate = {
  contactId: string;
  contactIdentityId: string;
};

/**
 * What the consent authority did to this audience, so freeze and preview can say it out loud
 * (#726): who it kept out, and who it kept in on the merchant's own unverified record (#716).
 *
 * Every number here is counted over the contacts this run can REACH — the ones with an identity
 * on its channel. The segments page counts the same way over every contact the merchant has, so
 * its numbers can be larger; each surface prints which population it counted rather than
 * implying the two are one number.
 */
export type AudienceConsentSummary = {
  /** Reachable contacts this segment would have selected but for their known opt-out. */
  excludedByConsent: number;
  /** Of those, the ones held out by an opt-out recorded before the consent ledger existed. */
  unresolvedLegacyOptOut: number;
  /** Reachable contacts in this audience whose only opt-out is the merchant's own record. */
  reportedOptOutKept: number;
  /**
   * #758 — reachable contacts this audience would have kept, and the segment's own optional
   * "exclude the opt-outs I recorded myself" left out. Zero unless the merchant turned that
   * option on for this segment; when it is on, `reportedOptOutKept` is zero instead.
   */
  excludedByReportedOptOut: number;
};

type ResolvedSegmentAudience = {
  candidates: AudienceCandidate[];
  consent: AudienceConsentSummary;
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

function rejectClientPurpose(value: unknown): void {
  if (
    typeof value === "object" &&
    value !== null &&
    Object.prototype.hasOwnProperty.call(value, "purpose")
  ) {
    fail("INVALID_ARGUMENT");
  }
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

/** True only when all four axes read `pass` — the sole condition for a simulated send (§4.4). */
function axisAllPass(verdict: SendEligibilityResult): boolean {
  return AXIS_ORDER.every((name) => (verdict[name] as EligibilityAxis).status === "pass");
}

/**
 * Stable, merchant-visible skip code naming the FIRST non-pass axis (fixed order) and its
 * reason — never PII, never a merged boolean (§5.3 skipReason / §3.2 four-axes-stay-four).
 * e.g. "consentStop:effective_revoke", "doNotDisturb:dnd_set", "frequency:frequency_cap_reached".
 */
function firstBlockingSkipReason(verdict: SendEligibilityResult): string {
  for (const name of AXIS_ORDER) {
    const axis = verdict[name] as EligibilityAxis;
    if (axis.status !== "pass") return `${name}:${axis.reason ?? axis.status}`;
  }
  // Unreachable when called only after axisAllPass() is false, but stay honest rather than lie.
  return "unknown:no_blocking_axis";
}

/**
 * §5.4 broadcast frequency idempotency key. Deliberately EXCLUDES audienceRevision so a
 * CAS re-freeze or an execution retry/resume reuses the same key and never double-counts.
 */
function broadcastFrequencyKey(
  ownerId: string,
  broadcastRunId: string,
  contactIdentityId: string,
  channel: string,
): string {
  return `freq:${ownerId}:${broadcastRunId}:${contactIdentityId}:${channel}:${BROADCAST_PURPOSE_CLASS}`;
}

function sameBroadcastRunPayload(
  existing: {
    channelScopeId: string;
    channel: string;
    purpose: string;
    campaignId: string | null;
    templateVersionId: string | null;
  },
  expected: {
    channelScopeId: string;
    channel: string;
    purpose: BroadcastPurpose;
    campaignId: string | null;
    templateVersionId: string;
  },
): boolean {
  return (
    existing.channelScopeId === expected.channelScopeId &&
    existing.channel === expected.channel &&
    existing.purpose === expected.purpose &&
    existing.campaignId === expected.campaignId &&
    existing.templateVersionId === expected.templateVersionId
  );
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
  ): Promise<ActiveMembership | null> {
    if (!isNonEmptyString(principal?.ownerId) || !isNonEmptyString(principal?.membershipId)) {
      fail("NOT_AUTHORIZED");
    }
    const row = await client.membership.findFirst({
      where: { id: principal.membershipId, orgId: principal.ownerId, status: "active", deletedAt: null },
      select: { id: true, roles: { select: { role: true } } },
    });
    if (!row) return null;
    const roles = effectiveOrgRoles((row.roles ?? []).map((assignment) => assignment.role));
    return roles.length > 0 ? { id: row.id, roles } : null;
  }

  async function requireReadMembership(
    principal: CustomerBroadcastPrincipal,
  ): Promise<ActiveMembership> {
    const membership = await activeMembership(db, principal);
    if (!membership || !orgRolesAllow(membership.roles, "broadcast.read")) fail("ACTION_DENIED");
    return membership;
  }

  /**
   * Every C5 mutation is owner-only pending the Founder's real capability matrix (§14.2
   * "default deny"). Impersonating sessions are read-only surfaces generally, but since even
   * an owner impersonation session should not spend a broadcast mutation, this denies it too
   * — matching customer-inbox-service.ts's IMPERSONATION_READ_ONLY intent via ACTION_DENIED
   * (this file does not carry the audit-log surface inbox uses, so it fails closed instead).
   */
  async function requireMutationMembership(
    principal: CustomerBroadcastPrincipal,
  ): Promise<ActiveMembership> {
    const membership = await activeMembership(db, principal);
    if (!membership || !orgRolesAllow(membership.roles, "broadcast.manage")) fail("ACTION_DENIED");
    if (principal.impersonating) fail("ACTION_DENIED");
    return membership;
  }

  async function requireBroadcastRun(client: DatabaseClient, ownerId: string, broadcastRunId: string) {
    const row = await client.broadcastRun.findFirst({ where: { id: broadcastRunId, ownerId } });
    if (!row) fail("RESOURCE_NOT_FOUND");
    return row;
  }

  async function requireBroadcastTemplate(
    client: DatabaseClient,
    ownerId: string,
    templateVersionId: string,
    channelScopeId: string,
    channel: string,
  ): Promise<BroadcastPurpose> {
    const version = await client.customerMessageTemplateVersion.findFirst({
      where: { id: templateVersionId, ownerId },
      select: {
        category: true,
        purposeClass: true,
        template: { select: { channelScopeId: true, channel: true } },
      },
    });
    if (!version) fail("RESOURCE_NOT_FOUND");
    if (
      version.template.channelScopeId !== channelScopeId ||
      version.template.channel !== channel
    ) {
      fail("TEMPLATE_CHANNEL_MISMATCH");
    }
    const purpose = broadcastPurposeFromTemplateClassification(version);
    if (!purpose) fail("TEMPLATE_CLASSIFICATION_UNSUPPORTED");
    return purpose;
  }

  /**
   * Live segment-audience resolution shared by previewAudienceEligibility (no writes) and
   * freezeAudience (writes a frozen snapshot). Mirrors segment-actions.ts's contact/segment
   * matching (contactMatchesRules from @fikirtive/core) but is re-implemented locally: this
   * file's allowed surface does not include segment-actions.ts, and the two callers need the
   * result paired with per-identity eligibility rather than segment-actions.ts's aggregate
   * counts.
   *
   * Ledger #35 repaid here: the segment-contactability estimate now derives from
   * ConsentStateProjection (the R-010 consent authority the eligibility axes already read),
   * NOT the legacy Contact.marketingConsent column — killing the double source of truth. Only a
   * per-(contact,channel,purpose) `effective_revoke` projection excludes a contact from this
   * ESTIMATE; unknown / no-projection / verified_grant all stay in (unknown flag + keep, B0-44 —
   * the estimate never shrinks the merchant's list on missing evidence). The estimate is still
   * only an estimate: the frozen verdict snapshot and the execution-time live re-read are what
   * actually gate a send. The dead `Contact.doNotDisturb` read is gone too — DND is a separate
   * axis carried honestly in each member's verdict, never a silent estimate filter.
   *
   * #726 finished that repayment on the other side of the seam: the projection read and the
   * "known opt-out" predicate now live in consent-authority.ts, which the segments page reads
   * too — so a contact the segments page says it excluded can never reappear here, and the two
   * pages report the exclusion with the same arithmetic.
   *
   * #806 closed the last way past that seam: the shared predicate was reaching the rules only as
   * a FACT, so it bound nothing on a segment whose rules never mention consent. Selection now
   * runs through `selectedIntoAudience`, the one gate both this file and the segments page use.
   *
   * Same arithmetic, deliberately different population: this run can only speak about contacts
   * it can REACH (an identity on its channel), while the segments page speaks about every
   * contact the merchant has. Widening this side to match the page's number would mean matching
   * contacts on channels this run cannot send to, which is a bigger send list — so the numbers
   * stay honestly separate and both surfaces name the population they counted.
   */
  async function resolveSegmentAudience(
    client: DatabaseClient,
    ownerId: string,
    segmentId: string,
    channel: string,
    purpose: BroadcastPurpose,
  ): Promise<ResolvedSegmentAudience> {
    const segment = await client.segment.findFirst({
      where: { id: segmentId, ownerId, deletedAt: null },
      select: { rulesJson: true },
    });
    if (!segment) fail("RESOURCE_NOT_FOUND");
    const validated = validateSegmentRuleGroup(segment.rulesJson);
    if (!validated.ok) fail("INVALID_ARGUMENT");

    const [contacts, consent] = await Promise.all([
      client.contact.findMany({
        where: { ownerId, deletedAt: null },
        select: {
          id: true,
          totalOrdersMyr: true,
          // Never an authority of its own: the pre-ledger fence can only hold a contact OUT.
          marketingConsent: true,
          // #806 r2 — EVERY live identity, not just this run's channel. A segment rule's
          // `channels` fact describes the contact; narrowing it to the run's channel made this
          // side answer the shared gate differently from the segments page (see
          // `contactChannelFacts`). Which identities this run may send to is filtered below.
          identities: { where: { ownerId, deletedAt: null }, select: { id: true, channel: true } },
        },
      }),
      readContactConsentTruth(client, ownerId, { channel, purpose }),
    ]);

    const evaluatedAt = now().toISOString();
    const candidates: AudienceCandidate[] = [];
    const reachable: ConsentExclusionCandidate[] = [];
    let reportedOptOutKept = 0;
    for (const contact of contacts) {
      const truth = contactConsentTruth(consent.get(contact.id), contact.marketingConsent, {
        channel,
        purpose,
      });
      const optedOut = isKnownOptOut(truth);
      const facts: SegmentContactFacts = {
        lifetimeSpendMyr:
          contact.totalOrdersMyr === null || contact.totalOrdersMyr === undefined
            ? undefined
            : Number(contact.totalOrdersMyr),
        // The contact's own live channels, built by the one shared construction (#806 r2).
        channels: contactChannelFacts(contact.identities),
        // Translated for the segment "contactability" rule only: a not-known-revoked contact
        // reads as opt_in so unknown permission stays in the estimate (flag + keep, B0-44).
        marketingConsent: optedOut ? "opt_out" : "opt_in",
        doNotDisturb: false,
      };
      // #806: the consent authority is the GATE here, not merely a fact the rules may consult.
      // A segment that names only the channel used to admit a known opt-out — including one held
      // out by the pre-ledger fence — into the frozen audience, shown as a kept member. Same
      // function AND the same facts the segments page selects with, so neither side can admit
      // whom the other drops.
      const selected = selectedIntoAudience(truth, facts, validated.value, evaluatedAt);
      // This run can only speak about — and only send to — identities on its own channel. That
      // is a targeting question, deliberately kept out of the selection facts above.
      const sendTargets = contact.identities.filter((identity) => identity.channel === channel);
      // Only contacts this run can reach are counted: an audience summary must describe the
      // audience, not the address book.
      if (sendTargets.length === 0) continue;
      reachable.push({ truth, selected, facts });
      if (!selected) continue;
      if (truth.reportedOptOut && !optedOut) reportedOptOutKept += 1;
      for (const identity of sendTargets) {
        candidates.push({ contactId: contact.id, contactIdentityId: identity.id });
      }
    }
    const excluded = countExcludedByConsent(reachable, validated.value, evaluatedAt);
    return {
      candidates,
      consent: {
        excludedByConsent: excluded.excluded,
        unresolvedLegacyOptOut: excluded.unresolvedLegacy,
        reportedOptOutKept,
        excludedByReportedOptOut: excluded.excludedByReportedOptOut,
      },
    };
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
    const [members, campaign] = await Promise.all([
      db.broadcastAudienceMember.findMany({
        where: { ownerId: principal.ownerId, broadcastRunId },
        orderBy: [{ id: "asc" }],
        // Display enrichment for the workbench: the customer's name and channel handle (never the
        // team-membership directory — that is a separate owner-scoped read). Read-only.
        include: {
          contact: { select: { name: true } },
          contactIdentity: { select: { channel: true, handle: true, label: true, externalId: true } },
        },
      }),
      run.campaignId
        ? db.campaign.findFirst({
            where: { id: run.campaignId, ownerId: principal.ownerId, deletedAt: null },
            select: { id: true, name: true },
          })
        : Promise.resolve(null),
    ]);
    return { run, members, campaign };
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
    rejectClientPurpose(input);
    const segmentId = requiredString(input?.segmentId, MAX_TEXT);
    const channelScopeId = requiredString(input?.channelScopeId, MAX_TEXT);
    const channel = requiredToken(input?.channel, 64);
    const templateVersionId = requiredString(input?.templateVersionId, MAX_TEXT);
    const take = limit(input?.limit);

    const scope = await db.channelScope.findFirst({
      where: { id: channelScopeId, ownerId: principal.ownerId, channel },
      select: { id: true },
    });
    if (!scope) fail("RESOURCE_NOT_FOUND");
    const purpose = await requireBroadcastTemplate(
      db,
      principal.ownerId,
      templateVersionId,
      channelScopeId,
      channel,
    );

    const audience = await resolveSegmentAudience(db, principal.ownerId, segmentId, channel, purpose);
    const candidates = audience.candidates.slice(0, take);
    const providerConnectionId = await resolveActiveProviderConnectionId(
      db,
      principal.ownerId,
      channelScopeId,
      channel,
      () => fail("PROVIDER_CONNECTION_CONFLICT"),
    );

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
    return { candidateCount: candidates.length, members, purpose, consent: audience.consent };
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
    await requireMutationMembership(principal);
    rejectClientPurpose(input);
    const channelScopeId = requiredString(input?.channelScopeId, MAX_TEXT);
    const channel = requiredToken(input?.channel, 64);
    const campaignId = optionalString(input?.campaignId, MAX_TEXT);
    const templateVersionId = requiredString(input?.templateVersionId, MAX_TEXT);
    const creationIdempotencyKey = requiredString(input?.creationIdempotencyKey, MAX_TEXT);
    const at = now();

    try {
      return await db.$transaction(async (tx) => {
        // Transaction-time recheck (mirrors customer-inbox-service.ts, ledger #359 item 25): a
        // caller demoted from owner between the outer check above and this write must not slip
        // a broadcast run through on the stale outer read.
        const membership = await activeMembership(tx, principal);
        if (!membership || !orgRolesAllow(membership.roles, "broadcast.manage")) fail("ACTION_DENIED");
        const scope = await tx.channelScope.findFirst({
          where: { id: channelScopeId, ownerId: principal.ownerId, channel },
          select: { id: true },
        });
        if (!scope) fail("RESOURCE_NOT_FOUND");
        if (campaignId) {
          const campaign = await tx.campaign.findFirst({
            // #744 判官 r1 P2 — a campaign the merchant deleted is invisible everywhere else, so
            // grouping new work into it would file that work under a container they can no
            // longer open. Same `deletedAt: null` every other campaign read already uses.
            where: { id: campaignId, ownerId: principal.ownerId, deletedAt: null },
            select: { id: true },
          });
          if (!campaign) fail("RESOURCE_NOT_FOUND");
        }
        const purpose = await requireBroadcastTemplate(
          tx,
          principal.ownerId,
          templateVersionId,
          channelScopeId,
          channel,
        );
        const expected = {
          channelScopeId,
          channel,
          purpose,
          campaignId,
          templateVersionId,
        };

        const existing = await tx.broadcastRun.findFirst({
          where: { ownerId: principal.ownerId, creationIdempotencyKey },
        });
        if (existing) {
          if (!sameBroadcastRunPayload(existing, expected)) fail("IDEMPOTENCY_CONFLICT");
          return { ok: true as const, duplicate: true as const, resource: existing };
        }

        const id = issueId();
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
      });
    } catch (error) {
      if (prismaCode(error) === "P2002") {
        // PostgreSQL aborts the losing transaction after the unique violation. Unwind it
        // completely, then re-read and compare the committed winner in a fresh transaction.
        const raced = await db.$transaction(async (tx) => {
          const purpose = await requireBroadcastTemplate(
            tx,
            principal.ownerId,
            templateVersionId,
            channelScopeId,
            channel,
          );
          const resource = await tx.broadcastRun.findFirst({
            where: { ownerId: principal.ownerId, creationIdempotencyKey },
          });
          return { purpose, resource };
        });
        if (raced.resource) {
          const same = sameBroadcastRunPayload(raced.resource, {
            channelScopeId,
            channel,
            purpose: raced.purpose,
            campaignId,
            templateVersionId,
          });
          if (!same) fail("IDEMPOTENCY_CONFLICT");
          return { ok: true as const, duplicate: true as const, resource: raced.resource };
        }
      }
      throw error;
    }
  }

  /**
   * Snapshots the segment's current live-evaluator verdicts into BroadcastAudienceMember rows
   * (display/audit only — §5.3) and bumps both revision and audienceRevision. Re-freezing an
   * already-frozen run (status stays audience_frozen) is allowed and upserts every member's
   * verdict fresh; nothing here authorizes a send.
   */
  async function freezeAudience(principal: CustomerBroadcastPrincipal, input: FreezeAudienceInput) {
    await requireMutationMembership(principal);
    const broadcastRunId = requiredString(input?.broadcastRunId, MAX_TEXT);
    const expectedRevision = revision(input?.expectedRevision);
    const segmentId = requiredString(input?.segmentId, MAX_TEXT);
    const at = now();

    return db.$transaction(async (tx) => {
      const membership = await activeMembership(tx, principal);
      if (!membership || !orgRolesAllow(membership.roles, "broadcast.manage")) fail("ACTION_DENIED");
      const run = await requireBroadcastRun(tx, principal.ownerId, broadcastRunId);
      if (!BROADCAST_STATUSES_ALLOWING_FREEZE.has(run.status)) fail("ACTION_DENIED");
      if (run.revision !== expectedRevision) fail("CAS_CONFLICT");

      const audience = await resolveSegmentAudience(
        tx,
        principal.ownerId,
        segmentId,
        run.channel,
        run.purpose as BroadcastPurpose,
      );
      const candidates = audience.candidates;
      const providerConnectionId = await resolveActiveProviderConnectionId(
        tx,
        principal.ownerId,
        run.channelScopeId,
        run.channel,
        () => fail("PROVIDER_CONNECTION_CONFLICT"),
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
            ownerId: principal.ownerId,
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

      // §5.3/§5.2: a re-freeze to a NARROWER segment must not leave the removed members behind —
      // otherwise execution (which selects by run, not revision) would send to the UNION of every
      // segment ever frozen, including contacts the merchant explicitly dropped. Members in the new
      // set were just bumped to nextAudienceRevision above; anything still behind it is stale.
      // Under the status gating (freeze is draft/audience_frozen only; a member advances past
      // pending only under confirmed/executing), a stale member can only be `pending` — a
      // non-pending stale member is corruption, so fail closed and roll back rather than delete it.
      const stale = await tx.broadcastAudienceMember.findMany({
        where: { ownerId: principal.ownerId, broadcastRunId, audienceRevision: { lt: nextAudienceRevision } },
        select: { sendState: true },
      });
      if (stale.some((m) => m.sendState !== "pending")) fail("AUDIENCE_STATE_CONFLICT");
      if (stale.length > 0) {
        await tx.broadcastAudienceMember.deleteMany({
          where: { ownerId: principal.ownerId, broadcastRunId, audienceRevision: { lt: nextAudienceRevision } },
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
      return {
        ok: true as const,
        resource,
        members,
        consent: audience.consent,
        change: { revision: nextRevision, kind: "audience_frozen" },
      };
    });
  }

  async function confirmBroadcastRun(principal: CustomerBroadcastPrincipal, input: ConfirmBroadcastRunInput) {
    await requireMutationMembership(principal);
    const broadcastRunId = requiredString(input?.broadcastRunId, MAX_TEXT);
    const expectedRevision = revision(input?.expectedRevision);
    const at = now();

    return db.$transaction(async (tx) => {
      const membership = await activeMembership(tx, principal);
      if (!membership || !orgRolesAllow(membership.roles, "broadcast.manage")) fail("ACTION_DENIED");
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
    await requireMutationMembership(principal);
    const broadcastRunId = requiredString(input?.broadcastRunId, MAX_TEXT);
    const expectedRevision = revision(input?.expectedRevision);
    const at = now();

    return db.$transaction(async (tx) => {
      const membership = await activeMembership(tx, principal);
      if (!membership || !orgRolesAllow(membership.roles, "broadcast.manage")) fail("ACTION_DENIED");
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
    await requireMutationMembership(principal);
    const broadcastRunId = requiredString(input?.broadcastRunId, MAX_TEXT);
    await requireBroadcastRun(db, principal.ownerId, broadcastRunId);
    // Deliberately no adapter call, no eligibility re-read, no frequency write: D8/C6
    // carriers do not exist yet (same hard-disabled discipline as submitConversationReply).
    fail("SEND_PATH_UNAVAILABLE");
  }

  /**
   * READ-ONLY companion to the frozen verdict snapshot (§6.2): for each frozen audience member,
   * re-runs the live four-axis evaluator NOW, so the audience-confirmation page can show the
   * frozen snapshot and the live preflight side by side (a diverged pair is the honest "stale"
   * signal — the snapshot is display/audit only; execution always re-reads). Writes nothing.
   */
  async function getBroadcastRunLivePreflight(
    principal: CustomerBroadcastPrincipal,
    input: BroadcastRunLivePreflightInput,
  ) {
    await requireReadMembership(principal);
    const broadcastRunId = requiredString(input?.broadcastRunId, MAX_TEXT);
    const run = await requireBroadcastRun(db, principal.ownerId, broadcastRunId);
    const members = await db.broadcastAudienceMember.findMany({
      where: { ownerId: principal.ownerId, broadcastRunId },
      orderBy: [{ id: "asc" }],
      include: {
        contact: { select: { name: true } },
        contactIdentity: { select: { channel: true, handle: true, label: true, externalId: true } },
      },
    });
    const providerConnectionId = await resolveActiveProviderConnectionId(
      db,
      principal.ownerId,
      run.channelScopeId,
      run.channel,
      () => fail("PROVIDER_CONNECTION_CONFLICT"),
    );
    const rows = [];
    for (const member of members) {
      const liveVerdict = await evaluateSendEligibility(db, {
        ownerId: principal.ownerId,
        contactId: member.contactId,
        contactIdentityId: member.contactIdentityId,
        channel: run.channel,
        purpose: run.purpose as BroadcastPurpose,
        providerConnectionId,
        callerClass: "merchant_manual",
      });
      rows.push({
        id: member.id,
        contactId: member.contactId,
        contactIdentityId: member.contactIdentityId,
        includedByMerchant: member.includedByMerchant,
        sendState: member.sendState,
        skipReason: member.skipReason,
        contact: member.contact,
        contactIdentity: member.contactIdentity,
        frozenVerdict: member.eligibilityVerdictJson,
        liveVerdict,
        eligibleNow: axisAllPass(liveVerdict),
      });
    }
    return { run, members: rows };
  }

  /**
   * Owner-scoped option lists for the structured create form (§10 M3: "结构化发起，不靠 chat
   * prompt"). Read-only; every list is tenant-filtered. No send authority.
   */
  async function getBroadcastComposerOptions(principal: CustomerBroadcastPrincipal) {
    await requireReadMembership(principal);
    const [channelScopes, segments, templateVersions, campaigns] = await Promise.all([
      db.channelScope.findMany({
        where: { ownerId: principal.ownerId },
        orderBy: [{ channel: "asc" }, { scopeKey: "asc" }],
        select: { id: true, channel: true, scopeKey: true },
      }),
      db.segment.findMany({
        where: { ownerId: principal.ownerId, deletedAt: null },
        orderBy: [{ name: "asc" }],
        select: { id: true, name: true, phrase: true, kind: true },
      }),
      db.customerMessageTemplateVersion.findMany({
        where: { ownerId: principal.ownerId },
        orderBy: [{ createdAt: "desc" }],
        take: MAX_LIMIT,
        select: {
          id: true,
          revision: true,
          purposeClass: true,
          category: true,
          availabilityState: true,
          template: { select: { name: true, channel: true, channelScopeId: true } },
        },
      }),
      db.campaign.findMany({
        where: { ownerId: principal.ownerId, deletedAt: null },
        orderBy: [{ createdAt: "desc" }],
        select: { id: true, name: true, status: true },
      }),
    ]);
    return {
      channelScopes,
      segments,
      templateVersions: templateVersions.map((version) => ({
        ...version,
        broadcastPurpose: broadcastPurposeFromTemplateClassification(version),
      })),
      campaigns,
    };
  }

  /**
   * C5-M3 SIMULATED execution (§6.2 simulated branch / §10 M3). The ONLY function that ever
   * writes an executing/completed run status or a simulated_sent member sendState. Zero real
   * adapter/provider/webhook/credential/spend — the real-send path stays SEND_PATH_UNAVAILABLE
   * in submitBroadcastRun.
   *
   * Contract:
   *  - only a `confirmed` run may START; an `executing` run RESUMES (safe retry after an
   *    interruption); a `completed` run is an idempotent no-op. All other statuses are denied.
   *  - overall CAS: the confirmed->executing claim and the executing->completed finish each
   *    take the run's monotonic revision; a concurrent double-start loses the CAS race.
   *  - per member, execution RE-READS live four-axis authority (never the frozen snapshot):
   *      · four axes pass -> sendState=simulated_sent + EXACTLY ONE ContactSendFrequencyEvent
   *        (simulated=true) under the §5.4 broadcast idempotency key (retry/resume double-counts
   *        zero);
   *      · any axis not pass (incl. consentRisk / DND / provider block / over-cap) ->
   *        sendState=skipped_ineligible + a stable skipReason, and ZERO frequency rows / zero
   *        cap spent.
   *  - the concurrent last-cap-slot race is resolved by
   *    recordSendFrequencyEventInTransaction's atomic count-and-insert: the loser gets
   *    FREQUENCY_CAP_REACHED and becomes an honest skip.
   */
  async function executeBroadcastRun(
    principal: CustomerBroadcastPrincipal,
    input: ExecuteBroadcastRunInput,
  ) {
    await requireMutationMembership(principal);
    const broadcastRunId = requiredString(input?.broadcastRunId, MAX_TEXT);
    const expectedRevision = revision(input?.expectedRevision);
    const at = now();

    async function rereadFinalizedMember(
      client: DatabaseClient,
      memberId: string,
      audienceRevision: number,
    ): Promise<void> {
      const winner = await client.broadcastAudienceMember.findFirst({
        where: {
          id: memberId,
          ownerId: principal.ownerId,
          broadcastRunId,
          audienceRevision,
        },
        select: { sendState: true },
      });
      if (!winner || winner.sendState === "pending") fail("AUDIENCE_STATE_CONFLICT");
    }

    async function markSkipped(
      memberId: string,
      audienceRevision: number,
      skipReason: string,
    ): Promise<void> {
      await db.$transaction(async (tx) => {
        const changed = await tx.broadcastAudienceMember.updateMany({
          where: {
            id: memberId,
            ownerId: principal.ownerId,
            broadcastRunId,
            audienceRevision,
            sendState: "pending",
          },
          data: { sendState: "skipped_ineligible", skipReason },
        });
        if (changed.count === 0) {
          await rereadFinalizedMember(tx, memberId, audienceRevision);
        }
      });
    }

    // Phase 1 — claim the run for execution (CAS). Re-checks owner inside the tx (a caller
    // demoted between the outer guard and here must not slip execution through).
    const claimed = await db.$transaction(async (tx) => {
      const membership = await activeMembership(tx, principal);
      if (!membership || !orgRolesAllow(membership.roles, "broadcast.manage")) fail("ACTION_DENIED");
      const run = await requireBroadcastRun(tx, principal.ownerId, broadcastRunId);
      if (run.status === "completed") return { run, alreadyComplete: true as const };
      if (run.status === "executing") {
        // Resume: the caller passes the CURRENT (executing) revision — CAS still holds.
        if (run.revision !== expectedRevision) fail("CAS_CONFLICT");
        return { run, alreadyComplete: false as const };
      }
      if (run.status !== "confirmed") fail("ACTION_DENIED");
      if (run.revision !== expectedRevision) fail("CAS_CONFLICT");
      const changed = await tx.broadcastRun.updateMany({
        where: { id: broadcastRunId, ownerId: principal.ownerId, revision: expectedRevision, status: "confirmed" },
        data: { status: "executing", executedAt: at, revision: { increment: 1 }, updatedAt: at },
      });
      if (changed.count !== 1) fail("CAS_CONFLICT");
      const reread = await requireBroadcastRun(tx, principal.ownerId, broadcastRunId);
      return { run: reread, alreadyComplete: false as const };
    });

    if (claimed.alreadyComplete) {
      const members = await db.broadcastAudienceMember.findMany({
        where: { ownerId: principal.ownerId, broadcastRunId },
        orderBy: [{ id: "asc" }],
      });
      return { ok: true as const, resource: claimed.run, members, alreadyComplete: true as const };
    }

    const run = claimed.run;
    const providerConnectionId = await resolveActiveProviderConnectionId(
      db,
      principal.ownerId,
      run.channelScopeId,
      run.channel,
      () => fail("PROVIDER_CONNECTION_CONFLICT"),
    );

    // Phase 2 — process every still-pending member. Each member is finalized in its own
    // transaction. The pending->simulated_sent CAS happens BEFORE the frequency insert, but both
    // commit atomically: a failed insert rolls the state claim back, while a lost CAS attempts no
    // event. This preserves sent=>one event and skipped=>zero events across concurrent resumers.
    // Revision-scoped (defense in depth alongside freezeAudience's prune): only members frozen at
    // the run's CURRENT audienceRevision are executed. A leftover member from an earlier, wider
    // freeze (e.g. a legacy row predating the prune) is never sent to.
    const pending = await db.broadcastAudienceMember.findMany({
      where: {
        ownerId: principal.ownerId,
        broadcastRunId,
        sendState: "pending",
        audienceRevision: run.audienceRevision,
      },
      orderBy: [{ id: "asc" }],
    });

    for (const member of pending) {
      const key = broadcastFrequencyKey(principal.ownerId, broadcastRunId, member.contactIdentityId, run.channel);

      try {
        await db.$transaction(async (tx) => {
          const current = await tx.broadcastAudienceMember.findFirst({
            where: {
              id: member.id,
              ownerId: principal.ownerId,
              broadcastRunId,
              audienceRevision: run.audienceRevision,
            },
            select: { sendState: true },
          });
          if (!current) fail("AUDIENCE_STATE_CONFLICT");
          if (current.sendState !== "pending") return;

          // Crash recovery for an event committed by an older implementation before its member
          // state flipped. The event remains terminal truth, but the state repair is still a CAS.
          const alreadyRecorded = await tx.contactSendFrequencyEvent.findFirst({
            where: { ownerId: principal.ownerId, idempotencyKey: key },
            select: { id: true },
          });
          if (alreadyRecorded) {
            const changed = await tx.broadcastAudienceMember.updateMany({
              where: {
                id: member.id,
                ownerId: principal.ownerId,
                broadcastRunId,
                audienceRevision: run.audienceRevision,
                sendState: "pending",
              },
              data: { sendState: "simulated_sent", skipReason: null },
            });
            if (changed.count === 0) {
              await rereadFinalizedMember(tx, member.id, run.audienceRevision);
            }
            return;
          }

          const verdict = await evaluateSendEligibility(tx, {
            ownerId: principal.ownerId,
            contactId: member.contactId,
            contactIdentityId: member.contactIdentityId,
            channel: run.channel,
            purpose: run.purpose as BroadcastPurpose,
            providerConnectionId,
            callerClass: "merchant_manual",
          });

          if (!axisAllPass(verdict)) {
            const changed = await tx.broadcastAudienceMember.updateMany({
              where: {
                id: member.id,
                ownerId: principal.ownerId,
                broadcastRunId,
                audienceRevision: run.audienceRevision,
                sendState: "pending",
              },
              data: {
                sendState: "skipped_ineligible",
                skipReason: firstBlockingSkipReason(verdict),
              },
            });
            if (changed.count === 0) {
              await rereadFinalizedMember(tx, member.id, run.audienceRevision);
            }
            return;
          }

          // Claim the terminal sent state first. The frequency gate/insert below shares this
          // transaction, so failure rolls the claim back and success exposes both atomically.
          const changed = await tx.broadcastAudienceMember.updateMany({
            where: {
              id: member.id,
              ownerId: principal.ownerId,
              broadcastRunId,
              audienceRevision: run.audienceRevision,
              sendState: "pending",
            },
            data: { sendState: "simulated_sent", skipReason: null },
          });
          if (changed.count === 0) {
            await rereadFinalizedMember(tx, member.id, run.audienceRevision);
            return;
          }

          await recordSendFrequencyEventInTransaction(tx, {
            ownerId: principal.ownerId,
            contactId: member.contactId,
            channel: run.channel,
            purposeClass: BROADCAST_PURPOSE_CLASS,
            sourceKind: "broadcast_run",
            sendRef: member.id,
            simulated: true,
            idempotencyKey: key,
          });
        });
      } catch (error) {
        if (error instanceof SendEligibilityError && error.code === "FREQUENCY_CAP_REACHED") {
          await markSkipped(
            member.id,
            run.audienceRevision,
            "frequency:frequency_cap_reached",
          );
          continue;
        }
        throw error;
      }
    }

    // Phase 3 — finish (CAS executing->completed). A concurrent resumer that already completed
    // the run is fine; re-read for truth rather than surface a spurious conflict.
    const done = await db.$transaction(async (tx) => {
      const current = await requireBroadcastRun(tx, principal.ownerId, broadcastRunId);
      if (current.status === "completed") return current;
      const changed = await tx.broadcastRun.updateMany({
        where: { id: broadcastRunId, ownerId: principal.ownerId, status: "executing" },
        data: { status: "completed", revision: { increment: 1 }, updatedAt: at },
      });
      if (changed.count !== 1) {
        const latest = await requireBroadcastRun(tx, principal.ownerId, broadcastRunId);
        if (latest.status !== "completed") fail("CAS_CONFLICT");
        return latest;
      }
      return requireBroadcastRun(tx, principal.ownerId, broadcastRunId);
    });

    const members = await db.broadcastAudienceMember.findMany({
      where: { ownerId: principal.ownerId, broadcastRunId },
      orderBy: [{ id: "asc" }],
    });
    return { ok: true as const, resource: done, members, alreadyComplete: false as const };
  }

  return {
    listBroadcastRuns,
    getBroadcastRun,
    getBroadcastRunLivePreflight,
    getBroadcastComposerOptions,
    previewAudienceEligibility,
    createBroadcastRun,
    freezeAudience,
    confirmBroadcastRun,
    cancelBroadcastRun,
    submitBroadcastRun,
    executeBroadcastRun,
  };
}

export const customerBroadcastService = createCustomerBroadcastService();
