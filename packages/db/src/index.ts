/**
 * Prisma 7 client wired through @prisma/adapter-pg (driver adapters are
 * mandatory in v7 — no Rust engine).
 *
 * URL discipline (eng review D7):
 *   - runtime  → DATABASE_URL_POOLED (Neon -pooler endpoint) falling back to DATABASE_URL
 *   - migrate  → DATABASE_URL (direct), used by prisma.config.ts / CLI only
 *
 * The client itself lives in ./client.ts (#795) and is re-exported below; this file is the
 * package's barrel.
 */
export * from "../generated/prisma/client.js";
export { reserveCredits, reserveCreditsUpTo, settleCredits, refundReservation, grantCredits, grantCreditsTx, InsufficientCredits, HOLD_SHORTFALL_REASON_PREFIX, type CreditGrantSource } from "./credits.js";
// #601: the server writes a finished job's canvas cards. Not a spend path — see the file header.
export {
  settleCanvasCardsForGenJob,
  findCanvasSettlementBacklog,
  noteCanvasRepairFailure,
  clearCanvasRepairRecord,
  canvasJobPlacementLockKey,
  canvasBoardPlacementLockKey,
  canvasRepairLockKey,
  canvasRepairWaitMs,
  CANVAS_REPAIR_JSON_KEY,
  CANVAS_REPAIR_WAIT_BASE_MS,
  CANVAS_REPAIR_WAIT_MAX_MS,
  CANVAS_SETTLEMENT_DEFAULT_LOCK_TIMEOUT_MS,
  CANVAS_SETTLEMENT_DEFAULT_STATEMENT_TIMEOUT_MS,
  type CanvasSettlementOutcome,
  type CanvasSettlementTimeoutOptions,
  type CanvasSettlementBacklogJob,
  type CanvasRepairRecord,
} from "./canvas-settlement.js";
export * from "./consent-fold.js";
export * from "./consent-runtime.js";
// #803: the sole upgrade path from a merchant-entered identity to a channel-verified one.
export * from "./contact-identity.js";
export * from "./send-eligibility.js";
// #795 — the cross-instance rate limiter is DELIBERATELY NOT re-exported here. It lives behind
// its own entry point (`@fikirtive/db/rate-limit`) so a gate imports counting and nothing else:
// this barrel pulls in the whole Prisma client surface, and dozens of test files replace it
// wholesale — a limiter reached through it would break in every one of them for a reason that has
// nothing to do with what those tests are about.

// THE client. Built in ./client.js so that ONE module — the rate-limit counter — can reach the
// database through a path this barrel's test doubles do not sit on (#795; the reason is written
// out in that file). Re-exported here unchanged: same object, same pool, same singleton, and every
// existing importer of `prisma` from "@fikirtive/db" is untouched.
export { prisma } from "./client.js";

export * from "./message-delivery-reconciliation.js";
export * from "./workflow-compiler.js";
export * from "./workflow-business-hours.js";
export * from "./workflow-engine.js";
export * from "./workflow-journey.js";
export * from "./workflow-reason-codes.js";
