"use server";

// C4b-M3 (issue #378): thin client-callable wrapper over the frozen customer-inbox
// gateway. Zero business logic — every export passes its input straight to the
// matching gateway call and returns that call's result shape verbatim, so client
// components never need `import "server-only"` gateway internals directly.
//
// Deliberately NOT wrapped: submitConversationReply, submitTemplateReview. Both
// gateway calls always fail (SEND_PATH_UNAVAILABLE / TEMPLATE_SUBMISSION_UNAVAILABLE
// — no provider adapter exists yet) and the UI must carry no affordance that implies
// a near-term send path. See customer-inbox-ui-actions.test.ts for the runtime
// enumeration test that fails if a future edit adds a wrapper for either call.
import {
  assignConversation as gatewayAssignConversation,
  createMessageTemplate as gatewayCreateMessageTemplate,
  createMessageTemplateVersion as gatewayCreateMessageTemplateVersion,
  getConversation as gatewayGetConversation,
  getConversationPreflight as gatewayGetConversationPreflight,
  getHistory as gatewayGetHistory,
  handOffConversation as gatewayHandOffConversation,
  listConversations as gatewayListConversations,
  listTemplates as gatewayListTemplates,
  requestAutomationResume as gatewayRequestAutomationResume,
  saveConversationDraft as gatewaySaveConversationDraft,
  searchConversations as gatewaySearchConversations,
  setConversationStatus as gatewaySetConversationStatus,
  takeOverConversation as gatewayTakeOverConversation,
} from "./customer-inbox-gateway";
import type {
  AssignConversationInput,
  ConversationIdInput,
  CreateMessageTemplateInput,
  CreateMessageTemplateVersionInput,
  GetHistoryInput,
  HandOffConversationInput,
  ListConversationsInput,
  ListTemplatesInput,
  RequestAutomationResumeInput,
  SaveConversationDraftInput,
  SearchConversationsInput,
  SetConversationStatusInput,
  TakeOverConversationInput,
} from "./customer-inbox-service";

export async function listConversations(input: ListConversationsInput = {}) {
  return gatewayListConversations(input);
}

export async function getConversation(input: ConversationIdInput) {
  return gatewayGetConversation(input);
}

export async function searchConversations(input: SearchConversationsInput) {
  return gatewaySearchConversations(input);
}

export async function getHistory(input: GetHistoryInput) {
  return gatewayGetHistory(input);
}

export async function getConversationPreflight(input: ConversationIdInput) {
  return gatewayGetConversationPreflight(input);
}

export async function listTemplates(input: ListTemplatesInput = {}) {
  return gatewayListTemplates(input);
}

export async function saveConversationDraft(input: SaveConversationDraftInput) {
  // customer-inbox-service.ts's saveConversationDraft has no explicit return-type
  // annotation, so its `ok: true` literal widens to `ok: boolean` at the type level
  // (unlike the commitConversationEvent-backed mutations, which do). Discriminating on
  // "error" in result (present only on the failure shape) rather than the widened `ok`
  // re-asserts the literal — a type-only fix; the runtime value is untouched — done in
  // this file rather than the frozen service.
  const result = await gatewaySaveConversationDraft(input);
  if ("error" in result) return result;
  return { ...result, ok: true as const };
}

export async function assignConversation(input: AssignConversationInput) {
  return gatewayAssignConversation(input);
}

export async function takeOverConversation(input: TakeOverConversationInput) {
  return gatewayTakeOverConversation(input);
}

export async function handOffConversation(input: HandOffConversationInput) {
  return gatewayHandOffConversation(input);
}

export async function setConversationStatus(input: SetConversationStatusInput) {
  return gatewaySetConversationStatus(input);
}

export async function requestAutomationResume(input: RequestAutomationResumeInput) {
  return gatewayRequestAutomationResume(input);
}

export async function createMessageTemplate(input: CreateMessageTemplateInput) {
  // Same type-only literal fix as saveConversationDraft above — see that comment.
  const result = await gatewayCreateMessageTemplate(input);
  if ("error" in result) return result;
  return { ...result, ok: true as const };
}

export async function createMessageTemplateVersion(input: CreateMessageTemplateVersionInput) {
  // Same type-only literal fix as saveConversationDraft above — see that comment.
  const result = await gatewayCreateMessageTemplateVersion(input);
  if ("error" in result) return result;
  return { ...result, ok: true as const };
}
