/**
 * Journey 5 — an empty top-up shelf is never a full stop.
 *
 * This suite has no payment credential by design, so nothing is on sale here. That is the state
 * #687 is about: a merchant on this page has ALREADY decided to pay, so "there is nothing here"
 * cannot be the last thing the product says to them — the sentence has to come with a way to
 * reach a person.
 *
 * It is also the browser-level proof that opening Billing contacts no payment provider. With no
 * key present, a page that had reached for one would be an error, not this sentence — and the
 * balance beside it would have gone down with it.
 */
import { test, expect } from "@playwright/test";
import { seedWorkspace } from "../support/seed.js";
import { signIn } from "../support/auth.js";

test("an empty shelf says so and still offers a way through", async ({ page }) => {
  const ws = await seedWorkspace({
    slug: "shelf",
    workspaceName: "Kaia Cafe",
    personName: "Kaia",
    openingGrant: 60,
  });

  await signIn(page, ws, "/billing");

  await expect(page.getByRole("heading", { name: "Top up" })).toBeVisible();
  await expect(page.getByText("No credit packs are available right now.")).toBeVisible();
  const exit = page.getByRole("link", { name: "Email support" });
  await expect(exit).toBeVisible();
  await expect(exit).toHaveAttribute("href", /^mailto:.*subject=I%20want%20to%20buy%20credits$/);

  // The balance is still readable — one empty read must not take the rest of the page with it.
  await expect(page.getByText("Your balance")).toBeVisible();
  await expect(page.getByText("60").first()).toBeVisible();
  await expect(page.getByText("Could not load balance. Please refresh.")).toHaveCount(0);
});
