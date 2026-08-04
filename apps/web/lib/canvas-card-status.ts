/**
 * What state a canvas card is in — the ONE vocabulary, read by everyone who has an opinion
 * (#612 T2c, closed into a finite algebra by #602 T3 · spec #599 D4).
 *
 * Three parties used to answer this separately and could therefore disagree: the renderer decided
 * which states stop the spinner, the resolve action decided which rows a browser report may
 * change, and the browser decided what to paint locally. A word missing from one of them is not a
 * small bug — a state the renderer does not know puts the card back on the eternal spinner (F21),
 * and a state the resolve action does not protect lets a tab that has fallen behind reopen a card
 * the server already finished.
 *
 * TWO vocabularies live here, and keeping them apart is the whole point:
 *
 *   - the ROW words, which are what the database may store. Finite and enforced by a check
 *     constraint (`CanvasNode_status_check`), so a word nobody planned for cannot be written at
 *     all — before T3 the create action passed the browser's string straight through.
 *   - the FACE words, which are what a merchant reads off a card. A face is DERIVED, never
 *     stored: the same stored row is `queued` while its job waits and `generating` once it runs,
 *     and only the job row knows which. `canvasCardFace` is the one place that derivation happens.
 *
 * Deliberately NOT in `@fikirtive/core`: this is what a CARD says to a merchant. What a JOB's own
 * ending is called lives with the projection (`canvasTerminalCardStatus`), and the two meet only
 * where the settlement writes a row.
 */

/**
 * EVERY WORD A CARD ROW MAY CARRY — the finite set the database enforces (#602 T3).
 *
 * Enumerated from the writers, and there are only five of them post-T2d:
 *   - `createCanvasNode` / `placeCanvasJobNode` write `pending` (a card for a job just started)
 *     or `done` (a card for media that already exists);
 *   - `resolveCanvasNode` writes what a browser reports: done / failed / cancelled / timeout /
 *     missing, and nothing else — the action rejects any other word;
 *   - the settlement writes `done` for a delivered output and `failed` / `cancelled` for a job's
 *     own ending;
 *   - `tombstoneCanvasNode` writes `deleted`.
 *
 * `unknown` is written by NO ONE. It exists because the create action accepted an unvalidated
 * status string for as long as it has existed, so a row could in principle hold a word from
 * outside this list; the migration parks any such row on `unknown` rather than letting the
 * constraint fail a deploy, and `unknown` is the honest name for "we cannot say what this was".
 */
export const CANVAS_CARD_ROW_STATUSES = [
  "pending",
  "done",
  "failed",
  "cancelled",
  "timeout",
  "missing",
  "deleted",
  "unknown",
] as const;

export type CanvasCardRowStatus = (typeof CANVAS_CARD_ROW_STATUSES)[number];

export function isCanvasCardRowStatus(status: string | null | undefined): status is CanvasCardRowStatus {
  return (CANVAS_CARD_ROW_STATUSES as readonly string[]).includes(status ?? "");
}

/**
 * HOW FAR ALONG A ROW IS — the forward-only rule, in one place (#602 T3 · spec #599 D4).
 *
 * A card only ever moves forward: it is being made, then it has stopped being made, then it is
 * gone. Nothing may pull it back. This matters because writes arrive out of order — a browser
 * that stopped watching minutes ago still sends its report, and applied as written it knocked a
 * settled card back to "still working" (the defect T2c closed with the late-write barrier).
 *
 * The ranks below are what that barrier IS, said as an ordering instead of as a list of allowed
 * states, so a new word cannot be added without being placed. `canvas-card-status.test.ts` checks
 * every writer's own predicate against this ordering, which is what keeps the rule true in the
 * database rather than only in this comment.
 */
const CANVAS_CARD_ROW_RANK: Readonly<Record<CanvasCardRowStatus, number>> = {
  /** Being made. Anything may replace it. */
  pending: 0,
  /** The browser stopped watching; the server may still overwrite it with what happened. */
  timeout: 1,
  /** Settled: this is what became of the work. */
  done: 2,
  failed: 2,
  cancelled: 2,
  missing: 2,
  unknown: 2,
  /** The merchant took it away. Absorbing — nothing comes after. */
  deleted: 3,
};

/**
 * May a writer move a card from `from` to `to` — i.e. is that a step FORWARD, never back?
 *
 * "Back" means towards being made: a card that has stopped may not start again, and a card the
 * merchant removed may not come back. Both directions have bitten this board — a stale browser
 * report knocking a settled card to "still working" (T2c), and a late read putting a deleted card
 * back on screen (T2c r4/r5).
 *
 * WITHIN the settled rank, movement is allowed, and only one writer uses it: the settlement,
 * which is the only writer that reads the JOB row and can therefore correct an unbound card to
 * the job's own ending. A browser may not do it, and does not: its report is separately confined
 * to `OVERWRITABLE_CARD_STATUSES`, which is the real barrier and is pinned by the test.
 *
 * Re-writing a card with the word it already carries is allowed: settlements are idempotent by
 * shape and must stay so.
 */
export function canvasCardRowAdvances(from: string, to: string): boolean {
  if (!isCanvasCardRowStatus(from) || !isCanvasCardRowStatus(to)) return false;
  return CANVAS_CARD_ROW_RANK[to] >= CANVAS_CARD_ROW_RANK[from];
}

