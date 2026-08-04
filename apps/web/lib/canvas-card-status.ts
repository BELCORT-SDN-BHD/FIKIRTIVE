/**
 * What state a canvas card is in — the ONE vocabulary, read by everyone who has an opinion (#612).
 *
 * Three parties used to answer this separately and could therefore disagree: the renderer decided
 * which states stop the spinner, the resolve action decided which rows a browser report may
 * change, and the browser decided what to paint locally. A word missing from one of them is not a
 * small bug — a state the renderer does not know puts the card back on the eternal spinner (F21),
 * and a state the resolve action does not protect lets a tab that has fallen behind reopen a card
 * the server already finished.
 *
 * Deliberately NOT in `@fikirtive/core`: this is what a CARD says to a merchant. What a JOB's own
 * ending is called lives with the projection (`canvasTerminalCardStatus`), and the two meet only
 * where the settlement writes a row.
 */

/** A card in one of these has come to rest: it is not being made any more, whatever it says. */
export const TERMINAL_CARD_STATUSES = ["failed", "cancelled", "timeout", "missing"] as const;
export type TerminalCardStatus = (typeof TERMINAL_CARD_STATUSES)[number];

export function isTerminalCardStatus(status: string | undefined): status is TerminalCardStatus {
  return (TERMINAL_CARD_STATUSES as readonly string[]).includes(status ?? "");
}

/**
 * The states a browser's own report may still change — and the whole list, so anything else is
 * settled and belongs to the server.
 *
 * `timeout` is in BOTH lists on purpose, and that is the one subtlety here. It is the browser
 * saying "I stopped watching; it may still finish": to a merchant that is an ending (the card
 * stops pretending to be made), but to the database it is emphatically not the last word — the
 * job may still be running, and the settlement will overwrite it with what actually happened.
 * `pending` is the card while the job runs. Everything else — done, failed, cancelled, missing,
 * deleted — is a settled answer, and a report about an older state of the world may not touch it.
 */
export const OVERWRITABLE_CARD_STATUSES = ["pending", "timeout"] as const;

export function isOverwritableCardStatus(status: string | undefined): boolean {
  return (OVERWRITABLE_CARD_STATUSES as readonly string[]).includes(status ?? "");
}
