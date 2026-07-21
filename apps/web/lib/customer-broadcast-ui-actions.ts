"use server";

// C5-M3 (issue #388): thin client-callable wrapper over the frozen customer-broadcast
// gateway. Zero business logic — every export passes its input straight to the matching
// gateway call and returns that call's result shape verbatim, so client components never
// import "server-only" gateway internals directly.
//
// Deliberately NOT wrapped: submitBroadcastRun. That gateway call is the hard-disabled REAL
// send chokepoint — it always fails SEND_PATH_UNAVAILABLE (no provider adapter exists, D8/C6
// carriers are absent) and the UI must carry no affordance implying a near-term real send. The
// M3 workbench's "send" affordance is executeBroadcastRun, the SIMULATED executor (zero real
// provider/spend). See customer-broadcast-ui-actions.test.ts for the runtime enumeration test
// that fails if a future edit adds a submitBroadcastRun wrapper here.
//
// getMemberDirectory / getBroadcastComposerOptions are intentionally NOT here: they are loaded
// server-side at page render through the gateway, not re-fetched from the client.
import {
  cancelBroadcastRun as gatewayCancelBroadcastRun,
  confirmBroadcastRun as gatewayConfirmBroadcastRun,
  createBroadcastRun as gatewayCreateBroadcastRun,
  executeBroadcastRun as gatewayExecuteBroadcastRun,
  freezeAudience as gatewayFreezeAudience,
  getBroadcastRun as gatewayGetBroadcastRun,
  getBroadcastRunLivePreflight as gatewayGetBroadcastRunLivePreflight,
  listBroadcastRuns as gatewayListBroadcastRuns,
  previewAudienceEligibility as gatewayPreviewAudienceEligibility,
} from "./customer-broadcast-gateway";
import type {
  BroadcastRunIdInput,
  BroadcastRunLivePreflightInput,
  CancelBroadcastRunInput,
  ConfirmBroadcastRunInput,
  CreateBroadcastRunInput,
  ExecuteBroadcastRunInput,
  FreezeAudienceInput,
  ListBroadcastRunsInput,
  PreviewAudienceEligibilityInput,
} from "./customer-broadcast-service";

export async function listBroadcastRuns(input: ListBroadcastRunsInput = {}) {
  return gatewayListBroadcastRuns(input);
}

export async function getBroadcastRun(input: BroadcastRunIdInput) {
  return gatewayGetBroadcastRun(input);
}

export async function getBroadcastRunLivePreflight(input: BroadcastRunLivePreflightInput) {
  return gatewayGetBroadcastRunLivePreflight(input);
}

export async function previewAudienceEligibility(input: PreviewAudienceEligibilityInput) {
  return gatewayPreviewAudienceEligibility(input);
}

export async function createBroadcastRun(input: CreateBroadcastRunInput) {
  return gatewayCreateBroadcastRun(input);
}

export async function freezeAudience(input: FreezeAudienceInput) {
  return gatewayFreezeAudience(input);
}

export async function confirmBroadcastRun(input: ConfirmBroadcastRunInput) {
  return gatewayConfirmBroadcastRun(input);
}

export async function cancelBroadcastRun(input: CancelBroadcastRunInput) {
  return gatewayCancelBroadcastRun(input);
}

export async function executeBroadcastRun(input: ExecuteBroadcastRunInput) {
  return gatewayExecuteBroadcastRun(input);
}
