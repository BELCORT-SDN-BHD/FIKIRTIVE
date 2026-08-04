/**
 * canvas-batch-layout — re-export of the shared board geometry.
 *
 * The geometry itself moved to `@fikirtive/core` (`canvas-layout.ts`) when the WORKER became
 * the writer that places a finished job's cards (#601). Three runtimes now lay cards out on the
 * same grid — the browser, the web server, and the worker — and only a package all three can
 * import keeps them from drifting back into hand-written copies of `(i % 2, i / 2)`.
 *
 * This file stays so the existing browser/server import sites keep one short path.
 *
 * It re-exports the `@fikirtive/core/canvas-layout` SUBPATH, never the package barrel. The barrel
 * pulls in Node-capable modules, and `client-core-imports.test.ts` fences it out of anything a
 * "use client" component can reach — this file is reached by FlowCanvas and useCanvasGen, so the
 * subpath is what keeps the browser bundle clean.
 */
export {
  CANVAS_CARD_GAP,
  CANVAS_BATCH_COLUMNS,
  CANVAS_SPAWN_ORIGIN,
  CANVAS_NEIGHBOUR_RINGS,
  canvasBatchSlotOffset,
  canvasBatchFootprint,
  canvasBatchRects,
  canvasRectsOverlap,
  nextCanvasSpawnOrigin,
  nearestFreeCanvasSlot,
  type CanvasRect,
  type CanvasSpawnOptions,
  type CanvasNeighbourOptions,
} from "@fikirtive/core/canvas-layout";
