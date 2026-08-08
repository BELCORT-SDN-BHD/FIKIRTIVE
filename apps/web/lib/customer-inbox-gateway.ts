import "server-only";

import { prisma } from "@fikirtive/db";
import { runAsUser, type UserPrincipal } from "@fikirtive/db/principal";
import {
  effectiveOrgRoles,
  orgRolesAllow,
  primaryOrgRole,
} from "@fikirtive/core";
import { requireOwner } from "./auth-guard";
import { isImpersonating } from "./better-auth/compat";
import { MemberDirectoryError, memberDirectoryService } from "./member-directory-service";
import {
  CustomerInboxError,
  customerInboxService,
  type AssignConversationInput,
  type ConversationIdInput,
  type CreateMessageTemplateInput,
  type CreateMessageTemplateVersionInput,
  type CustomerInboxErrorCode,
  type CustomerInboxPrincipal,
  type GetHistoryInput,
  type HandOffConversationInput,
  type ListConversationsInput,
  type ListTemplatesInput,
  type RequestAutomationResumeInput,
  type SaveConversationDraftInput,
  type SearchConversationsInput,
  type SetConversationStatusInput,
  type SubmitConversationReplyInput,
  type SubmitTemplateReviewInput,
} from "./customer-inbox-service";

/** #729 — `detail` is present only for refusals whose reason depends on what was submitted;
 *  it is the same merchant-facing sentence whether the call came from the UI or straight
 *  from a script. Every other failure keeps the bare code and its fixed copy. */
type GatewayFailure = { ok: false; error: CustomerInboxErrorCode; detail?: string };

function failure(error: CustomerInboxError | MemberDirectoryError): GatewayFailure {
  const detail = error instanceof CustomerInboxError ? error.detail : undefined;
  return detail ? { ok: false, error: error.code, detail } : { ok: false, error: error.code };
}

/**
 * #463 — this gateway is one of the four request-level principal SEAMS (design contract §2-v2).
 *
 * `service` is byte-for-byte the object the service layer has always received; `ambient` is the
 * full identity pushed into the AsyncLocalStorage store by runRead/runMutation and handed to
 * NOBODY. Both come out of the one membership query that was already here — widened by three
 * selected columns, with no extra round trip.
 */
type ResolvedPrincipal = { service: CustomerInboxPrincipal; ambient: UserPrincipal };

async function resolvePrincipal(): Promise<ResolvedPrincipal> {
  const gate = await requireOwner();
  if ("error" in gate) throw new CustomerInboxError("NOT_AUTHORIZED");

  const membership = await prisma.membership.findFirst({
    where: {
      orgId: gate.ownerId,
      status: "active",
      deletedAt: null,
      user: { email: gate.email },
    },
    select: { id: true, userId: true, roles: { select: { role: true } } },
  });
  if (!membership) throw new CustomerInboxError("ACTION_DENIED");
  const orgRoles = effectiveOrgRoles(
    membership.roles.map((assignment) => assignment.role),
  );
  if (!orgRolesAllow(orgRoles, "inbox.read")) {
    throw new CustomerInboxError("ACTION_DENIED");
  }

  const impersonating = await isImpersonating();
  return {
    service: { ownerId: gate.ownerId, membershipId: membership.id, impersonating },
    ambient: {
      kind: "user",
      subjectUserId: membership.userId,
      subjectEmail: gate.email,
      ownerId: gate.ownerId,
      orgRole: primaryOrgRole(orgRoles),
      membershipId: membership.id,
      impersonating,
      // #463 never carries the impersonator's id — see @fikirtive/db/principal (deferred to ②-D).
      impersonatedByBaUserId: null,
    },
  };
}

