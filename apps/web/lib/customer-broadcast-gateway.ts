import "server-only";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "./auth-guard";
import { isImpersonating } from "./better-auth/compat";
import {
  CustomerBroadcastError,
  customerBroadcastService,
  type BroadcastRunIdInput,
  type CancelBroadcastRunInput,
  type ConfirmBroadcastRunInput,
  type CreateBroadcastRunInput,
  type CustomerBroadcastErrorCode,
  type CustomerBroadcastPrincipal,
  type FreezeAudienceInput,
  type ListBroadcastRunsInput,
  type PreviewAudienceEligibilityInput,
  type SubmitBroadcastRunInput,
} from "./customer-broadcast-service";

type GatewayFailure = { ok: false; error: CustomerBroadcastErrorCode };

async function resolvePrincipal(): Promise<CustomerBroadcastPrincipal> {
  const gate = await requireOwner();
  if ("error" in gate) throw new CustomerBroadcastError("NOT_AUTHORIZED");

  const membership = await prisma.membership.findFirst({
    where: {
      orgId: gate.ownerId,
      status: "active",
      deletedAt: null,
      user: { email: gate.email },
    },
    select: { id: true },
  });
  if (!membership) throw new CustomerBroadcastError("ACTION_DENIED");

  return {
    ownerId: gate.ownerId,
    membershipId: membership.id,
    impersonating: await isImpersonating(),
  };
}

async function runRead<T>(
  operation: (principal: CustomerBroadcastPrincipal) => Promise<T>,
): Promise<{ ok: true; resource: T } | GatewayFailure> {
  try {
    return { ok: true, resource: await operation(await resolvePrincipal()) };
  } catch (error) {
    if (error instanceof CustomerBroadcastError) return { ok: false, error: error.code };
    throw error;
  }
}

async function runMutation<T>(
  operation: (principal: CustomerBroadcastPrincipal) => Promise<T>,
): Promise<T | GatewayFailure> {
  try {
    return await operation(await resolvePrincipal());
  } catch (error) {
    if (error instanceof CustomerBroadcastError) return { ok: false, error: error.code };
    throw error;
  }
}

export async function listBroadcastRuns(input: ListBroadcastRunsInput = {}) {
  return runRead((principal) => customerBroadcastService.listBroadcastRuns(principal, input));
}

export async function getBroadcastRun(input: BroadcastRunIdInput) {
  return runRead((principal) => customerBroadcastService.getBroadcastRun(principal, input));
}

export async function previewAudienceEligibility(input: PreviewAudienceEligibilityInput) {
  return runRead((principal) => customerBroadcastService.previewAudienceEligibility(principal, input));
}

export async function createBroadcastRun(input: CreateBroadcastRunInput) {
  return runMutation((principal) => customerBroadcastService.createBroadcastRun(principal, input));
}

export async function freezeAudience(input: FreezeAudienceInput) {
  return runMutation((principal) => customerBroadcastService.freezeAudience(principal, input));
}

export async function confirmBroadcastRun(input: ConfirmBroadcastRunInput) {
  return runMutation((principal) => customerBroadcastService.confirmBroadcastRun(principal, input));
}

export async function cancelBroadcastRun(input: CancelBroadcastRunInput) {
  return runMutation((principal) => customerBroadcastService.cancelBroadcastRun(principal, input));
}

export async function submitBroadcastRun(input: SubmitBroadcastRunInput) {
  return runMutation((principal) => customerBroadcastService.submitBroadcastRun(principal, input));
}
