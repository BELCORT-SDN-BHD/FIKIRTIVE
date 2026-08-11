/** manageContacts — $0 Contact create/update/import/consent/DND parity (B0-59/60/C1). */
import type { RunContext } from "@openai/agents";
import { z } from "zod";
import { defineOttoSkill } from "../skill.js";
import type { OttoContext } from "../context.js";

const lifecycleStage = z.enum(["New", "Active", "Dormant"]);
const params = z.object({
  operation: z.enum([
    "create",
    "update",
    "import_csv",
    "record_consent",
    "set_dnd",
    "add_phone",
    "update_phone",
    "remove_phone",
  ]),
  contactId: z.string().trim().min(1).max(64).optional().describe(
    "update/record_consent/set_dnd/add_phone/update_phone/remove_phone: exact Contact id returned "
      + "by readContacts. Never guess.",
  ),
  identityId: z.string().trim().min(1).max(64).optional().describe(
    "update_phone/remove_phone: exact identity id from readContacts. Only a merchant-entered "
      + "number can be edited or removed; a channel-verified one is refused.",
  ),
  phone: z.string().trim().min(1).max(64).optional().describe(
    "add_phone/update_phone: the number as the merchant says it. A number with no country code "
      + "is read as Malaysian (+60) and stored in full international form.",
  ),
  name: z.string().trim().min(1).max(200).optional(),
  lifecycleStage: lifecycleStage.optional(),
  patch: z.object({
    name: z.string().trim().min(1).max(200).optional(),
    lifecycleStage: lifecycleStage.optional(),
  }).strict().optional(),
  csv: z.string().min(1).max(256_000).optional().describe(
    "import_csv: CSV text with name and optional lifecycle_stage, consent, phone/whatsapp, email columns.",
  ),
  importId: z.string().regex(/^\S{1,128}$/).optional().describe(
    "import_csv: caller-stable opaque id for this exact import attempt; reuse it on retry.",
  ),
  consentAction: z.enum(["grant", "revoke"]).optional().describe(
    "record_consent: merchant-reported assertion only. This never creates verified customer consent.",
  ),
  requestId: z.string().regex(/^\S{1,128}$/).optional().describe(
    "record_consent/set_dnd: caller-stable opaque id for this exact attempt; reuse it on retry.",
  ),
  enabled: z.boolean().optional().describe("set_dnd: true sets DND; false clears DND."),
}).strict();

type ManageContactsInput = z.infer<typeof params>;

export async function executeManageContacts(
  input: ManageContactsInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<unknown> {
  const contacts = runContext?.context?.contacts;
  if (!contacts) return { ok: false, error: "CRM contacts aren't available right now." };

  switch (input.operation) {
    case "create":
      if (!input.name) return { ok: false, error: "create needs `name`." };
      return contacts.create({ name: input.name, lifecycleStage: input.lifecycleStage });
    case "update":
      if (!input.contactId || !input.patch || Object.keys(input.patch).length === 0) {
        return { ok: false, error: "update needs exact `contactId` and at least one field in `patch`." };
      }
      return contacts.update({ contactId: input.contactId, patch: input.patch });
    case "import_csv":
      if (!input.csv || !input.importId) {
        return { ok: false, error: "import_csv needs `csv` and a caller-stable `importId`." };
      }
      return contacts.importCsv({ csv: input.csv, importId: input.importId });
    case "record_consent":
      if (!input.contactId || !input.consentAction || !input.requestId) {
        return { ok: false, error: "record_consent needs exact `contactId`, `consentAction`, and `requestId`." };
      }
      return contacts.recordConsent({
        contactId: input.contactId,
        action: input.consentAction,
        requestId: input.requestId,
      });
    case "set_dnd":
      if (!input.contactId || input.enabled === undefined || !input.requestId) {
        return { ok: false, error: "set_dnd needs exact `contactId`, `enabled`, and `requestId`." };
      }
      return contacts.setDnd({ contactId: input.contactId, enabled: input.enabled, requestId: input.requestId });
    case "add_phone":
      if (!input.contactId || !input.phone) {
        return { ok: false, error: "add_phone needs exact `contactId` and `phone`." };
      }
      return contacts.addPhone({ contactId: input.contactId, phone: input.phone });
    case "update_phone":
      if (!input.contactId || !input.identityId || !input.phone) {
        return { ok: false, error: "update_phone needs exact `contactId`, `identityId`, and `phone`." };
      }
      return contacts.updatePhone({
        contactId: input.contactId,
        identityId: input.identityId,
        phone: input.phone,
      });
    case "remove_phone":
      if (!input.contactId || !input.identityId) {
        return { ok: false, error: "remove_phone needs exact `contactId` and `identityId`." };
      }
      return contacts.removePhone({ contactId: input.contactId, identityId: input.identityId });
  }
}

export const manageContactsSkill = defineOttoSkill({
  name: "manageContacts",
  cost: "free",
  effect: "write",
  reach: "internal",
  description:
    "Create or update standard CRM Contact fields, import a bounded CSV, store or correct a merchant-entered phone " +
    "number, record a merchant-reported consent assertion, or set/clear DND through the same authenticated actions as " +
    "the merchant's own screens use. $0 internal writes only. Inputs are structured and never accept owner identity. Phone numbers stored " +
    "here — typed or imported — are saved as merchant entered and NOT verified: they are kept and searchable, they are " +
    "never used for broadcasts or segments, and only a connected channel can upgrade one. Say so plainly instead of " +
    "implying a stored number can be messaged. update_phone/remove_phone touch merchant-entered numbers only; a " +
    "channel-verified number is refused. No merge/unmerge, send, provider, money, tags, or custom-field path exists. " +
    "record_consent enters ConsentEvent as crm_manual backfill/asserted and never fabricates verified opt-in. " +
    "Use caller-stable request/import ids on retries and get exact Contact ids from readContacts.",
  parameters: params,
  execute: executeManageContacts,
});

export const manageContacts = manageContactsSkill.tool;
