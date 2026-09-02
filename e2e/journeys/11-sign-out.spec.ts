/**
 * Journey 11 — signing out really ends the session.
 *
 * The last exit. A "Sign out" that clears the menu but leaves the cookie working is indistinguishable
 * from a working one on the screen where you press it, and matters most on a shared shop computer.
 */
import { test, expect } from "@playwright/test";
import { seedWorkspace } from "../support/seed.js";
import { signIn } from "../support/auth.js";

test("After signing out, the money surface is walled again", async ({ page }) => {
  const ws = await seedWorkspace({
    slug: "signout",
    workspaceName: "Kaia Cafe",
    personName: "Kaia",
    openingGrant: 55,
  });

  await signIn(page, ws, "/billing");
  await expect(page.getByText("55").first()).toBeVisible();

  // The identity area is the rail's account button (W2-11 replaced the hand-rolled `<details>`
  // disclosure with the shadcn dropdown — same two entries behind it, Profile and Sign out).
  //
  // #592 is still asserted, and still on the merchant's own eyes: the button SHOWS the display
  // name (seeded here as personName), falling back to email only when no display name is set.
  // Its accessible name is the fixed "Account menu" label, so the name check is a separate
  // assertion rather than a locator filter — dropping it would have quietly retired #592.
  const identity = page.getByRole("banner").getByRole("button", { name: "Account menu" });
  // The trigger is an avatar initial now, so the merchant's own name is on its tooltip and inside
  // the menu it opens — assert BOTH, because an initial alone is not "this product knows who you
  // are" and dropping the check would have quietly retired #592.
  await expect(identity).toHaveAttribute("title", ws.personName);
  await identity.click();
  await expect(page.getByText(ws.personName, { exact: true })).toBeVisible();
  // The menu is portalled to the end of <body>, so it is NOT inside the navigation element.
  await page.getByRole("menuitem", { name: "Sign out" }).click();

  await expect(page).toHaveURL(/\/login/);

  // Not just this tab's view of it: the cookie is dead.
  await page.goto("/billing");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText("Available balance")).toHaveCount(0);
});
