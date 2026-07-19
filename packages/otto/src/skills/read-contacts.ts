/** readContacts — $0 Contact/consent read parity (B0-59/60/C1). */
import type { RunContext } from "@openai/agents";
import { z } from "zod";
import { defineOttoSkill } from "../skill.js";
import type { OttoContext } from "../context.js";

const params = z.object({
  operation: z.enum(["list", "get", "search"]),
  contactId: z.string().trim().min(1).max(64).optional().describe(
    "get: exact Contact id returned by list/search. Never guess an id.",
  ),
  query: z.string().trim().min(1).max(200).optional().describe(
    "search: contact name or read-only identity text.",
  ),
  lifecycleStage: z.enum(["New", "Active", "Dormant"]).optional(),
  limit: z.number().int().min(1).max(100).optional(),
}).strict();

type ReadContactsInput = z.infer<typeof params>;

export async function executeReadContacts(
  input: ReadContactsInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<unknown> {
  const contacts = runContext?.context?.contacts;
  if (!contacts) return { ok: false, error: "CRM contacts aren't available right now." };

  switch (input.operation) {
    case "list":
      return contacts.list({ lifecycleStage: input.lifecycleStage, limit: input.limit });
    case "get":
      if (!input.contactId) return { ok: false, error: "get needs the exact `contactId` from list or search." };
      return contacts.get(input.contactId);
    case "search":
      if (!input.query) return { ok: false, error: "search needs a non-empty `query`." };
      return contacts.search({ query: input.query, lifecycleStage: input.lifecycleStage, limit: input.limit });
  }
}

export const readContactsSkill = defineOttoSkill({
  name: "readContacts",
  cost: "free",
  effect: "read",
  reach: "internal",
  description:
    "List, search, or read one exact CRM Contact through the same owner-scoped actions as the Contacts pages. " +
    "$0 read-only. Results include lifecycle, existing read-only identities, DND, order receipt total, and the " +
    "WhatsApp × marketing ConsentStateProjection plus consent history on get. Unknown is reported honestly: it is " +
    "not verified opt-in and remains in the merchant's records. Never guess a Contact id.",
  parameters: params,
  execute: executeReadContacts,
});

export const readContacts = readContactsSkill.tool;