async function runRead<T>(
  operation: (principal: CustomerInboxPrincipal) => Promise<T>,
): Promise<{ ok: true; resource: T } | GatewayFailure> {
  try {
    const { service, ambient } = await resolvePrincipal();
    return { ok: true, resource: await runAsUser(ambient, () => operation(service)) };
  } catch (error) {
    if (error instanceof CustomerInboxError) return failure(error);
    // MemberDirectoryError shares the NOT_AUTHORIZED/ACTION_DENIED codes; surface them the same
    // way. Its own members.read re-check runs after this gateway's inbox.read check, so a
    // membership edited between the two lands here — and the conversation route reads through a
    // single Promise.all, where a throw would take the whole page down instead of one panel.
    if (error instanceof MemberDirectoryError) return failure(error);
    throw error;
  }
}

async function runMutation<T>(
  operation: (principal: CustomerInboxPrincipal) => Promise<T>,
): Promise<T | GatewayFailure> {
  try {
    const { service, ambient } = await resolvePrincipal();
    return await runAsUser(ambient, () => operation(service));
  } catch (error) {
    if (error instanceof CustomerInboxError) return failure(error);
    throw error;
  }
}

export async function listConversations(input: ListConversationsInput = {}) {
  return runRead((principal) => customerInboxService.listConversations(principal, input));
}

export async function getConversation(input: ConversationIdInput) {
  return runRead((principal) => customerInboxService.getConversation(principal, input));
}

export async function searchConversations(input: SearchConversationsInput) {
  return runRead((principal) => customerInboxService.searchConversations(principal, input));
}

export async function getHistory(input: GetHistoryInput) {
  return runRead((principal) => customerInboxService.getHistory(principal, input));
}

export async function getConversationPreflight(input: ConversationIdInput) {
  return runRead((principal) =>
    customerInboxService.getConversationPreflight(principal, input),
  );
}

export async function listTemplates(input: ListTemplatesInput = {}) {
  return runRead((principal) => customerInboxService.listTemplates(principal, input));
}

// #495 — server-side read for the templates page, so its create form can offer the
// workspace's connected channel accounts instead of a free-text scope id.
export async function listChannelScopes() {
  return runRead((principal) => customerInboxService.listChannelScopes(principal));
}

/**
 * #725 — the same read-only member directory the broadcast workbench already uses (#27), so
 * Inbox assignment can name teammates instead of asking the merchant to type a membership id
 * that no screen in the product shows. The principal comes from the authenticated session, and
 * the directory service independently re-checks `members.read` on top of this gateway's
 * `inbox.read` gate: neither tenant scope nor capability is widened by reusing it here.
 */
export async function getMemberDirectory() {
  return runRead((principal) =>
    memberDirectoryService.listMemberDirectory({
      ownerId: principal.ownerId,
      membershipId: principal.membershipId,
    }),
  );
}

export async function saveConversationDraft(input: SaveConversationDraftInput) {
  return runMutation((principal) =>
    customerInboxService.saveConversationDraft(principal, input),
  );
}

export async function assignConversation(input: AssignConversationInput) {
  return runMutation((principal) =>
    customerInboxService.assignConversation(principal, input),
  );
}

export async function handOffConversation(input: HandOffConversationInput) {
  return runMutation((principal) =>
    customerInboxService.handOffConversation(principal, input),
  );
}

export async function setConversationStatus(input: SetConversationStatusInput) {
  return runMutation((principal) =>
    customerInboxService.setConversationStatus(principal, input),
  );
}

export async function requestAutomationResume(input: RequestAutomationResumeInput) {
  return runMutation((principal) =>
    customerInboxService.requestAutomationResume(principal, input),
  );
}

export async function createMessageTemplate(input: CreateMessageTemplateInput) {
  return runMutation((principal) =>
    customerInboxService.createMessageTemplate(principal, input),
  );
}

export async function createMessageTemplateVersion(input: CreateMessageTemplateVersionInput) {
  return runMutation((principal) =>
    customerInboxService.createMessageTemplateVersion(principal, input),
  );
}

export async function submitConversationReply(input: SubmitConversationReplyInput) {
  return runMutation((principal) =>
    customerInboxService.submitConversationReply(principal, input),
  );
}

export async function submitTemplateReview(input: SubmitTemplateReviewInput) {
  return runMutation((principal) =>
    customerInboxService.submitTemplateReview(principal, input),
  );
}
