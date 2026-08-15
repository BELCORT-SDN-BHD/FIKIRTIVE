/**
 * Journey 8 — deleting your own work, and it staying deleted.
 *
 * The exit that matters most on a merchant's own data. The Library removes the tile optimistically,
 * so "it disappeared" proves nothing on its own — the journey reloads and looks again. That is the
 * exact shape of the defect this covers: a delete that only ever happened in the browser.
 */
import { test, expect } from "@playwright/test";
import { seedWorkspace, seedElement } from "../support/seed.js";
import { signIn } from "../support/auth.js";

test("An element deleted from the Library is gone, and is still gone after a reload", async ({ page }) => {
  const ws = await seedWorkspace({
    slug: "library",
    workspaceName: "Kaia Cafe",
    personName: "Kaia",
    openingGrant: 80,
  });
  await seedElement(ws, "Kopi tumbler");
  await seedElement(ws, "Pandan roll");

  await signIn(page, ws, "/otto?view=library");

  const doomed = page.getByRole("button", { name: "Open Kopi tumbler" });
  const survivor = page.getByRole("button", { name: "Open Pandan roll" });
  await expect(doomed).toBeVisible();
  await expect(survivor).toBeVisible();

  // The delete control lives on the tile's hover overlay — reach it the way a merchant does.
  const tile = page.locator("div.group", { has: doomed });
  await tile.hover();
  await tile.getByRole("button", { name: "Delete" }).click();

  // #934 — Delete now opens a confirmation instead of removing the tile straight away.
  await page.getByRole("button", { name: "Remove" }).click();

  await expect(doomed).toHaveCount(0);

  // The claim under test: it is gone from the workspace, not just from this render.
  await page.reload();
  await expect(page.getByRole("button", { name: "Open Kopi tumbler" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open Pandan roll" })).toBeVisible();
});
