/**
 * A GENERATION JOB'S OWN ENDING — the two words that mean "this job stopped and delivered
 * nothing" (#602 · spec #599 D4).
 *
 * `GenStatus` (packages/db/prisma/schema.prisma) has five values: QUEUED, GENERATING, DONE,
 * FAILED, CANCELLED. Two of them are the job still running, one is delivered work, and these two
 * are the endings where nothing arrived and the credit hold went back.
 *
 * They are named together because every rule that used to say "failed" really meant "ended without
 * delivering", and while cancelling wrote the word FAILED nobody could tell the difference. The
 * moment cancel became its own word, each of those rules had to be asked again — and the one that
 * mattered most is the batch dedup guard in `gen-actions`, which frees a logical cell for a new
 * attempt only once every prior job for it has ended. Spelled as `!== "FAILED"`, a cancelled job
 * read as still live, so the merchant's next press was handed back the dead job and nothing was
 * ever made.
 *
 * Deliberately NOT the canvas card vocabulary: what a CARD says lives in
 * `apps/web/lib/canvas-card-status.ts`, and the projection between them is
 * `canvasTerminalCardStatus`. `canvas-settlement-plan.test.ts` pins the two together, and
 * `packages/db/src/__tests__/canvas-settlement-backlog.test.ts` pins this vocabulary against the
 * generated enum, so a sixth status cannot be added to the schema without meeting this decision.
 */
export const GEN_JOB_ENDED_STATUSES = ["FAILED", "CANCELLED"] as const;

export type GenJobEndedStatus = (typeof GEN_JOB_ENDED_STATUSES)[number];

/** Did this job stop without delivering — refunded, with nothing to show and nothing still to do? */
export function genJobEndedWithoutDelivering(status: string | null | undefined): status is GenJobEndedStatus {
  return (GEN_JOB_ENDED_STATUSES as readonly string[]).includes(status ?? "");
}
