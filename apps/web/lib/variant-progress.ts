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
 * Three rules, all derived from server truth rather than remembered in component state, so a
 * refresh — or reopening the dialog tomorrow on a generation that stalled overnight — lands on
 * exactly the same picture:
 *   1. the tile shows the NEWEST image a variant has;
 *   2. a variant is "being made" when its newest generation job says so, whether the merchant
 *      started it a second ago, Otto started it in another tab, or it was already running when the
 *      page loaded — NOT when it happens to have no image;
 *   3. server data is re-read whenever a finished job's image is not among the ones on screen —
 *      NOT when the dialog happens to have watched that job go from running to done (#781 r3).
 *      Rule 3 is what closes the last stale window: the page snapshot is always older than the
 *      poll, so a job that finishes in between reports DONE on the very first tick, with nothing
 *      before it to compare against.
 *
 * Structural parameter types (not VariantDTO): these are pure rules over "something with an id and
 * a list of images", which is what makes them testable without a React tree — apps/web's vitest
 * include list covers lib/, not components/.
 */

/** A variant's newest generation job as the dialog knows it. "NONE" is a real answer: the server
 *  has no job for this variant at all — nothing is running, and nothing failed. */
export type VariantJobStatus = "QUEUED" | "GENERATING" | "DONE" | "FAILED" | "NONE";
export type VariantJobView = {
  status: VariantJobStatus;
  error: string;
  /** The assets a finished job attached to the variant, as the server reported them. ABSENT means
   *  "we were never told", which is deliberately not the same as "it produced nothing": only a
   *  known, non-empty list can prove the paid image is already on the merchant's screen. */
  outputAssetIds?: string[];
};
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

/** Is the image a finished job produced already among the images the tile is showing?
 *
 *  This is the only honest way to answer "is the merchant looking at what they paid for". The
 *  variant rows the dialog renders come from a PAGE SNAPSHOT taken at some earlier moment; the job
 *  status comes from a poll taken now, and the status alone never says whether the two are in sync.
 *  The assets do: the worker attaches its outputs and only THEN writes DONE (apps/worker refgen.ts
 *  — attachOutputs, then finalizeDone), so a DONE job's images are already committed. If they are
 *  not in the snapshot, the snapshot is behind and a re-read is what puts the paid image on screen.
 *
 *  An unknown or empty output list counts as "cannot prove it", so the caller re-reads: a wasted
 *  re-read costs one round trip, a missed one costs the merchant the image they paid for. */
export function variantShowsJobResult(
  variant: { refs: ReadonlyArray<{ assetId: string }> },
  job: VariantJobView,
): boolean {
  const produced = job.outputAssetIds;
  if (!produced || produced.length === 0) return false;
  const onTile = new Set(variant.refs.map((r) => r.assetId));
  return produced.every((assetId) => onTile.has(assetId));
}

/** Must the dialog re-read server data because of what this poll just heard?
 *
 *  Yes exactly when the newest job is finished and its result is NOT on the tile — one rule, from
 *  data, covering both a finish the dialog watched happen and the one it cannot watch: the page
 *  took its snapshot, the worker finished, and the very first poll already says DONE.
 *
 *  The rule this replaced ("a DONE is only news if we saw a running state before it") called that
 *  second case history, and it is exactly the case a merchant hits by paying for "Make it again"
 *  and then reloading, or by letting Otto re-run a look in another tab: the newest job answers DONE
 *  on the opening sweep, the variant then drops out of the watch set, and the tile keeps showing
 *  the picture they paid to replace until a full page reload. Reading it from the assets ALSO keeps
 *  what that rule was protecting — a well-used element whose DONE images are all present asks for
 *  no re-read at all, so opening the dialog is still free.
 *
 *  Bounded by construction: a DONE variant leaves the watch set (variantsToWatch), so this can ask
 *  for at most one re-read per variant per dialog open — and one is enough, because DONE means the
 *  images are already committed and any later read must see them. */
export function variantNeedsReread(
  variant: { refs: ReadonlyArray<{ assetId: string }> },
  job: VariantJobView,
): boolean {
  if (job.status !== "DONE") return false;
  return !variantShowsJobResult(variant, job);
}
