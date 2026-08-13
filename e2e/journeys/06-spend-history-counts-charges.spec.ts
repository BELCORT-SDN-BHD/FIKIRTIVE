/**
 * Journey 6 — the sentence above the history has to be true.
 *
 * The list says how many entries it covers and how many of them are charges. Both numbers have
 * been wrong before: every row used to be called a charge, so a workspace holding nothing but its
 * welcome grant was told it had "1 credit charge so far". The words and the rows are rendered by
 * different code, which is exactly why they need a journey rather than a unit test.
 */
import { test, expect } from "@playwright/test";
import { seedWorkspace, seedSettledJob, seedRefundedJob, seedOpenHold } from "../support/seed.js";
import { signIn } from "../support/auth.js";
import { spendHistory } from "../support/ui.js";

test("A workspace with nothing but its welcome grant is not told it has been charged", async ({ page }) => {
  const ws = await seedWorkspace({
    slug: "fresh",
    workspaceName: "Kaia Cafe",
    personName: "Kaia",
    openingGrant: 30,
  });

  await signIn(page, ws, "/billing");

  await expect(page.getByText("Your 1 credit entry so far. No charges yet.")).toBeVisible();
  await expect(page.getByText("Credits added")).toBeVisible();
  await expect(page.getByText("+30", { exact: true })).toBeVisible();
});

test("Only the entries that really took credits are counted as charges", async ({ page }) => {
  // Four entries: the grant (added), a delivered image (charge), a failed video refunded in full
  // (nothing moved), and a job still running (a hold, not a charge yet). Exactly one is a charge.
  const ws = await seedWorkspace({
    slug: "mixed",
    workspaceName: "Second Shop",
    personName: "Suri",
    openingGrant: 300,
  });
  await seedSettledJob(ws, { held: 11, kind: "IMAGE" });
  await seedRefundedJob(ws, { held: 22, kind: "VIDEO" });
  await seedOpenHold(ws, { credits: 22, kind: "VIDEO" });

  await signIn(page, ws, "/billing");

  await expect(
    page.getByText("All 4 credit entries on this workspace, newest first. 1 of them is a charge."),
  ).toBeVisible();
});
