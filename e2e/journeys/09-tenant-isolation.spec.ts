/**
 * Journey 9 — one merchant's money and work never appear on another merchant's screen.
 *
 * Two real workspaces exist at the same time, with numbers and names chosen so that a leak is
 * unmistakable rather than plausible. The assertion is made on the SIGNED-IN pages a merchant
 * actually reads — the wallet and the Library — because that is where a scoping mistake surfaces
 * as somebody else's data rather than as an error.
 */
import { test, expect } from "@playwright/test";
import { seedWorkspace, seedElement, seedSettledJob } from "../support/seed.js";
import { signIn } from "../support/auth.js";
import { spendHistory } from "../support/ui.js";

test("A second merchant sees only their own balance, history and Library", async ({ page }) => {
  const kaia = await seedWorkspace({
    slug: "iso-a",
    workspaceName: "Kaia Cafe",
    personName: "Kaia",
    openingGrant: 900,
  });
  await seedSettledJob(kaia, { held: 111, kind: "IMAGE" });
  await seedElement(kaia, "Kaia secret recipe board");

  const suri = await seedWorkspace({
    slug: "iso-b",
    workspaceName: "Second Shop",
    personName: "Suri",
    openingGrant: 40,
  });
  await seedElement(suri, "Suri tote bag");

  await signIn(page, suri, "/billing");

  await expect(page.getByText("40").first()).toBeVisible();
  await expect(page.getByText("789")).toHaveCount(0); // Kaia's balance after her charge
  await expect(page.getByText("-111")).toHaveCount(0); // Kaia's charge
  await expect(page.getByText("Your 1 credit entry so far. No charges yet.")).toBeVisible();

  await page.goto("/otto?view=library");
  await expect(page.getByRole("button", { name: "Open Suri tote bag" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Kaia secret recipe board" })).toHaveCount(0);
});
