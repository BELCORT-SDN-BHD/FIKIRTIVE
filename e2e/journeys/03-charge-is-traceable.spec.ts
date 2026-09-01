/**
 * Journey 3 — a finished job reads as one charge, at the amount really taken.
 *
 * The ledger records a reserve and a settle. The merchant must never be shown those mechanics as
 * two events, and must never be shown a finished job as an unsettled hold — that is the exact
 * shape that makes a working charge look like money stuck somewhere.
 */
import { test, expect } from "@playwright/test";
import { seedWorkspace, seedSettledJob, readAccount } from "../support/seed.js";
import { signIn } from "../support/auth.js";
import { spendHistory } from "../support/ui.js";
import { INTERNAL_PER_DISPLAY } from "../support/db.js";

test("A delivered image is one charge for exactly what it cost", async ({ page }) => {
  const ws = await seedWorkspace({
    slug: "charge",
    workspaceName: "Kaia Cafe",
    personName: "Kaia",
    openingGrant: 200,
  });
  await seedSettledJob(ws, { held: 11, kind: "IMAGE" });

  const account = await readAccount(ws);
  expect(account.balance).toBe(189 * INTERNAL_PER_DISPLAY);
  expect(account.reserved).toBe(0);

  await signIn(page, ws, "/billing");

  await expect(page.getByText("189").first()).toBeVisible();
  // Nothing is held any more, so the hold line must be gone entirely.
  await expect(page.getByText("held for work in progress")).toHaveCount(0);
  await expect(page.getByText("On hold — the final cost is charged when this finishes")).toHaveCount(0);

  // exact: billing 页自 A9 起有「Auto-understanding」价目散文(含小写 "image"),
  // Playwright 字符串匹配大小写不敏感,非 exact 会撞出两个元素;这里钉的是消费历史的类目标签。
  await expect(page.getByText("Image", { exact: true })).toBeVisible();
  await expect(page.getByText("-11", { exact: true })).toBeVisible();
});

test("A hold bigger than the work returns the difference, and says how much", async ({ page }) => {
  // The conversation-turn shape: hold up front, charge what was used, give the rest back in the
  // same transaction. Merchants used to see the balance dip and partly come back with nothing
  // explaining either move.
  const ws = await seedWorkspace({
    slug: "partial",
    workspaceName: "Second Shop",
    personName: "Suri",
    openingGrant: 200,
  });
  await seedSettledJob(ws, { held: 40, used: 12, kind: "IMAGE" });

  const account = await readAccount(ws);
  expect(account.balance).toBe(188 * INTERNAL_PER_DISPLAY);

  await signIn(page, ws, "/billing");

  await expect(page.getByText("188").first()).toBeVisible();
  await expect(page.getByText("12 credits used · 28 refunded")).toBeVisible();
});