/**
 * The states a browser's own report may still change — and the whole list, so anything else is
 * settled and belongs to the server.
 *
 * `timeout` is in BOTH this list and the resting faces on purpose, and that is the one subtlety
 * here. It is the browser saying "I stopped watching; it may still finish": to a merchant that is
 * an ending (the card stops pretending to be made), but to the database it is emphatically not
 * the last word — the job may still be running, and the settlement will overwrite it with what
 * actually happened. `pending` is the card while the job runs. Everything else — done, failed,
 * cancelled, missing, unknown, deleted — is a settled answer, and a report about an older state
 * of the world may not touch it.
 *
 * Exactly the rows of rank below "settled" above; the test pins that so the two cannot drift.
 */
export const OVERWRITABLE_CARD_STATUSES = ["pending", "timeout"] as const;

export function isOverwritableCardStatus(status: string | undefined): boolean {
  return (OVERWRITABLE_CARD_STATUSES as readonly string[]).includes(status ?? "");
}

/**
 * EVERY WORD A MERCHANT MAY READ OFF A CARD (#602 T3).
 *
 * Derived, never stored. Two of them have no row of their own:
 *   - `queued` / `generating` both come from the row word `pending`, split by the job's own
 *     status. The card knowing "a job exists" is not the same as knowing it started, and saying
 *     "making this now" about a job still in the queue is an assertion with nothing behind it.
 *   - `unknown` is the fallback, and it is the whole reason the derivation below is total.
 *     Whatever a reader cannot account for reads as unknown — NEVER as "generating", which is
 *     what an eternal spinner is made of: a card saying work is happening when nothing is.
 *
 * `deleted` is absent on purpose: a tombstone is not a face. Board reads drop those rows before
 * anything renders.
 */
export const CANVAS_CARD_FACES = [
  "queued",
  "generating",
  "done",
  "failed",
  "cancelled",
  "timeout",
  "missing",
  "unknown",
] as const;

export type CanvasCardFace = (typeof CANVAS_CARD_FACES)[number];

export function isCanvasCardFace(status: string | null | undefined): status is CanvasCardFace {
  return (CANVAS_CARD_FACES as readonly string[]).includes(status ?? "");
}

/** The two faces where work really is happening — the only ones allowed to animate. */
export const IN_FLIGHT_CARD_FACES = ["queued", "generating"] as const;

export function isInFlightCardFace(status: string | null | undefined): boolean {
  return (IN_FLIGHT_CARD_FACES as readonly string[]).includes(status ?? "");
}

/**
 * A card showing one of these has come to rest with nothing to show: it is not being made any
 * more, whatever it says, and the spinner must stop.
 *
 * `done` is absent because a done card shows its media, not a message.
 */
export const TERMINAL_CARD_STATUSES = ["failed", "cancelled", "timeout", "missing", "unknown"] as const;
export type TerminalCardStatus = (typeof TERMINAL_CARD_STATUSES)[number];

export function isTerminalCardStatus(status: string | undefined): status is TerminalCardStatus {
  return (TERMINAL_CARD_STATUSES as readonly string[]).includes(status ?? "");
}

/**
 * WHAT THIS CARD SAYS — the single derivation every reader uses (#602 T3 · spec #599 D4).
 *
 * Total by construction: every input lands on exactly one face, and the branch of last resort is
 * `unknown`. The order is the priority order, and each step is a fact that outranks the ones
 * below it:
 *
 *   1. media resolved ⇒ `done`. Nothing outranks the merchant's own picture being on screen.
 *   2. the card carries a paid output whose media would not load ⇒ `missing`. The work exists and
 *      this card cannot show it — true, and emphatically not "still being made".
 *   3. the job's own status, when this read can see the job row. The job is the authority on
 *      whether work is happening; a row that has not caught up must not out-talk it, which is how
 *      a board opened between a job ending and its settlement landing still reads truthfully.
 *   4. the row's own word, for a card with no job to ask — a picture placed by hand from the
 *      library, or an Otto placement.
 *   5. `unknown`.
 *
 * A `pending` row with no job to ask therefore falls to step 5, and that is deliberate: a card
 * claiming to be made by a job nobody can find is the eternal spinner (F21) in its purest form.
 * We genuinely cannot say what became of it, and unknown is a face that rests.
 */
export function canvasCardFace(input: {
  /** `CanvasNode.status`, exactly as stored. */
  rowStatus: string;
  /** `GenJob.status` of the job this card belongs to, when the reader could load it. */
  jobStatus?: string | null;
  /** The output this card is showing, after the display rule picked it. */
  generationId?: string | null;
  /** The resolved media URL for that output, when it resolved. */
  url?: string | null;
}): CanvasCardFace {
  if (input.url) return "done";
  if (input.generationId) return "missing";
  switch (input.jobStatus) {
    case "QUEUED": return "queued";
    case "GENERATING": return "generating";
    case "FAILED": return "failed";
    // A cancelled job is its own ending, not a failure (#612 · #599 D4).
    case "CANCELLED": return "cancelled";
    // Delivered, but this card carries no output of it.
    case "DONE": return "missing";
  }
  switch (input.rowStatus) {
    case "done": return "done";
    case "failed": return "failed";
    case "cancelled": return "cancelled";
    case "timeout": return "timeout";
    case "missing": return "missing";
  }
  return "unknown";
}
