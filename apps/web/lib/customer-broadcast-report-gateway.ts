import "server-only";

import { prisma } from "@fikirtive/db";
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

async function resolvePrincipal(): Promise<CustomerBroadcastReportPrincipal> {
  const gate = await requireOwner();
  if ("error" in gate) throw new CustomerBroadcastReportError("NOT_AUTHORIZED");
  const membership = await prisma.membership.findFirst({
    where: {
      orgId: gate.ownerId,
      role: "owner",
      status: "active",
      deletedAt: null,
      user: { email: gate.email },
    },
    select: { id: true },
  });
  if (!membership) throw new CustomerBroadcastReportError("ACTION_DENIED");
  return {
    ownerId: gate.ownerId,
    membershipId: membership.id,
    impersonating: await isImpersonating(),
  };
}

async function runRead<T>(
  operation: (principal: CustomerBroadcastReportPrincipal) => Promise<T>,
): Promise<{ ok: true; resource: T } | GatewayFailure> {
  try {
    return { ok: true, resource: await operation(await resolvePrincipal()) };
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
