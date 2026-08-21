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
import { waitUntilInteractive } from "../support/ui.js";
import { prisma, INTERNAL_PER_DISPLAY } from "../support/db.js";

test("A merchant creates a project, lands in it, and is charged nothing for it", async ({ page }) => {
  const ws = await seedWorkspace({
    slug: "project",
    workspaceName: "Kaia Cafe",
    personName: "Kaia",
    openingGrant: 75,
  });

  await signIn(page, ws, "/");

  // W2-11 — the old `/otto` workbench and its collapsed projects rail are gone, and with them
  // the "Show sidebar" toggle and the second "New project" button that lived inside it. The
  // switched shell has exactly ONE way to start a canvas (`components/start-something/
  // StartSomething.tsx`, Founder ruling 2026-08-18 Q2-A): the same component on Home and on
  // Create, whose "New canvas" button calls the same `createProject` server action the old
  // button called. So this journey drives the front door a merchant now really has.
  //
  // WAITED FOR HYDRATION, not merely for paint — the same defect the old comment here described,
  // closed with the helper written for it: a click that lands before React owns the button is
  // discarded and never replayed, and the journey would then spend its whole budget waiting for
  // a project that was never asked for (#981, support/ui.ts).
  const newCanvas = page.getByRole("button", { name: "New canvas" });
  await waitUntilInteractive(newCanvas);
  await newCanvas.click();

  // The app opens the project it just made, on the canvas: a different id in the URL than the
  // seeded one.
  await expect(page).toHaveURL(/\/create\/canvas\?project=/);
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
