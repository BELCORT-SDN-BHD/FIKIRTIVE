/**
 * The suite's own handle on the database.
 *
 * It imports the BUILT `@fikirtive/db` by path rather than by package name on purpose: `e2e/` is
 * not a pnpm workspace project (adding it to `pnpm-workspace.yaml` would put these files inside
 * `pnpm -r test` and `pnpm -r typecheck`, i.e. inside the `quality` legs, which this ticket must
 * not move). The path import gives the suite the same Prisma client, the same tenant guard and
 * the same money functions the product runs on, with no second copy of any of them.
 */
export { prisma, refundReservation } from "../../packages/db/dist/src/index.js";
export { runAsTenant } from "../../packages/db/dist/src/principal.js";
export { INTERNAL_PER_DISPLAY } from "../../packages/core/dist/spend.js";
