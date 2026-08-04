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
import {
  CustomerBroadcastReportError,
  createCustomerBroadcastReportService,
  type BroadcastDeliveryReceiptInput,
  type CustomerBroadcastReportErrorCode,
  type CustomerBroadcastReportInput,
  type CustomerBroadcastReportPrincipal,
} from "./customer-broadcast-report-service";

type GatewayFailure = { ok: false; error: CustomerBroadcastReportErrorCode };

/**
 * #463 — this gateway is one of the four request-level principal SEAMS (design contract §2-v2).
 *
 * `service` is byte-for-byte the object the service layer has always received; `ambient` is the
 * full identity pushed into the AsyncLocalStorage store by runRead and handed to NOBODY. Both
 * come out of the one membership query that was already here — widened by three selected
 * columns, with no extra round trip.
 */
type ResolvedPrincipal = { service: CustomerBroadcastReportPrincipal; ambient: UserPrincipal };

async function resolvePrincipal(): Promise<ResolvedPrincipal> {
  const gate = await requireOwner();
  if ("error" in gate) throw new CustomerBroadcastReportError("NOT_AUTHORIZED");
  const membership = await prisma.membership.findFirst({
    where: {
      orgId: gate.ownerId,
      status: "active",
      deletedAt: null,
      user: { email: gate.email },
    },
    select: { id: true, userId: true, roles: { select: { role: true } } },
  });
  if (!membership) throw new CustomerBroadcastReportError("ACTION_DENIED");
  const orgRoles = effectiveOrgRoles(
    membership.roles.map((assignment) => assignment.role),
  );
  if (!orgRolesAllow(orgRoles, "broadcast.report.read")) {
    throw new CustomerBroadcastReportError("ACTION_DENIED");
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
  operation: (principal: CustomerBroadcastReportPrincipal) => Promise<T>,
): Promise<{ ok: true; resource: T } | GatewayFailure> {
  try {
    const { service, ambient } = await resolvePrincipal();
    return { ok: true, resource: await runAsUser(ambient, () => operation(service)) };
  } catch (error) {
    if (error instanceof CustomerBroadcastReportError) return { ok: false, error: error.code };
    throw error;
  }
}

export async function getBroadcastDeliveryReceipt(input: BroadcastDeliveryReceiptInput) {
  return runRead((principal) =>
    createCustomerBroadcastReportService(prisma).getBroadcastDeliveryReceipt(principal, input),
  );
}

export async function getCustomerBroadcastReport(input: CustomerBroadcastReportInput) {
  return runRead((principal) =>
    createCustomerBroadcastReportService(prisma).getCustomerBroadcastReport(principal, input),
  );
}
