/**
 * The canvas card state algebra — re-exported from `@fikirtive/core` (#602 T3, moved in r2).
 *
 * The definitions moved to `packages/core/src/canvas-card-status.ts` so `@fikirtive/otto` can read
 * the same vocabulary instead of keeping its own copy (a package cannot import from an app, and
 * the copy had already drifted). This file stays as the web app's import site so every existing
 * `@/lib/canvas-card-status` import keeps working and there is still one obvious place to look.
 */
export {
  CANVAS_CARD_ROW_STATUSES,
  CANVAS_CARD_FACES,
  IN_FLIGHT_CARD_FACES,
  OVERWRITABLE_CARD_STATUSES,
  TERMINAL_CARD_STATUSES,
  canvasCardFace,
  canvasCardIsInFlightPaid,
  canvasCardRowAdvances,
  isCanvasCardFace,
  isCanvasCardRowStatus,
  isInFlightCardFace,
  isOverwritableCardStatus,
  isTerminalCardStatus,
  type CanvasCardFace,
  type CanvasCardRowStatus,
  type TerminalCardStatus,
}
  // The BROWSER-SAFE subpath, never the main barrel: card components are client modules, and
  // `client-core-imports.test.ts` keeps the Node-capable barrel out of anything a client file can
  // reach. Same pattern as `@fikirtive/core/spend`, `/org-roles`, `/upload`.
  from "@fikirtive/core/canvas-card-status";
