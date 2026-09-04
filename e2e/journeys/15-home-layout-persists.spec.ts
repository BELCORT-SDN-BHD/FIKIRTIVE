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
 *
 * EVERY CONTENT ASSERTION IS SCOPED TO `<main>`, and that is load-bearing rather than tidy.
 * Home streams under its own `loading.tsx` boundary, and App Router leaves a SECOND, hidden copy
 * of the streamed markup in the document (`<div hidden id="S:…">` — the very duplication
 * `app/(home)/page.tsx` documents at the top of the file). A bare `getByText` matches hidden text
 * too, so it resolves to two elements and dies of strict mode; `getByRole("main")` skips hidden
 * subtrees, so scoping through it asks about the copy the merchant can actually read. Measured on
 * CI, 2026-09-03 — the first version of this journey failed exactly there.
 */
import { test, expect } from "@playwright/test";
import { seedWorkspace } from "../support/seed.js";
import { signIn } from "../support/auth.js";

/** The honest not-connected state of the one component that has a real producer. */
const HEALTH_BLOCK = "Connect marketing data to see your health";
/** What Home says when the merchant has turned everything off. */
const EMPTY_HOME = "Choose what belongs on Home";

test("FRONT-A4 — a customized Home survives a reload and a fresh browser", async ({ page, browser }) => {
  const merchant = await seedWorkspace({
    slug: "home-layout",
    workspaceName: "Layout Cafe",
    personName: "Nadia",
    openingGrant: 60,
  });

  await signIn(page, merchant, "/");
  const home = page.getByRole("main");

  // Before customizing: the one component with a real producer is on the page, in its honest
  // not-connected state (this workspace has no ad account).
  await expect(home.getByText(HEALTH_BLOCK)).toBeVisible();
  const customize = home.getByRole("button", { name: "Customize home" });
  await expect(customize).toBeVisible();

  await customize.click();
  const panel = page.getByRole("complementary", { name: "Customize home" });
  await expect(panel).toBeVisible();
  // The filters are locked while an unsaved draft is open — changing the goal would discard it.
  await expect(home.locator('[aria-label="Business goal"]')).toBeDisabled();

  await panel.getByRole("checkbox", { name: "Marketing health" }).click();
  await panel.getByRole("button", { name: "Save" }).click();
  // WAIT FOR THE SAVE, AND WAIT FOR IT ON THE RIGHT SIGNAL. While the panel is open the page
  // renders the DRAFT, not the saved layout (`MarketingHomeView`: `customizing ? draft :
  // components`) — so "the empty state is on screen" is already true the instant the checkbox is
  // cleared, before anything is sent anywhere. Asserting it here therefore measured nothing and,
  // worse, released the journey to reload while the save was still in flight: measured
  // 2026-09-04, the reload landed 39ms after the click and CANCELLED the server action
  // (trace: `POST /` carrying the saveHomeLayout action id, status -1 = aborted). The row did
  // commit a moment later — nothing was lost — but the reload had already read the database
  // ahead of it, so the page honestly showed the pre-save layout and the journey called that a
  // persistence bug.
  //
  // The panel is the honest signal. `saveDraft` awaits `saveHomeLayout` and only then sets
  // `customizing` to false, so the panel disappearing means the server action RETURNED OK — the
  // row is committed. No sleep, no arbitrary timeout: an unsaved layout leaves the panel open.
  await expect(panel).toHaveCount(0);

  // And only now is Home rendering the SERVER's answer (`components`), so the empty state below
  // is the design's invitation rather than an unsaved preview of it.
  await expect(home.getByText(EMPTY_HOME)).toBeVisible();
  await expect(home.getByText(HEALTH_BLOCK)).toHaveCount(0);

  // ① Reload — a page that kept the choice in memory loses it here.
  await page.reload();
  await expect(page.getByRole("main").getByText(EMPTY_HOME)).toBeVisible();
  await expect(page.getByRole("main").getByText(HEALTH_BLOCK)).toHaveCount(0);

  // ② A browser that has never seen this workspace: no cookies, no browser storage of any kind.
  const fresh = await browser.newContext();
  try {
    const secondScreen = await fresh.newPage();
    await signIn(secondScreen, merchant, "/");
    const secondHome = secondScreen.getByRole("main");
    await expect(secondHome.getByText(EMPTY_HOME)).toBeVisible();
    await expect(secondHome.getByText(HEALTH_BLOCK)).toHaveCount(0);

    // And it is a preference, not a one-way door: putting the component back sticks too.
    await secondHome.getByRole("button", { name: "Customize home" }).click();
    const secondPanel = secondScreen.getByRole("complementary", { name: "Customize home" });
    await secondPanel.getByRole("checkbox", { name: "Marketing health" }).click();
    await secondPanel.getByRole("button", { name: "Save" }).click();
    // Same signal, same reason as above — and this is the one CI tripped over: the draft already
    // shows the component again, so without this the reload below raced the second save too.
    await expect(secondPanel).toHaveCount(0);
    await expect(secondHome.getByText(HEALTH_BLOCK)).toBeVisible();

    await page.reload();
    await expect(page.getByRole("main").getByText(HEALTH_BLOCK)).toBeVisible();
  } finally {
    await fresh.close();
  }
});
