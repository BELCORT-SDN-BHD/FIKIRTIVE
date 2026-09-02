/**
 * Journey 12 — the first thing a merchant does after signing in.
 *
 * Creating a project is the cheapest possible write in the product, and it is the one every other
 * journey depends on: it proves a signed-in browser can reach a server action, that the action
 * writes under this workspace, and that the new project is the one the app then opens. Making it
 * costs nothing, and this journey asserts that too, because a free action that quietly touched
 * the wallet would be the worst kind of money defect.
 *
 * What "costs nothing" means changed with the switched shell, and the assertion at the bottom
 * says so out loud: the one entry a merchant now has starts a Canvas AND its first Otto turn,
 * and that turn is metered. So the claim is no longer "the ledger has one row" — it is "no row
 * belongs to making the canvas, and the turn only ever holds credits, never spends them."
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

  // W2-11 / #609 — the old `/otto` workbench, its collapsed projects rail and the bare
  // "New canvas" button that made an EMPTY project are all gone. The front door a merchant now
  // really has is two steps, and this journey walks both rather than deep-linking past the first:
  //
  //   Home's "Continue creating" card offers "Create something new" → `/create`, and Create is
  //   where the single production entry lives (`components/start-something/StartSomething.tsx`,
  //   Founder ruling 2026-08-18 Q2-A): describe what you want, press Start.
  //   `createCanvasConversation` then writes the Canvas, an empty Conversation and a durable
  //   first-turn handoff in ONE transaction, and the app opens the canvas it just made.
  await page.getByRole("link", { name: "Create something new" }).click();
  await expect(page).toHaveURL(/\/create$/);

  // WAITED FOR HYDRATION, not merely for paint — the same defect the old comment here described,
  // closed with the helper written for it: a keystroke or click that lands before React owns the
  // control is discarded and never replayed, and the journey would then spend its whole budget
  // waiting for a project that was never asked for (#981, support/ui.ts). The composer is a
  // CONTROLLED textarea, so this bites it twice: an un-hydrated fill leaves `draft` empty and the
  // Start button stays disabled forever — which is exactly what this journey then waits on.
  const composer = page.getByRole("textbox", { name: "Describe what you want to create" });
  await waitUntilInteractive(composer);
  await composer.fill("A poster for our weekend kopi set");
  const start = page.getByRole("button", { name: "Start a Canvas with Otto" });
  await expect(start).toBeEnabled();
  await start.click();

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

  // FREE IS FREE — and the assertion has to stay race-free, which is why it is shaped like this.
  //
  // The front door now does TWO things: it makes the Canvas (free), and Canvas then sends the
  // merchant's first sentence through the existing Otto stream (metered — `withLlmBudget`
  // reserves inside the open SSE response). So "the ledger has exactly one row" is no longer a
  // fact about this journey: it is a fact about WHEN you look. Measured on this suite, the
  // RESERVE/REFUND pair for that turn lands ~1s after the URL changes — the old count assertion
  // passed only by reading first, which is precisely the kind of green this suite forbids
  // itself (`playwright.config.ts`: no retries, a journey that cannot pass three times is not
  // finished).
  //
  // What IS true at every instant, and is the claim this journey was written to make:
  //
  //   ① Making the canvas moved no money. Every ledger row this org has is either the opening
  //      grant or belongs to the conversation's own turn (`otto-stream:<messageId>`) — there is
  //      no third kind of row, so nothing was charged for the project itself.
  //   ② The turn only ever HOLDS. balance + reserved is conserved: RESERVE moves credits from
  //      one column to the other and REFUND moves them back. (Nothing can settle: the suite runs
  //      with no ANTHROPIC_API_KEY — global-setup.ts refuses to start if one is present — so the
  //      turn burns no tokens.)
  //
  // Both hold before the reserve, during it, and after the refund. Nothing here waits.
  const ledger = await prisma.creditLedger.findMany({
    where: { orgId: ws.orgId },
    select: { kind: true, refId: true },
  });
  const notTheConversation = ledger.filter((row) => !(row.refId ?? "").startsWith("otto-stream:"));
  expect(notTheConversation).toHaveLength(1);
  expect(notTheConversation[0]!.kind).toBe("GRANT");

  const account = await readAccount(ws);
  expect(account.balance + account.reserved).toBe(75 * INTERNAL_PER_DISPLAY);
});
