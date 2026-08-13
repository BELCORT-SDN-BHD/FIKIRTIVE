/**
 * Journey 1 — the door.
 *
 * Nobody reaches a money surface without a session, and the merchant who has one lands back where
 * they were headed. Both halves matter: a wall that lets a stranger through is the worst defect
 * this product can have, and a wall that loses the destination sends a merchant who clicked
 * "Billing" to a home page instead.
 */
import { test, expect } from "@playwright/test";
import { seedWorkspace } from "../support/seed.js";
import { signIn, clearAuthRateLimitCounters } from "../support/auth.js";

test("a stranger is walled out of every money surface, and told where to sign in", async ({ page }) => {
  for (const surface of ["/otto", "/billing", "/crm/broadcasts"]) {
    await page.goto(surface);
    await expect(page).toHaveURL(/\/login/);
    // The destination survives the round trip, so signing in does not lose the click.
    expect(new URL(page.url()).searchParams.get("from")).toBe(surface);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  }
});

test("a merchant signs in through the emailed link and lands where the link pointed", async ({ page }) => {
  const ws = await seedWorkspace({
    slug: "door",
    workspaceName: "Kaia Cafe",
    personName: "Kaia",
    openingGrant: 120,
  });

  await signIn(page, ws, "/billing");

  await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
  await expect(page.getByText("Your balance")).toBeVisible();
});

test("an unknown address cannot sign in with a link that was never minted for it", async ({ page }) => {
  // A token that does not exist is the shape a forged or replayed link takes. The product must
  // refuse it — and the refusal must be visible, not a silent bounce that reads like a lost click.
  await clearAuthRateLimitCounters();
  await page.goto("/api/better-auth/magic-link/verify?token=not-a-real-token&callbackURL=%2Fbilling");
  await expect(page).toHaveURL(/\/login/);
  expect(page.url()).toContain("error%3DINVALID_TOKEN");
  // And no session was created on the way past.
  await page.goto("/billing");
  await expect(page).toHaveURL(/\/login/);
});
