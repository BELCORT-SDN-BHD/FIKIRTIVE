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
import { signIn, clearAuthRateLimitCounters, requestSignInCode } from "../support/auth.js";

test("A stranger is walled out of every money surface, and told where to sign in", async ({ page }) => {
  for (const surface of ["/otto", "/billing", "/crm/broadcasts"]) {
    await page.goto(surface);
    await expect(page).toHaveURL(/\/login/);
    // The destination survives the round trip, so signing in does not lose the click.
    expect(new URL(page.url()).searchParams.get("from")).toBe(surface);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  }
});

test("A merchant signs in with the emailed code and lands where they were headed", async ({ page }) => {
  const ws = await seedWorkspace({
    slug: "door",
    workspaceName: "Kaia Cafe",
    personName: "Kaia",
    openingGrant: 120,
  });

  // The two steps, walked with the merchant's own eyes on them: asking for the code puts the
  // page into the code step and says which address it went to, and the code they were mailed
  // finishes the sign-in without ever leaving the tab they started in.
  const code = await requestSignInCode(page, ws.email, "/billing");
  await expect(page.getByText("Check your email")).toBeVisible();
  await expect(page.getByText(ws.email)).toBeVisible();

  await page.getByLabel("Login code").fill(code);
  await page.getByRole("button", { name: "Continue with login code" }).click();

  await expect(page).toHaveURL(/\/billing/);
  await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
  await expect(page.getByText("Available balance")).toBeVisible();
});

test("A code that was never minted signs nobody in, and says so on the page", async ({ page }) => {
  // Six digits nobody was ever sent is the shape a guess takes. The product must refuse it — and
  // the refusal must be visible, not a silent bounce that reads like a lost click.
  const ws = await seedWorkspace({
    slug: "forged",
    workspaceName: "Forged Cafe",
    personName: "Nobody",
    openingGrant: 0,
  });
  const real = await requestSignInCode(page, ws.email, "/billing");
  const wrong = real === "000000" ? "111111" : "000000";

  await page.getByLabel("Login code").fill(wrong);
  await page.getByRole("button", { name: "Continue with login code" }).click();

  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
  // And no session was created on the way past.
  await page.goto("/billing");
  await expect(page).toHaveURL(/\/login/);
});

test("The magic-link door is gone — the URL that used to sign people in answers nothing", async ({ page }) => {
  // The link flow was REPLACED, not merely hidden: a bookmarked or replayed verify URL must not
  // still be a way in. (The server-side proof is in apps/web — this is the browser's own.)
  await clearAuthRateLimitCounters();
  const res = await page.goto("/api/better-auth/magic-link/verify?token=not-a-real-token");
  expect(res?.status()).toBe(404);
});
