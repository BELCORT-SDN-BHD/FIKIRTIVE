/**
 * Journey 7 — the two places a merchant reads their wallet say the same thing.
 *
 * The balance appears on /billing and inside Otto's own "Billing and credits" settings. They are
 * different components reading through different actions; when they drift, the merchant cannot
 * tell which one is lying, and every later conversation about money starts from distrust.
 */
import { test, expect } from "@playwright/test";
import { seedWorkspace, seedOpenHold, seedSettledJob } from "../support/seed.js";
import { signIn } from "../support/auth.js";

test("Billing and Otto's settings report the same balance and the same hold", async ({ page }) => {
  const ws = await seedWorkspace({
    slug: "parity",
    workspaceName: "Kaia Cafe",
    personName: "Kaia",
    openingGrant: 300,
  });
  await seedSettledJob(ws, { held: 11, kind: "IMAGE" });
  await seedOpenHold(ws, { credits: 22, kind: "VIDEO" });
  // 300 − 11 charged − 22 held = 267 spendable, 22 on hold.

  await signIn(page, ws, "/billing");
  await expect(page.getByText("267").first()).toBeVisible();
  await expect(page.getByText("22 held for work in progress")).toBeVisible();

  await page.goto("/otto?view=account");
  await expect(page.getByText("Credit balance")).toBeVisible();
  await expect(page.getByText("267 credits").first()).toBeVisible();
  await expect(page.getByText("22 credits on hold")).toBeVisible();
});
