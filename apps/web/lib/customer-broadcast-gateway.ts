import "server-only";

import { prisma } from "@fikirtive/db";
import { runAsUser, type UserPrincipal } from "@fikirtive/db/principal";
import { isOrgRole } from "@fikirtive/core";
import { requireOwner } from "./auth-guard";
import { isImpersonating } from "./better-auth/compat";
import {
  CustomerBroadcastError,
  customerBroadcastService,
  type BroadcastRunIdInput,
  type BroadcastRunLivePreflightInput,
  type CancelBroadcastRunInput,
  type ConfirmBroadcastRunInput,
  type CreateBroadcastRunInput,
  type CustomerBroadcastErrorCode,
  type CustomerBroadcastPrincipal,
  type ExecuteBroadcastRunInput,
  type FreezeAudienceInput,
  type ListBroadcastRunsInput,
  type PreviewAudienceEligibilityInput,
  type SubmitBroadcastRunInput,
} from "./customer-broadcast-service";
import { MemberDirectoryError, memberDirectoryService } from "./member-directory-service";

type GatewayFailure = { ok: false; error: CustomerBroadcastErrorCode };

/**
 * #463 — this gateway is one of the four request-level principal SEAMS (design contract §2-v2).
 *
 * ONE resolved principal, used for both jobs: it is the frame runAsUser pushes into the
 * AsyncLocalStorage store, and it is the same object the service layer receives as its
 * `CustomerBroadcastPrincipal` (which it structurally satisfies — the services read `ownerId`,
 * `membershipId` and `impersonating` and nothing else). It comes out of the one membership
 * query that was already here — widened by three selected columns, with no extra round trip.
 *
 * Single value on purpose (#470). The previous `{ service, ambient }` composite could only be
 * proved by teaching the auth-guard fence per-property provenance of a destructured composite,
 * and that capability was proved bypassable. Handing the services a freshly rebuilt look-alike
 * would fail the fence for the same reason it fails a spread rebuild: a re-manufactured object
 * carries no provenance. The query must be scoped by the resolved principal itself.
 */
type ResolvedPrincipal = UserPrincipal & { membershipId: string };

async function resolvePrincipal(): Promise<ResolvedPrincipal> {
  const gate = await requireOwner();
  if ("error" in gate) throw new CustomerBroadcastError("NOT_AUTHORIZED");

  const membership = await prisma.membership.findFirst({
    where: {
      orgId: gate.ownerId,
      status: "active",
      deletedAt: null,
      user: { email: gate.email },
    },
    select: { id: true, role: true, userId: true },
  });
  if (!membership) throw new CustomerBroadcastError("ACTION_DENIED");

  const impersonating = await isImpersonating();
  return {
    kind: "user",
    subjectUserId: membership.userId,
    subjectEmail: gate.email,
    ownerId: gate.ownerId,
    orgRole: isOrgRole(membership.role) ? membership.role : null,
    membershipId: membership.id,
    impersonating,
    // #463 never carries the impersonator's id — see @fikirtive/db/principal (deferred to ②-D).
    impersonatedByBaUserId: null,
  };
}

async function runRead<T>(
  operation: (principal: CustomerBroadcastPrincipal) => Promise<T>,
): Promise<{ ok: true; resource: T } | GatewayFailure> {
  try {
    const principal = await resolvePrincipal();
    return { ok: true, resource: await runAsUser(principal, () => operation(principal)) };
  } catch (error) {
    if (error instanceof CustomerBroadcastError) return { ok: false, error: error.code };
    // MemberDirectoryError shares the NOT_AUTHORIZED/ACTION_DENIED codes; surface them the same way.
    if (error instanceof MemberDirectoryError) return { ok: false, error: error.code };
    throw error;
  }
}

async function runMutation<T>(
  operation: (principal: CustomerBroadcastPrincipal) => Promise<T>,
): Promise<T | GatewayFailure> {
  try {
    const principal = await resolvePrincipal();
    return await runAsUser(principal, () => operation(principal));
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

export async function getBroadcastRunLivePreflight(input: BroadcastRunLivePreflightInput) {
  return runRead((principal) => customerBroadcastService.getBroadcastRunLivePreflight(principal, input));
}

export async function getBroadcastComposerOptions() {
  return runRead((principal) => customerBroadcastService.getBroadcastComposerOptions(principal));
}

/**
 * #27 member directory + server-derived self read. The principal (owner + self membership) is
 * resolved from the authenticated session — never from client input.
 */
export async function getMemberDirectory() {
  return runRead((principal) =>
    memberDirectoryService.listMemberDirectory({ ownerId: principal.ownerId, membershipId: principal.membershipId }),
  );
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

export async function executeBroadcastRun(input: ExecuteBroadcastRunInput) {
  return runMutation((principal) => customerBroadcastService.executeBroadcastRun(principal, input));
}
