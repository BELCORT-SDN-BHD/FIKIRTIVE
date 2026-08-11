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
    "List, search, or read one exact CRM Contact through the same owner-scoped actions the merchant's own screens use. " +
    "$0 read-only. Results include lifecycle, stored identities with their credibility grade, DND, order receipt "
    + "total, and the " +
    "WhatsApp × marketing ConsentStateProjection plus consent history on get. Unknown is reported honestly: it is " +
    "not verified opt-in and remains in the merchant's records. Each identity carries "
    + "`verificationStatus`: `merchant_unverified` means the merchant typed that number himself — it is stored and "
    + "searchable but nothing has confirmed it and it is not used for broadcasts; `channel_verified` means a "
    + "connected channel confirmed it (`verifiedAt`/`verifiedSourceKind` say when and by what). Never describe an "
    + "unverified number as reachable. Never guess a Contact id. " +
    "IMPORTANT: list and search give you ONE PAGE, not the whole list. `returned` is how many contacts are in " +
    "this result, `totalCount` is how many the merchant actually has under the same filter, and `hasMore` is true " +
    "when the rest were left out. Quote both numbers as they are — never re-count the rows, never answer " +
    "\"how many customers do I have\" with `returned`, and never present a page as everything. When they differ, " +
    "say so plainly: they have `totalCount` contacts and you are looking at the first `returned` of them. " +
    "`limit` (up to 100) raises the page size if they want more of it in one go.",
  parameters: params,
  execute: executeReadContacts,
});

export const readContacts = readContactsSkill.tool;
