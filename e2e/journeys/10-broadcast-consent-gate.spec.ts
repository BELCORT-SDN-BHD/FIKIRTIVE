/**
 * Journey 10 — the gate in front of sending anything to a real customer.
 *
 * Two promises have to be visible on the Broadcasts surface at the same time, and they are the two
 * that keep this product out of trouble:
 *
 *   - nothing here reaches a real customer — every send in this workbench is simulated;
 *   - a workspace with no connected messaging channel cannot START a broadcast, and is told why
 *     rather than handed a composer that ends in a refusal.
 *
 * A door that opens onto a dead end is the version of this defect that costs a merchant an hour;
 * a surface that quietly sends is the version that costs the company a channel.
 */
import { test, expect } from "@playwright/test";
import { seedWorkspace } from "../support/seed.js";
import { signIn } from "../support/auth.js";

// W2-13 (#993) — SKIPPED, not deleted. The whole CRM section is hidden from the merchant until
// Meta verification passes (Founder ruling 2026-08-18; restore trigger recorded on issue #359):
// `/crm/broadcasts` is a bare `redirect("/")` now, so this journey can no longer reach the surface
// it describes. The engine, the components and the two promises below are all still in the repo —
// un-skip this file on the same day the section comes back, and it should pass as written.
test.skip("With no channel connected, a broadcast cannot be started and the reason is on screen", async ({ page }) => {
  const ws = await seedWorkspace({
    slug: "broadcast",
    workspaceName: "Kaia Cafe",
    personName: "Kaia",
    openingGrant: 100,
  });

  await signIn(page, ws, "/crm/broadcasts");

  await expect(page.getByRole("heading", { name: "Broadcasts", level: 1 })).toBeVisible();
  await expect(
    page.getByText(
      "Fikirtive never sends to real customers here — every send in this workbench is simulated.",
    ),
  ).toBeVisible();
  await expect(page.getByText("No messaging channel is connected in this workspace yet.")).toBeVisible();

  const start = page.getByRole("button", { name: "New broadcast" });
  await expect(start).toBeVisible();
  await expect(start).toBeDisabled();
  await expect(start).toHaveAttribute(
    "title",
    /A broadcast goes out through a connected channel account\./,
  );
});
