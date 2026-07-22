"use server";

// C6-M3 (issue #412): thin client-callable wrapper over the frozen broadcast-report
// gateway. Zero business logic — both exports pass their input straight to the matching
// owner-only gateway read and return its result shape verbatim. Report UI routes and client
// components must not import the server-only gateway directly.
//
// Deliberately omitted: every non-report gateway call, every mutation, and every direct
// service/database path. The runtime export-set test fails if this two-read surface widens.
import {
  getBroadcastDeliveryReceipt as gatewayGetBroadcastDeliveryReceipt,
  getCustomerBroadcastReport as gatewayGetCustomerBroadcastReport,
} from "./customer-broadcast-report-gateway";
import type {
  BroadcastDeliveryReceiptInput,
  CustomerBroadcastReportInput,
} from "./customer-broadcast-report-service";

export async function getBroadcastDeliveryReceipt(input: BroadcastDeliveryReceiptInput) {
  return gatewayGetBroadcastDeliveryReceipt(input);
}

export async function getCustomerBroadcastReport(input: CustomerBroadcastReportInput) {
  return gatewayGetCustomerBroadcastReport(input);
}
