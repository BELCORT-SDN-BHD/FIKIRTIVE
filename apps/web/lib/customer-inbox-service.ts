import "server-only";

import { createHash } from "node:crypto";
import { newId } from "@fikirtive/core";
import { prisma as defaultDb, type Prisma } from "@fikirtive/db";

export const CUSTOMER_INBOX_ERROR_CODES = {
  NOT_AUTHORIZED: "NOT_AUTHORIZED",
  RESOURCE_NOT_FOUND: "RESOURCE_NOT_FOUND",
  ACTION_DENIED: "ACTION_DENIED",
  IMPERSONATION_READ_ONLY: "IMPERSONATION_READ_ONLY",
  CAS_CONFLICT: "CAS_CONFLICT",
  TAKEOVER_REQUIRED: "TAKEOVER_REQUIRED",
  IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_CONFLICT",
  SEND_PATH_UNAVAILABLE: "SEND_PATH_UNAVAILABLE",
  TEMPLATE_SUBMISSION_UNAVAILABLE: "TEMPLATE_SUBMISSION_UNAVAILABLE",
  INVALID_ARGUMENT: "INVALID_ARGUMENT",
} as const;

export type CustomerInboxErrorCode =
  (typeof CUSTOMER_INBOX_ERROR_CODES)[keyof typeof CUSTOMER_INBOX_ERROR_CODES];

export class CustomerInboxError extends Error {
  constructor(public readonly code: CustomerInboxErrorCode) {
    super(code);
    this.name = "CustomerInboxError";
  }
}

export type CustomerInboxPrincipal = {
  ownerId: string;
  membershipId: string;
  impersonating?: boolean;
};

export type CustomerInboxExternalAdapter = {
  submitTemplateReview(input: unknown): Promise<unknown>;
  submitReply(input: unknown): Promise<unknown>;
};

export type CustomerConversationView = "all" | "mine" | "unassigned" | "needs_reply";

export type ListConversationsInput = {
  view?: CustomerConversationView;
  limit?: number;
};

export type ConversationIdInput = { conversationId: string };

export type GetHistoryInput = ConversationIdInput & { limit?: number };

export type SearchConversationsInput = {
  query: string;
  limit?: number;
};

export type ListTemplatesInput = {
  channelScopeId?: string;
  limit?: number;
};

export type SaveConversationDraftInput = {
  conversationId: string;
  conversationBaseRevision: number;
  draftBaseRevision: number | null;
  text: string;
};

export type AssignConversationInput = {
  conversationId: string;
  expectedRevision: number;
  targetMembershipId: string | null;
};

export type TakeOverConversationInput = {
  conversationId: string;
  expectedRevision: number;
};

export type HandOffConversationInput = {
  conversationId: string;
  expectedRevision: number;
  targetMembershipId: string;
  note?: string;
};

export type SetConversationStatusInput = {
  conversationId: string;
  expectedRevision: number;
  status: "open" | "closed";
};

export type RequestAutomationResumeInput = {
  conversationId: string;
  expectedRevision: number;
  note?: string;
};

export type CreateMessageTemplateInput = {
  channelScopeId: string;
  channel: string;
  name: string;
  locale: string;
};

export type MessageTemplateVariable = {
  key: string;
  sample: string;
};

export type CreateMessageTemplateVersionInput = {
  templateId: string;
  body: string;
  variables: MessageTemplateVariable[];
};

export type SubmitConversationReplyInput = {
  conversationId: string;
  conversationRevision: number;
  draftRevision: number;
};

export type SubmitTemplateReviewInput = {
  templateVersionId: string;
  reviewRevision: number;
};

export type NormalizedInboundMessageInput = {
  ownerId: string;
  contactIdentityId: string;
  sourceEventKey: string;
  sourcePayloadHash: string;
  canonicalizationVersion: string;
  text: string;
  externalMessageRef?: string;
  occurredAt?: Date;
};

type ActiveRole = "owner" | "admin" | "member";
type DatabaseClient = typeof defaultDb | Prisma.TransactionClient;

type MutationResult<T> = {
  ok: true;
  resource: T;
  change: {
    id: string;
    revision: number;
    kind: string;
    actor: { kind: "merchant_member" | "system"; membershipId: string | null };
  };
};

const ACTIVE_ROLES = new Set<ActiveRole>(["owner", "admin", "member"]);
const CONVERSATION_VIEWS = new Set<CustomerConversationView>([
  "all",
  "mine",
  "unassigned",
  "needs_reply",
]);
const MAX_TEXT = 4_096;
const MAX_NOTE = 1_000;
const MAX_SEARCH = 200;
const MAX_TEMPLATE_NAME = 128;
const MAX_LOCALE = 32;
const MAX_VARIABLES = 20;
// Page size for the needs_reply keyset scan (Task 1, ledger #359 item 21). Bounded so
// every DB round-trip stays cheap regardless of tenant size; see listConversations.
const NEEDS_REPLY_PAGE_SIZE = 50;
// Control-character class per docs/superpowers/specs/2026-07-19-c4a-inbox-whatsapp-physical-contract.md
// §5.3. Tab/newline/CR are deliberately excluded — message and draft bodies legitimately
// contain them. Also rejects C1 controls (U+0080-U+009F) and the Unicode line/paragraph
// separators (U+2028/U+2029), which are as unsafe in stored text as the C0 controls above.
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\u0080-\u009F\u2028\u2029]/;

