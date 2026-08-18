/**
 * Journey 12 — the first thing a merchant does after signing in.
 *
 * Creating a project is the cheapest possible write in the product, and it is the one every other
 * journey depends on: it proves a signed-in browser can reach a server action, that the action
 * writes under this workspace, and that the new project is the one the app then opens. It costs
 * nothing — no reservation, no ledger row — and this journey asserts that too, because a free
 * action that quietly touched the wallet would be the worst kind of money defect.
 */
import { test, expect } from "@playwright/test";
import { seedWorkspace, readAccount } from "../support/seed.js";
import { signIn } from "../support/auth.js";
import { prisma, INTERNAL_PER_DISPLAY } from "../support/db.js";

test("A merchant creates a project, lands in it, and is charged nothing for it", async ({ page }) => {
  const ws = await seedWorkspace({
    slug: "project",
    workspaceName: "Kaia Cafe",
    personName: "Kaia",
    openingGrant: 75,
  });

  await signIn(page, ws, "/otto");

  // The projects rail starts collapsed at this viewport; "New project" lives inside it.
  //
  // WAITED FOR, not sampled. `isVisible()` is a single instantaneous read: it answers "is this on
  // screen right now", and right now is a moment while the workbench is still mounting. It
  // happened to be true when signing in was a server redirect that landed on a fully painted
  // document; with the sign-in code the page navigates itself, so the read could fall before the
  // rail existed — the toggle was then skipped and the journey blamed "New project" for being
  // missing. The rail is genuinely collapsed at this viewport, so waiting for the toggle is the
  // honest form of the same check.
  const showSidebar = page.getByRole("button", { name: "Show sidebar" });
  await showSidebar.waitFor({ state: "visible" });
  await showSidebar.click();

  await page.getByRole("button", { name: "New project" }).click();

  // The app opens the project it just made: a different id in the URL than the seeded one.
  await expect(page).toHaveURL(/[?&]project=/);
  const opened = new URL(page.url()).searchParams.get("project");
  expect(opened).not.toBe(ws.projectId);

  const projects = await prisma.project.findMany({
    where: { ownerId: ws.orgId },
    select: { id: true },
  });
  expect(projects.map((p) => p.id)).toContain(opened);
  expect(projects).toHaveLength(2);

  // Free is free: the wallet is untouched and the ledger grew no row.
  const account = await readAccount(ws);
  expect(account.balance).toBe(75 * INTERNAL_PER_DISPLAY);
  expect(account.reserved).toBe(0);
  expect(await prisma.creditLedger.count({ where: { orgId: ws.orgId } })).toBe(1); // the grant only
});
