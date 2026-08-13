/**
 * Journey 11 — signing out really ends the session.
 *
 * The last exit. A "Sign out" that clears the menu but leaves the cookie working is indistinguishable
 * from a working one on the screen where you press it, and matters most on a shared shop computer.
 */
import { test, expect } from "@playwright/test";
import { seedWorkspace } from "../support/seed.js";
import { signIn } from "../support/auth.js";
import { globalNav } from "../support/ui.js";

test("after signing out, the money surface is walled again", async ({ page }) => {
  const ws = await seedWorkspace({
    slug: "signout",
    workspaceName: "Kaia Cafe",
    personName: "Kaia",
    openingGrant: 55,
  });

  await signIn(page, ws, "/billing");
  await expect(page.getByText("55").first()).toBeVisible();

  // The identity area is a disclosure (`<details>`); its summary is what a merchant clicks.
  const nav = globalNav(page);
  await nav.locator("summary").filter({ hasText: ws.email }).click();
  await nav.getByRole("menuitem", { name: "Sign out" }).click();

  await expect(page).toHaveURL(/\/login/);

  // Not just this tab's view of it: the cookie is dead.
  await page.goto("/billing");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText("Your balance")).toHaveCount(0);
});
