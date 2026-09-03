/**
 * Journey 15 — FRONT-A4: the Home a merchant arranges is still theirs after a reload, and after
 * signing in again from a browser that has never seen this workspace.
 *
 * WHY THIS JOURNEY EXISTS. "The layout is saved" is exactly the kind of claim a page can fake:
 * keep the choice in React state, show a success toast, and every click inside that one tab looks
 * right. The only way to tell that apart from real persistence is to throw the tab away. So this
 * journey asserts twice — once after a reload, and once from a SECOND browser context, which
 * carries no cookies, no localStorage and no memory of the first one. A layout that survives that
 * came off the server (规格 docs/specs/frontend-baseline.md §7.3⑤;验收 FRONT-A4).
 *
 * WHAT IT DRIVES. The merchant hides the one Home component that has a real producer today
 * (Marketing health), so the honest result is the design's empty invitation rather than a page
 * that merely lost a card. Components without a real production data source are not rendered at
 * all (Founder 2026-09-03 裁决九), which is why the panel offers exactly one checkbox here — see
 * `apps/web/lib/home-layout.ts`.
 */
import { test, expect } from "@playwright/test";
import { seedWorkspace } from "../support/seed.js";
import { signIn } from "../support/auth.js";

test("FRONT-A4 — a customized Home survives a reload and a fresh browser", async ({ page, browser }) => {
  const merchant = await seedWorkspace({
    slug: "home-layout",
    workspaceName: "Layout Cafe",
    personName: "Nadia",
    openingGrant: 60,
  });

  await signIn(page, merchant, "/");

  // Before customizing: the one component with a real producer is on the page, in its honest
  // not-connected state (this workspace has no ad account).
  await expect(page.getByText("Connect marketing data to see your health")).toBeVisible();
  const customize = page.getByRole("button", { name: "Customize home" });
  await expect(customize).toBeVisible();

  await customize.click();
  const panel = page.getByRole("complementary", { name: "Customize home" });
  await expect(panel).toBeVisible();
  // The filters are locked while an unsaved draft is open — changing the goal would discard it.
  await expect(page.locator('[aria-label="Business goal"]')).toBeDisabled();

  await panel.getByRole("checkbox", { name: "Marketing health" }).click();
  await panel.getByRole("button", { name: "Save" }).click();

  // The empty state is the design's invitation, not a blank page.
  await expect(page.getByText("Choose what belongs on Home")).toBeVisible();
  await expect(page.getByText("Connect marketing data to see your health")).toHaveCount(0);

  // ① Reload — a page that kept the choice in memory loses it here.
  await page.reload();
  await expect(page.getByText("Choose what belongs on Home")).toBeVisible();
  await expect(page.getByText("Connect marketing data to see your health")).toHaveCount(0);

  // ② A browser that has never seen this workspace: no cookies, no browser storage of any kind.
  const fresh = await browser.newContext();
  try {
    const secondScreen = await fresh.newPage();
    await signIn(secondScreen, merchant, "/");
    await expect(secondScreen.getByText("Choose what belongs on Home")).toBeVisible();
    await expect(secondScreen.getByText("Connect marketing data to see your health")).toHaveCount(0);

    // And it is a preference, not a one-way door: putting the component back sticks too.
    await secondScreen.getByRole("button", { name: "Customize home" }).click();
    const secondPanel = secondScreen.getByRole("complementary", { name: "Customize home" });
    await secondPanel.getByRole("checkbox", { name: "Marketing health" }).click();
    await secondPanel.getByRole("button", { name: "Save" }).click();
    await expect(secondScreen.getByText("Connect marketing data to see your health")).toBeVisible();

    await page.reload();
    await expect(page.getByText("Connect marketing data to see your health")).toBeVisible();
  } finally {
    await fresh.close();
  }
});
