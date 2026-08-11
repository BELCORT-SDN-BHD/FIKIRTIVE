/**
 * otto-contact-view — the contact-list boundary for Otto's chat surface (#742).
 *
 * `listContacts` / `searchContacts` return ONE PAGE plus the two facts that make the page
 * honest: `totalCount` (how many rows the same owner-scoped filter has) and `hasMore`. The
 * Contacts page has printed both since #715 — "Showing 50 of 65 contacts". Otto's port used
 * to map the rows and drop the counts, so the merchant asking "how many customers do I have"
 * got an answer built from a list that had already been cut, with nothing in the payload
 * saying so. Same silence, different mouth.
 *
 * So the counts travel WITH the rows across this boundary, the way currency travels with an
 * amount in otto-money-view: the shape is what holds, not a sentence telling the model to
 * remember. `returned` is stated rather than left to be counted — two counts are two answers.
 *
 * Pure and IO-free on purpose: the same function the port uses can be run over a real
 * owner-scoped read in a test, so "what the page says" and "what Otto is handed" are checked
 * against one another instead of against a mock.
 */
import type { CrmContactRow, CrmContactsResult } from "./crm-view-data";

/** One contact as Otto receives it — the page's own row, with its dates as text. */
export function contactForOtto(contact: CrmContactRow) {
  return {
    ...contact,
    firstTouchAt: contact.firstTouchAt.toISOString(),
    lastSeenAt: contact.lastSeenAt.toISOString(),
    createdAt: contact.createdAt.toISOString(),
    consentState: {
      ...contact.consentState,
      lastReceivedAt: contact.consentState.lastReceivedAt?.toISOString() ?? null,
    },
    // #803 — the credibility grade crosses WITH the number, for the same reason the page counts
    // cross with the rows: a number handed over bare reads as a number Otto can act on.
    identities: contact.identities.map((identity) => ({
      ...identity,
      verifiedAt: identity.verifiedAt?.toISOString() ?? null,
    })),
  };
}

/**
 * A page of contacts as Otto receives it: the rows, how many are in them, and how many exist.
 * An error passes through untouched — a failed read must never arrive looking like an empty
 * workspace.
 */
export function contactPageForOtto(result: CrmContactsResult) {
  if (!("ok" in result)) return result;
  const contacts = result.contacts.map(contactForOtto);
  return {
    ok: true as const,
    contacts,
    returned: contacts.length,
    totalCount: result.totalCount,
    hasMore: result.hasMore,
  };
}
