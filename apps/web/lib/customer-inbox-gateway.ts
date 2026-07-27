import "server-only";

import { prisma } from "@fikirtive/db";
import { runAsUser, type UserPrincipal } from "@fikirtive/db/principal";
import { isOrgRole } from "@fikirtive/core";
import { requireOwner } from "./auth-guard";
import { isImpersonating } from "./better-auth/compat";
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
  type TakeOverConversationInput,
} from "./customer-inbox-service";

type GatewayFailure = { ok: false; error: CustomerInboxErrorCode };

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
    select: { id: true, role: true, userId: true },
  });
  if (!membership) throw new CustomerInboxError("ACTION_DENIED");

  const impersonating = await isImpersonating();
  return {
    service: { ownerId: gate.ownerId, membershipId: membership.id, impersonating },
    ambient: {
      kind: "user",
      subjectUserId: membership.userId,
      subjectEmail: gate.email,
      ownerId: gate.ownerId,
      orgRole: isOrgRole(membership.role) ? membership.role : null,
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
    if (error instanceof CustomerInboxError) return { ok: false, error: error.code };
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
    if (error instanceof CustomerInboxError) return { ok: false, error: error.code };
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

export async function takeOverConversation(input: TakeOverConversationInput) {
  return runMutation((principal) =>
    customerInboxService.takeOverConversation(principal, input),
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
