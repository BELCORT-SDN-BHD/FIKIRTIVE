/**
 * Journey 2 — what the wallet says while work is in flight.
 *
 * A hold is the moment merchants most often think the product has stolen from them: the balance
 * drops before anything has been delivered. So two things have to be on screen at once — the
 * smaller spendable number, AND the sentence that says the difference is being held, not spent.
 */
import { test, expect } from "@playwright/test";
import { seedWorkspace, seedOpenHold, readAccount } from "../support/seed.js";
import { signIn } from "../support/auth.js";
import { spendHistory, globalNav } from "../support/ui.js";
import { INTERNAL_PER_DISPLAY } from "../support/db.js";

test("An open hold leaves the balance smaller and says so, instead of just going missing", async ({ page }) => {
  const ws = await seedWorkspace({
    slug: "hold",
    workspaceName: "Kaia Cafe",
    personName: "Kaia",
    openingGrant: 200,
  });
  await seedOpenHold(ws, { credits: 22, kind: "VIDEO" });

  // The wallet itself, before any page renders it: 200 − 22 spendable, 22 held.
  const account = await readAccount(ws);
  expect(account.balance).toBe(178 * INTERNAL_PER_DISPLAY);
  expect(account.reserved).toBe(22 * INTERNAL_PER_DISPLAY);

  await signIn(page, ws, "/billing");

  await expect(page.getByText("178").first()).toBeVisible();
  await expect(page.getByText("22 held for work in progress")).toBeVisible();

  // The same in-flight job, in the history, labelled as a hold rather than as a final charge.
  const history = spendHistory(page);
  await expect(history.getByText("Video")).toBeVisible();
  await expect(
    history.getByText("On hold — the final cost is charged when this finishes"),
  ).toBeVisible();
});

test("The balance in the navigation rail is the same number Billing shows", async ({ page }) => {
  // Two surfaces, one wallet. A rail that lags behind Billing is how a merchant comes to believe
  // the product cannot count.
  const ws = await seedWorkspace({
    slug: "rail",
    workspaceName: "Second Shop",
    personName: "Suri",
    openingGrant: 137,
  });
  await seedOpenHold(ws, { credits: 12, kind: "IMAGE" });

  await signIn(page, ws, "/billing");

  await expect(globalNav(page).getByText("125 credits")).toBeVisible();
  await expect(page.getByText("12 held for work in progress")).toBeVisible();
});
