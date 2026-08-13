/**
 * variant-progress — what a styling-variant tile is allowed to believe about a paid generation
 * that is still running (#781 r2 P1).
 *
 * The bug these rules exist to prevent is a money-visibility one, not a cosmetic one. "Make it
 * again" charges for a fresh image, and the worker APPENDS it to the variant (attachOutputs, after
 * any existing ones) — it never replaces the old row. So a dialog that shows `refs[0]` shows the
 * image the merchant paid to replace, forever, no matter how many times they pay; and a dialog that
 * only watches variants with NO image never notices the new one arriving, so nothing on screen ever
 * changes and the obvious next move is to pay again.
 *
 * Two rules, both derived from server truth rather than remembered in component state, so a refresh
 * — or reopening the dialog tomorrow on a generation that stalled overnight — lands on exactly the
 * same picture:
 *   1. the tile shows the NEWEST image a variant has;
 *   2. a variant is "being made" when its newest generation job says so, whether the merchant
 *      started it a second ago, Otto started it in another tab, or it was already running when the
 *      page loaded — NOT when it happens to have no image.
 *
 * Structural parameter types (not VariantDTO): these are pure rules over "something with an id and
 * a list of images", which is what makes them testable without a React tree — apps/web's vitest
 * include list covers lib/, not components/.
 */

/** A variant's newest generation job as the dialog knows it. "NONE" is a real answer: the server
 *  has no job for this variant at all — nothing is running, and nothing failed. */
export type VariantJobStatus = "QUEUED" | "GENERATING" | "DONE" | "FAILED" | "NONE";
export type VariantJobView = { status: VariantJobStatus; error: string };
/** variant id → its newest job. A MISSING key means "not asked yet", which is not the same as NONE. */
export type VariantJobs = Record<string, VariantJobView>;

type VariantShape = { id: string; refs: unknown[] };

/** The image a variant's tile must show: the newest one it has.
 *
 *  Variant refs arrive position-ascending (data.ts orders them so) and the worker appends each
 *  generated image after the ones already there (refgen.ts nextRefPosition), so the LAST element is
 *  the most recent result — the one the merchant just paid for. `refs[0]` is the first image the
 *  variant ever produced, which after one re-run is exactly the picture they paid to move on from. */
export function latestVariantRef<T>(variant: { refs: T[] }): T | undefined {
  return variant.refs.length > 0 ? variant.refs[variant.refs.length - 1] : undefined;
}

/** Is a paid generation running for this variant right now?
 *
 *  The job answers when we have one. Before the server has been asked, an imageless variant is
 *  treated as running — that is what a just-created variant is — but an image is NOT taken as proof
 *  that nothing is running: a re-run keeps showing the old image while it works. */
export function isVariantRunning(variant: VariantShape, jobs: VariantJobs): boolean {
  const job = jobs[variant.id];
  if (!job) return variant.refs.length === 0;
  return job.status === "QUEUED" || job.status === "GENERATING";
}

/** The variants the dialog must keep asking the server about.
 *
 *  Everything it has not asked about yet (one sweep when the dialog opens — that is how a re-run
 *  started before a page refresh, or by Otto elsewhere, gets picked up), plus everything a previous
 *  answer said is still running. A variant whose newest job is DONE/FAILED/NONE drops out, so an
 *  idle dialog settles down to no polling at all. */
export function variantsToWatch(variants: ReadonlyArray<VariantShape>, jobs: VariantJobs): string[] {
  return variants.filter((v) => !jobs[v.id] || isVariantRunning(v, jobs)).map((v) => v.id);
}

/** Did a generation this dialog was WATCHING just finish? Only then is a re-read of server data
 *  worth asking for (it is what brings the new image in, and what refreshes the balance).
 *
 *  A DONE we are seeing for the first time is not a finish — it is history. Every variant of a
 *  well-used element reports DONE from its last run, and treating that as news would fire a refresh
 *  on every dialog open. The paid actions mark their variant as running the moment the action
 *  returns a job, so a real finish always has a running state before it. */
export function variantJustFinished(previous: VariantJobView | undefined, next: VariantJobView): boolean {
  if (next.status !== "DONE" || !previous) return false;
  return previous.status === "QUEUED" || previous.status === "GENERATING";
}
