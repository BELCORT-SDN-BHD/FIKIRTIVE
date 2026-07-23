import type { CrmConsentState } from "./crm-view-data";

export const CRM_CONSENT_LABELS: Record<CrmConsentState["state"], string> = {
  unknown: "Unknown",
  verified_grant: "Verified opt-in",
  effective_revoke: "Opted out",
};