function fail(code: CustomerInboxErrorCode): never {
  throw new CustomerInboxError(code);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function requiredString(value: unknown, max: number): string {
  if (!isNonEmptyString(value) || value.length > max || CONTROL_CHARS.test(value)) {
    fail("INVALID_ARGUMENT");
  }
  return value.trim();
}

function boundedOptionalString(value: unknown, max: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  return requiredString(value, max);
}

function boundedDraftText(value: unknown): string {
  if (typeof value !== "string" || value.length > MAX_TEXT || CONTROL_CHARS.test(value)) {
    fail("INVALID_ARGUMENT");
  }
  return value;
}

function revision(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0) fail("INVALID_ARGUMENT");
  return value as number;
}

function limit(value: unknown, fallback = 50): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 50) {
    fail("INVALID_ARGUMENT");
  }
  return value as number;
}

function hash(label: string, value: unknown): string {
  return createHash("sha256")
    .update(label)
    .update("\0")
    .update(JSON.stringify(value))
    .digest("hex");
}

function prismaCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

class RetryInboundWrite extends Error {}

export function createCustomerInboxService(
  options: {
    db?: typeof defaultDb;
    externalAdapter?: CustomerInboxExternalAdapter;
    clock?: () => Date;
    id?: () => string;
  } = {},
) {
  const db = options.db ?? defaultDb;
  const clock = options.clock ?? (() => new Date());
  const issueId = options.id ?? newId;

  // The adapter is accepted only so contract tests can inject a recorder and prove
  // that the two external methods have no reachable call. M2 never invokes it.
  void options.externalAdapter;

  const now = () => new Date(clock().getTime());

  async function activeMembership(
    client: DatabaseClient,
    principal: CustomerInboxPrincipal,
  ): Promise<{ id: string; role: ActiveRole } | null> {
    if (!isNonEmptyString(principal?.ownerId) || !isNonEmptyString(principal?.membershipId)) {
      fail("NOT_AUTHORIZED");
    }
    const row = await client.membership.findFirst({
      where: {
        id: principal.membershipId,
        orgId: principal.ownerId,
        status: "active",
        deletedAt: null,
      },
      select: { id: true, role: true },
    });
    if (!row || !ACTIVE_ROLES.has(row.role as ActiveRole)) return null;
    return { id: row.id, role: row.role as ActiveRole };
  }

  async function auditImpersonation(
    principal: CustomerInboxPrincipal,
    operation: string,
    outcome: "read" | "write_denied",
  ): Promise<void> {
    const write = db.actionEvent.create({
      data: {
        id: issueId(),
        ownerId: principal.ownerId,
        type: `c4.inbox.impersonation.${outcome}`,
        payload: { membershipId: principal.membershipId, operation },
        createdAt: now(),
      },
    });
    try {
      await write;
    } catch {
      fail("ACTION_DENIED");
    }
  }

  async function requireReadMembership(
    principal: CustomerInboxPrincipal,
    operation: string,
  ): Promise<{ id: string; role: ActiveRole }> {
    const membership = await activeMembership(db, principal);
    if (!membership) fail("ACTION_DENIED");
    if (principal.impersonating) {
      await auditImpersonation(principal, operation, "read");
    }
    return membership;
  }

  async function requireWriteMembership(
    principal: CustomerInboxPrincipal,
    operation: string,
  ): Promise<{ id: string; role: ActiveRole }> {
    const membership = await activeMembership(db, principal);
    if (!membership) fail("ACTION_DENIED");
    if (principal.impersonating) {
      await auditImpersonation(principal, operation, "write_denied");
      fail("IMPERSONATION_READ_ONLY");
    }
    return membership;
  }

  async function requireConversation(
    client: DatabaseClient,
    ownerId: string,
    conversationId: string,
  ) {
    const row = await client.customerConversation.findFirst({
      where: { id: conversationId, ownerId },
    });
    if (!row) fail("RESOURCE_NOT_FOUND");
    return row;
  }

  async function requireAssignableMembership(
    client: DatabaseClient,
    ownerId: string,
    membershipId: string,
  ): Promise<{ id: string; role: ActiveRole }> {
    const row = await client.membership.findFirst({
      where: { id: membershipId, orgId: ownerId, status: "active", deletedAt: null },
      select: { id: true, role: true },
    });
    if (!row || !ACTIVE_ROLES.has(row.role as ActiveRole)) fail("RESOURCE_NOT_FOUND");
    return { id: row.id, role: row.role as ActiveRole };
  }

  function requireMemberAssignment(
    membership: { id: string; role: ActiveRole },
    assigneeMembershipId: string | null,
  ): void {
    if (membership.role === "member" && assigneeMembershipId !== membership.id) {
      fail("ACTION_DENIED");
    }
  }

  async function commitConversationEvent(
    tx: Prisma.TransactionClient,
    args: {
      principal: CustomerInboxPrincipal;
      current: Awaited<ReturnType<typeof requireConversation>>;
      expectedRevision: number;
      kind:
        | "assigned"
        | "unassigned"
        | "takeover"
        | "handoff"
        | "automation_resume_requested"
        | "opened"
        | "closed";
      data?: {
        assigneeMembershipId?: string | null;
        automationState?: string;
        status?: string;
      };
      fromAssigneeMembershipId?: string | null;
      toAssigneeMembershipId?: string | null;
      fromAutomationState?: string | null;
      toAutomationState?: string | null;
      note?: string | null;
    },
  ): Promise<MutationResult<Awaited<ReturnType<typeof requireConversation>>>> {
    if (args.current.revision !== args.expectedRevision) fail("CAS_CONFLICT");
    const at = now();
    const nextRevision = args.expectedRevision + 1;
    const changed = await tx.customerConversation.updateMany({
      where: {
        id: args.current.id,
        ownerId: args.principal.ownerId,
        revision: args.expectedRevision,
      },
      data: {
        ...args.data,
        revision: { increment: 1 },
        lastActivityAt: at,
      },
    });
    if (changed.count !== 1) fail("CAS_CONFLICT");

    const eventId = issueId();
    await tx.customerConversationEvent.create({
      data: {
        id: eventId,
        ownerId: args.principal.ownerId,
        conversationId: args.current.id,
        revision: nextRevision,
        kind: args.kind,
        actorKind: "merchant_member",
        actorMembershipId: args.principal.membershipId,
        fromAssigneeMembershipId: args.fromAssigneeMembershipId,
        toAssigneeMembershipId: args.toAssigneeMembershipId,
        fromAutomationState: args.fromAutomationState,
        toAutomationState: args.toAutomationState,
        note: args.note,
        idempotencyKey: `${args.current.id}:${nextRevision}:${args.kind}`,
        createdAt: at,
      },
    });

    const resource = await requireConversation(
      tx,
      args.principal.ownerId,
      args.current.id,
    );
    return {
      ok: true,
      resource,
      change: {
        id: eventId,
        revision: nextRevision,
        kind: args.kind,
        actor: { kind: "merchant_member", membershipId: args.principal.membershipId },
      },
    };
  }

  async function listConversations(
    principal: CustomerInboxPrincipal,
    input: ListConversationsInput = {},
  ) {
    const membership = await requireReadMembership(principal, "listConversations");
    const view = input.view ?? "all";
    if (!CONVERSATION_VIEWS.has(view)) fail("INVALID_ARGUMENT");
    const take = limit(input.limit);
    const where: Prisma.CustomerConversationWhereInput = { ownerId: principal.ownerId };
    if (view === "mine") where.assigneeMembershipId = membership.id;
    if (view === "unassigned") where.assigneeMembershipId = null;

    const include = {
      contactIdentity: {
        select: {
          id: true,
          channel: true,
          externalId: true,
          handle: true,
          label: true,
          contact: { select: { id: true, name: true, lifecycleStage: true } },
        },
      },
      assigneeMembership: { select: { id: true, role: true } },
      messages: {
        orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
        take: 1,
        select: {
          id: true,
          direction: true,
          kind: true,
          contentJson: true,
          receivedAt: true,
        },
      },
    } satisfies Prisma.CustomerConversationInclude;

    function projectAttention(row: { status: string; messages: { direction: string }[] }) {
      return row.status === "open" && row.messages[0]?.direction === "inbound"
        ? "needs_reply"
        : row.status === "open" && row.messages[0]?.direction === "outbound"
          ? "waiting_on_customer"
          : "none";
    }

    if (view === "needs_reply") {
      // needs_reply is necessarily status:"open"; pushing that down means a burst of
      // closed-thread activity can no longer crowd a genuine match out of the query
      // window. The last-message direction can't also be pushed down — Prisma has no
      // "latest related row" predicate without raw SQL — so it's still derived per page
      // below. Rather than loading every open conversation into memory in one shot, walk
      // bounded pages of NEEDS_REPLY_PAGE_SIZE rows in (lastActivityAt, id) keyset order,
      // derive attention per page, and accumulate matches until `take` is satisfied or
      // pages run out. Every round-trip carries a fixed, bounded `take`, so a tenant with
      // thousands of open conversations no longer pays a full scan on every call — this
      // is the "两段查询" (two-stage/keyset-batched query) option from ledger #359 item 21;
      // a materialized attention column was the other approved option but would require a
      // schema change, which is out of scope for this service-layer pass.
      where.status = "open";
      type MatchRow = Prisma.CustomerConversationGetPayload<{ include: typeof include }> & {
        attention: string;
      };
      const matches: MatchRow[] = [];
      let cursor: { lastActivityAt: Date; id: string } | null = null;
      for (;;) {
        const pageWhere: Prisma.CustomerConversationWhereInput = cursor
          ? {
              AND: [
                where,
                {
                  OR: [
                    { lastActivityAt: { lt: cursor.lastActivityAt } },
                    { lastActivityAt: cursor.lastActivityAt, id: { lt: cursor.id } },
                  ],
                },
              ],
            }
          : where;
        const rows = await db.customerConversation.findMany({
          where: pageWhere,
          orderBy: [{ lastActivityAt: "desc" }, { id: "desc" }],
          take: NEEDS_REPLY_PAGE_SIZE,
          include,
        });
        if (rows.length === 0) break;
        for (const row of rows) {
          const attention = projectAttention(row);
          if (attention === "needs_reply") {
            matches.push({ ...row, attention });
            if (matches.length >= take) break;
          }
        }
        if (matches.length >= take || rows.length < NEEDS_REPLY_PAGE_SIZE) break;
        const last = rows[rows.length - 1];
        cursor = { lastActivityAt: last.lastActivityAt, id: last.id };
      }
      return matches;
    }

    const rows = await db.customerConversation.findMany({
      where,
      orderBy: [{ lastActivityAt: "desc" }, { id: "desc" }],
      take,
      include,
    });
    return rows.map((row) => ({ ...row, attention: projectAttention(row) }));
  }

  async function getConversation(
    principal: CustomerInboxPrincipal,
    input: ConversationIdInput,
  ) {
    await requireReadMembership(principal, "getConversation");
    const conversationId = requiredString(input?.conversationId, 256);
    const row = await db.customerConversation.findFirst({
      where: { id: conversationId, ownerId: principal.ownerId },
      include: {
        contactIdentity: {
          select: {
            id: true,
            channel: true,
            externalId: true,
            handle: true,
            label: true,
            contact: { select: { id: true, name: true, lifecycleStage: true } },
          },
        },
        assigneeMembership: { select: { id: true, role: true } },
        draft: true,
      },
    });
    if (!row) fail("RESOURCE_NOT_FOUND");
    return row;
  }

  async function searchConversations(
    principal: CustomerInboxPrincipal,
    input: SearchConversationsInput,
  ) {
    await requireReadMembership(principal, "searchConversations");
    const query = requiredString(input?.query, MAX_SEARCH);
    const take = limit(input?.limit);
    return db.customerConversation.findMany({
      where: {
        ownerId: principal.ownerId,
        OR: [
          {
            contactIdentity: {
              contact: { name: { contains: query, mode: "insensitive" } },
            },
          },
          {
            messages: {
              some: {
                ownerId: principal.ownerId,
                searchText: { contains: query, mode: "insensitive" },
              },
            },
          },
        ],
      },
      orderBy: [{ lastActivityAt: "desc" }, { id: "desc" }],
      take,
      include: {
        contactIdentity: {
          select: { id: true, channel: true, contact: { select: { id: true, name: true } } },
        },
        messages: {
          orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
          take: 1,
          select: { id: true, direction: true, kind: true, contentJson: true, receivedAt: true },
        },
      },
    });
  }

  async function getHistory(principal: CustomerInboxPrincipal, input: GetHistoryInput) {
    await requireReadMembership(principal, "getHistory");
    const conversationId = requiredString(input?.conversationId, 256);
    const take = limit(input?.limit);
    await requireConversation(db, principal.ownerId, conversationId);
    const [messageRows, eventRows, draft] = await Promise.all([
      db.customerMessage.findMany({
        where: { ownerId: principal.ownerId, conversationId },
        orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
        take,
      }),
      db.customerConversationEvent.findMany({
        where: { ownerId: principal.ownerId, conversationId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take,
      }),
      db.customerConversationDraft.findFirst({
        where: { ownerId: principal.ownerId, conversationId },
      }),
    ]);
    return { messages: messageRows.reverse(), events: eventRows.reverse(), draft };
  }

  async function getConversationPreflight(
    principal: CustomerInboxPrincipal,
    input: ConversationIdInput,
  ) {
    const membership = await requireReadMembership(principal, "getConversationPreflight");
    const conversationId = requiredString(input?.conversationId, 256);
    const conversation = await requireConversation(db, principal.ownerId, conversationId);
    const memberMayAct =
      membership.role !== "member" || conversation.assigneeMembershipId === membership.id;
    return {
      conversation: {
        id: conversation.id,
        revision: conversation.revision,
        status: conversation.status,
        automationState: conversation.automationState,
      },
      internalCapability: {
        status: memberMayAct ? "pass" : "block",
        source: "active_membership_and_assignment",
      },
      connection: { status: "unknown", source: "stored_evidence_unavailable" },
      d8Carrier: { status: "unavailable", source: "not_implemented" },
      consentStop: { status: "unknown", source: "c5_not_read_in_m2" },
      doNotDisturb: { status: "unknown", source: "c5_not_read_in_m2" },
      providerRefusal: { status: "unknown", source: "c5_not_read_in_m2" },
      frequency: { status: "unknown", source: "c5_not_read_in_m2" },
      exactApproval: { status: "unavailable", source: "d8_not_implemented" },
      sendEligibility: { status: "unavailable", reason: "SEND_PATH_UNAVAILABLE" },
      checkedAt: now(),
    } as const;
  }

  async function listTemplates(
    principal: CustomerInboxPrincipal,
    input: ListTemplatesInput = {},
  ) {
    await requireReadMembership(principal, "listTemplates");
    const take = limit(input.limit);
    const channelScopeId = input.channelScopeId
      ? requiredString(input.channelScopeId, 256)
      : undefined;
    return db.customerMessageTemplate.findMany({
      where: {
        ownerId: principal.ownerId,
        ...(channelScopeId ? { channelScopeId } : {}),
      },
      orderBy: [{ archivedAt: "asc" }, { name: "asc" }, { id: "asc" }],
      take,
      include: {
        versions: { orderBy: { revision: "desc" }, take: 20 },
        channelScope: { select: { id: true, channel: true, scopeKey: true } },
      },
    });
  }

  async function saveConversationDraft(
    principal: CustomerInboxPrincipal,
    input: SaveConversationDraftInput,
  ) {
    await requireWriteMembership(principal, "saveConversationDraft");
    const conversationId = requiredString(input?.conversationId, 256);
    const conversationBaseRevision = revision(input?.conversationBaseRevision);
    const draftBaseRevision =
      input?.draftBaseRevision === null ? null : revision(input?.draftBaseRevision);
    const text = boundedDraftText(input?.text);
    const at = now();

    try {
      return await db.$transaction(async (tx) => {
        const membership = await activeMembership(tx, principal);
        if (!membership) fail("ACTION_DENIED");
        const conversation = await requireConversation(tx, principal.ownerId, conversationId);
        requireMemberAssignment(membership, conversation.assigneeMembershipId);
        if (conversation.automationState === "otto_active") fail("TAKEOVER_REQUIRED");
        if (conversation.revision !== conversationBaseRevision) fail("CAS_CONFLICT");

        const current = await tx.customerConversationDraft.findFirst({
          where: { ownerId: principal.ownerId, conversationId },
        });
        const contentJson = { schemaVersion: 1, type: "text", text } as const;
        const contentHash = hash("customer-draft:v1", contentJson);
        let nextRevision: number;
        if (!current) {
          if (draftBaseRevision !== null) fail("CAS_CONFLICT");
          nextRevision = 0;
          await tx.customerConversationDraft.create({
            data: {
              ownerId: principal.ownerId,
              conversationId,
              revision: nextRevision,
              conversationRevision: conversationBaseRevision,
              authorKind: "merchant_member",
              authorMembershipId: membership.id,
              contentJson,
              contentHash,
              updatedAt: at,
            },
          });
        } else {
          if (draftBaseRevision === null || current.revision !== draftBaseRevision) {
            fail("CAS_CONFLICT");
          }
          nextRevision = draftBaseRevision + 1;
          const changed = await tx.customerConversationDraft.updateMany({
            where: {
              ownerId: principal.ownerId,
              conversationId,
              revision: draftBaseRevision,
            },
            data: {
              revision: { increment: 1 },
              conversationRevision: conversationBaseRevision,
              authorKind: "merchant_member",
              authorMembershipId: membership.id,
              contentJson,
              contentHash,
              updatedAt: at,
            },
          });
          if (changed.count !== 1) fail("CAS_CONFLICT");
        }
        const resource = await tx.customerConversationDraft.findFirstOrThrow({
          where: { ownerId: principal.ownerId, conversationId },
        });
        return {
          ok: true,
          resource,
          change: {
            id: conversationId,
            revision: nextRevision,
            kind: "draft_saved",
            actor: { kind: "merchant_member" as const, membershipId: membership.id },
          },
        };
      });
    } catch (error) {
      if (error instanceof CustomerInboxError) throw error;
      if (prismaCode(error) === "P2002") fail("CAS_CONFLICT");
      throw error;
    }
  }

  async function assignConversation(
    principal: CustomerInboxPrincipal,
    input: AssignConversationInput,
  ) {
    await requireWriteMembership(principal, "assignConversation");
    const conversationId = requiredString(input?.conversationId, 256);
    const expectedRevision = revision(input?.expectedRevision);
    const targetMembershipId =
      input?.targetMembershipId === null
        ? null
        : requiredString(input?.targetMembershipId, 256);
    return db.$transaction(async (tx) => {
      const membership = await activeMembership(tx, principal);
      if (!membership) fail("ACTION_DENIED");
      const current = await requireConversation(tx, principal.ownerId, conversationId);
      const target = targetMembershipId
        ? await requireAssignableMembership(tx, principal.ownerId, targetMembershipId)
        : null;
      if (membership.role === "member") {
        if (!target || target.id !== membership.id || current.assigneeMembershipId !== null) {
          fail("ACTION_DENIED");
        }
      }
      if (current.assigneeMembershipId === (target?.id ?? null)) fail("INVALID_ARGUMENT");
      return commitConversationEvent(tx, {
        principal,
        current,
        expectedRevision,
        kind: target ? "assigned" : "unassigned",
        data: { assigneeMembershipId: target?.id ?? null },
        fromAssigneeMembershipId: current.assigneeMembershipId,
        toAssigneeMembershipId: target?.id ?? null,
      });
    });
  }

  async function takeOverConversation(
    principal: CustomerInboxPrincipal,
    input: TakeOverConversationInput,
  ) {
    await requireWriteMembership(principal, "takeOverConversation");
    const conversationId = requiredString(input?.conversationId, 256);
    const expectedRevision = revision(input?.expectedRevision);
    return db.$transaction(async (tx) => {
      const membership = await activeMembership(tx, principal);
      if (!membership) fail("ACTION_DENIED");
      const current = await requireConversation(tx, principal.ownerId, conversationId);
      requireMemberAssignment(membership, current.assigneeMembershipId);
      if (current.automationState !== "otto_active") fail("ACTION_DENIED");
      return commitConversationEvent(tx, {
        principal,
        current,
        expectedRevision,
        kind: "takeover",
        data: { automationState: "paused_by_human" },
        fromAutomationState: current.automationState,
        toAutomationState: "paused_by_human",
      });
    });
  }

  async function handOffConversation(
    principal: CustomerInboxPrincipal,
    input: HandOffConversationInput,
  ) {
    await requireWriteMembership(principal, "handOffConversation");
    const conversationId = requiredString(input?.conversationId, 256);
    const expectedRevision = revision(input?.expectedRevision);
    const targetMembershipId = requiredString(input?.targetMembershipId, 256);
    const note = boundedOptionalString(input?.note, MAX_NOTE);
    return db.$transaction(async (tx) => {
      const membership = await activeMembership(tx, principal);
      if (!membership) fail("ACTION_DENIED");
      const current = await requireConversation(tx, principal.ownerId, conversationId);
      requireMemberAssignment(membership, current.assigneeMembershipId);
      const target = await requireAssignableMembership(
        tx,
        principal.ownerId,
        targetMembershipId,
      );
      if (current.assigneeMembershipId === target.id) fail("INVALID_ARGUMENT");
      return commitConversationEvent(tx, {
        principal,
        current,
        expectedRevision,
        kind: "handoff",
        data: { assigneeMembershipId: target.id },
        fromAssigneeMembershipId: current.assigneeMembershipId,
        toAssigneeMembershipId: target.id,
        note,
      });
    });
  }

  async function setConversationStatus(
    principal: CustomerInboxPrincipal,
    input: SetConversationStatusInput,
  ) {
    await requireWriteMembership(principal, "setConversationStatus");
    const conversationId = requiredString(input?.conversationId, 256);
    const expectedRevision = revision(input?.expectedRevision);
    if (input?.status !== "open" && input?.status !== "closed") fail("INVALID_ARGUMENT");
    return db.$transaction(async (tx) => {
      const membership = await activeMembership(tx, principal);
      if (!membership) fail("ACTION_DENIED");
      const current = await requireConversation(tx, principal.ownerId, conversationId);
      requireMemberAssignment(membership, current.assigneeMembershipId);
      if (current.status === input.status) fail("INVALID_ARGUMENT");
      return commitConversationEvent(tx, {
        principal,
        current,
        expectedRevision,
        kind: input.status === "open" ? "opened" : "closed",
        data: { status: input.status },
      });
    });
  }

  async function requestAutomationResume(
    principal: CustomerInboxPrincipal,
    input: RequestAutomationResumeInput,
  ) {
    const caller = await requireWriteMembership(principal, "requestAutomationResume");
    if (caller.role === "member") fail("ACTION_DENIED");
    const conversationId = requiredString(input?.conversationId, 256);
    const expectedRevision = revision(input?.expectedRevision);
    const note = boundedOptionalString(input?.note, MAX_NOTE);
    return db.$transaction(async (tx) => {
      const membership = await activeMembership(tx, principal);
      if (!membership || membership.role === "member") fail("ACTION_DENIED");
      const current = await requireConversation(tx, principal.ownerId, conversationId);
      return commitConversationEvent(tx, {
        principal,
        current,
        expectedRevision,
        kind: "automation_resume_requested",
        // The request is visible, but M2 never writes otto_active.
        fromAutomationState: current.automationState,
        toAutomationState: current.automationState,
        note,
      });
    });
  }

  async function createMessageTemplate(
    principal: CustomerInboxPrincipal,
    input: CreateMessageTemplateInput,
  ) {
    const caller = await requireWriteMembership(principal, "createMessageTemplate");
    if (caller.role === "member") fail("ACTION_DENIED");
    const channelScopeId = requiredString(input?.channelScopeId, 256);
    const channel = requiredString(input?.channel, 64);
    const name = requiredString(input?.name, MAX_TEMPLATE_NAME);
    const locale = requiredString(input?.locale, MAX_LOCALE);
    const at = now();
    try {
      return await db.$transaction(async (tx) => {
        const membership = await activeMembership(tx, principal);
        if (!membership || membership.role === "member") fail("ACTION_DENIED");
        const scope = await tx.channelScope.findFirst({
          where: { id: channelScopeId, ownerId: principal.ownerId, channel },
          select: { id: true },
        });
        if (!scope) fail("RESOURCE_NOT_FOUND");
        const templateId = issueId();
        const resource = await tx.customerMessageTemplate.create({
          data: {
            id: templateId,
            ownerId: principal.ownerId,
            channelScopeId,
            channel,
            name,
            locale,
            createdAt: at,
          },
        });
        return {
          ok: true,
          resource,
          change: {
            id: templateId,
            revision: 0,
            kind: "template_created",
            actor: { kind: "merchant_member" as const, membershipId: membership.id },
          },
        };
      });
    } catch (error) {
      if (error instanceof CustomerInboxError) throw error;
      if (prismaCode(error) === "P2002") fail("CAS_CONFLICT");
      throw error;
    }
  }

  async function createMessageTemplateVersion(
    principal: CustomerInboxPrincipal,
    input: CreateMessageTemplateVersionInput,
  ) {
    const caller = await requireWriteMembership(principal, "createMessageTemplateVersion");
    if (caller.role === "member") fail("ACTION_DENIED");
    const templateId = requiredString(input?.templateId, 256);
    const body = requiredString(input?.body, MAX_TEXT);
    if (!Array.isArray(input?.variables) || input.variables.length > MAX_VARIABLES) {
      fail("INVALID_ARGUMENT");
    }
    const variables = input.variables.map((variable) => ({
      key: requiredString(variable?.key, 64),
      sample: requiredString(variable?.sample, 256),
    }));
    if (new Set(variables.map((variable) => variable.key)).size !== variables.length) {
      fail("INVALID_ARGUMENT");
    }
    const definitionJson = { schemaVersion: 1, body, variables } as const;
    const contentHash = hash("customer-template:v1", definitionJson);
    const at = now();
    try {
      return await db.$transaction(async (tx) => {
        const membership = await activeMembership(tx, principal);
        if (!membership || membership.role === "member") fail("ACTION_DENIED");
        const template = await tx.customerMessageTemplate.findFirst({
          where: { id: templateId, ownerId: principal.ownerId, archivedAt: null },
          select: { id: true },
        });
        if (!template) fail("RESOURCE_NOT_FOUND");
        const latest = await tx.customerMessageTemplateVersion.findFirst({
          where: { ownerId: principal.ownerId, templateId },
          orderBy: { revision: "desc" },
          select: { revision: true },
        });
        const nextRevision = (latest?.revision ?? 0) + 1;
        const versionId = issueId();
        const resource = await tx.customerMessageTemplateVersion.create({
          data: {
            id: versionId,
            ownerId: principal.ownerId,
            templateId,
            revision: nextRevision,
            purposeClass: "proactive_non_transactional",
            category: "marketing",
            definitionJson,
            contentHash,
            submissionState: "draft",
            reviewState: "not_submitted",
            availabilityState: "unavailable",
            reviewRevision: 0,
            createdByMembershipId: membership.id,
            createdAt: at,
            updatedAt: at,
          },
        });
        return {
          ok: true,
          resource,
          change: {
            id: versionId,
            revision: nextRevision,
            kind: "template_version_created",
            actor: { kind: "merchant_member" as const, membershipId: membership.id },
          },
        };
      });
    } catch (error) {
      if (error instanceof CustomerInboxError) throw error;
      if (prismaCode(error) === "P2002") fail("CAS_CONFLICT");
      throw error;
    }
  }

  async function writeNormalizedInbound(input: NormalizedInboundMessageInput) {
    const ownerId = requiredString(input?.ownerId, 256);
    const contactIdentityId = requiredString(input?.contactIdentityId, 256);
    const sourceEventKey = requiredString(input?.sourceEventKey, 512);
    const sourcePayloadHash = requiredString(input?.sourcePayloadHash, 256);
    const canonicalizationVersion = requiredString(input?.canonicalizationVersion, 64);
    const text = requiredString(input?.text, MAX_TEXT);
    const externalMessageRef = boundedOptionalString(input?.externalMessageRef, 512);
    if (input?.occurredAt !== undefined && Number.isNaN(input.occurredAt.getTime())) {
      fail("INVALID_ARGUMENT");
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await db.$transaction(async (tx) => {
          const duplicate = await tx.customerMessage.findFirst({
            where: { ownerId, sourceEventKey },
          });
          if (duplicate) {
            if (duplicate.sourcePayloadHash !== sourcePayloadHash) {
              fail("IDEMPOTENCY_CONFLICT");
            }
            return {
              ok: true,
              duplicate: true,
              resource: duplicate,
              conversationRevision: null,
            } as const;
          }

          const identity = await tx.contactIdentity.findFirst({
            where: {
              id: contactIdentityId,
              ownerId,
              deletedAt: null,
              channelScopeId: { not: null },
              contact: { ownerId, deletedAt: null },
              channelScope: { ownerId },
            },
            select: { id: true },
          });
          if (!identity) fail("RESOURCE_NOT_FOUND");

          const at = now();
          let conversation = await tx.customerConversation.findFirst({
            where: { ownerId, contactIdentityId },
          });
          let conversationRevision: number;
          if (!conversation) {
            const conversationId = issueId();
            conversationRevision = 1;
            conversation = await tx.customerConversation.create({
              data: {
                id: conversationId,
                ownerId,
                contactIdentityId,
                status: "open",
                automationState: "disabled",
                revision: conversationRevision,
                lastMessageAt: at,
                lastActivityAt: at,
                createdAt: at,
                updatedAt: at,
              },
            });
          } else {
            conversationRevision = conversation.revision + 1;
            const changed = await tx.customerConversation.updateMany({
              where: { id: conversation.id, ownerId, revision: conversation.revision },
              data: {
                status: "open",
                revision: { increment: 1 },
                lastMessageAt: at,
                lastActivityAt: at,
              },
            });
            if (changed.count !== 1) throw new RetryInboundWrite();
            if (conversation.status === "closed") {
              await tx.customerConversationEvent.create({
                data: {
                  id: issueId(),
                  ownerId,
                  conversationId: conversation.id,
                  revision: conversationRevision,
                  kind: "opened",
                  actorKind: "system",
                  fromAutomationState: conversation.automationState,
                  toAutomationState: conversation.automationState,
                  idempotencyKey: `${conversation.id}:${conversationRevision}:opened:inbound`,
                  createdAt: at,
                },
              });
            }
          }

          const contentJson = { schemaVersion: 1, type: "text", text } as const;
          const message = await tx.customerMessage.create({
            data: {
              id: issueId(),
              ownerId,
              conversationId: conversation.id,
              direction: "inbound",
              actorKind: "customer",
              kind: "text",
              contentJson,
              searchText: text,
              contentHash: hash("customer-message:v1", contentJson),
              sourceEventKey,
              sourcePayloadHash,
              canonicalizationVersion,
              externalMessageRef,
              occurredAt: input.occurredAt,
              receivedAt: at,
              createdAt: at,
            },
          });
          return {
            ok: true,
            duplicate: false,
            resource: message,
            conversationRevision,
          } as const;
        });
      } catch (error) {
        if (error instanceof CustomerInboxError) throw error;
        if (error instanceof RetryInboundWrite || prismaCode(error) === "P2002") {
          if (attempt < 2) continue;
          fail("CAS_CONFLICT");
        }
        throw error;
      }
    }
    fail("CAS_CONFLICT");
  }

  async function submitConversationReply(
    principal: CustomerInboxPrincipal,
    input: SubmitConversationReplyInput,
  ): Promise<never> {
    await requireWriteMembership(principal, "submitConversationReply");
    const conversationId = requiredString(input?.conversationId, 256);
    revision(input?.conversationRevision);
    revision(input?.draftRevision);
    await requireConversation(db, principal.ownerId, conversationId);
    // Deliberately no adapter call: D8/C5/C6 carriers do not exist yet.
    fail("SEND_PATH_UNAVAILABLE");
  }

  async function submitTemplateReview(
    principal: CustomerInboxPrincipal,
    input: SubmitTemplateReviewInput,
  ): Promise<never> {
    const membership = await requireWriteMembership(principal, "submitTemplateReview");
    if (membership.role === "member") fail("ACTION_DENIED");
    const templateVersionId = requiredString(input?.templateVersionId, 256);
    revision(input?.reviewRevision);
    const versionRow = await db.customerMessageTemplateVersion.findFirst({
      where: { id: templateVersionId, ownerId: principal.ownerId },
      select: { id: true },
    });
    if (!versionRow) fail("RESOURCE_NOT_FOUND");
    // Deliberately no adapter call: provider submission authority is absent in M2.
    fail("TEMPLATE_SUBMISSION_UNAVAILABLE");
  }

  return {
    listConversations,
    getConversation,
    searchConversations,
    getHistory,
    getConversationPreflight,
    listTemplates,
    saveConversationDraft,
    assignConversation,
    takeOverConversation,
    handOffConversation,
    setConversationStatus,
    requestAutomationResume,
    createMessageTemplate,
    createMessageTemplateVersion,
    writeNormalizedInbound,
    submitConversationReply,
    submitTemplateReview,
  };
}

export const customerInboxService = createCustomerInboxService();
