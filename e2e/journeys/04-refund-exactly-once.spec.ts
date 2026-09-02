/**
 * Journey 4 — a failed generation costs nothing, once.
 *
 * Two claims, and the second is the one that needs a browser to be worth anything:
 *
 *   1. the merchant sees the hold come back in full, in their own words;
 *   2. a SECOND refund of the same reservation cannot pay them again.
 *
 * Claim 2 is asserted by calling the product's own `refundReservation` a second time — the exact
 * function the worker's failure path calls — and then reading the merchant's screen. A unit test
 * can prove the function returns "already-refunded"; only this can prove the balance a merchant
 * actually looks at did not move.
 */
import { test, expect } from "@playwright/test";
import { seedWorkspace, seedRefundedJob, readAccount, countLedgerRows } from "../support/seed.js";
import { signIn } from "../support/auth.js";
import { prisma, refundReservation, INTERNAL_PER_DISPLAY } from "../support/db.js";

test("A failed video gives the whole hold back, and a repeated refund cannot pay twice", async ({ page }) => {
  const ws = await seedWorkspace({
    slug: "refund",
    workspaceName: "Kaia Cafe",
    personName: "Kaia",
    openingGrant: 200,
  });
  const { refId } = await seedRefundedJob(ws, { held: 22, kind: "VIDEO" });

  await signIn(page, ws, "/billing");

  // Whole again: nothing spendable was lost and nothing is still held.
  await expect(page.getByText("200").first()).toBeVisible();
  // Positive first, so the negative below cannot become a permanently-green assertion the day
  // the hold badge is reworded again (see journey 3).
  await expect(page.getByText("Nothing on hold")).toBeVisible();
  await expect(page.getByText("credits held")).toHaveCount(0);
  await expect(page.getByText("Held, then refunded in full")).toBeVisible();

  // Now ask the ledger to refund the same reservation again — a resume, a duplicate finalizer, a
  // retried worker. The money authority must recognise it and move nothing.
  const outcome = await prisma.$transaction((tx) =>
    refundReservation(tx as never, { orgId: ws.orgId, refId }),
  );
  expect(outcome).toBe("already-refunded");
  expect(await countLedgerRows(ws, refId)).toBe(2); // the RESERVE and the ONE refund

  const account = await readAccount(ws);
  expect(account.balance).toBe(200 * INTERNAL_PER_DISPLAY);
  expect(account.reserved).toBe(0);

  // And the merchant's own screen still says the same thing after the second attempt.
  await page.reload();
  await expect(page.getByText("200").first()).toBeVisible();
  await expect(page.getByText("Held, then refunded in full")).toHaveCount(1);
});
