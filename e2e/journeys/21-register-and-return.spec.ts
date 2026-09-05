/**
 * Journey 21 — a stranger registers, and comes back through the door they were sent to.
 *
 * FRONT-A2's first half (docs/specs/frontend-baseline.md §2): register with an email, receive the
 * confirmation the product actually mails, finish verification, then sign in again from
 * `/login?from=/create` and land on `/create`. Until this journey existed, registration had server
 * tests (`apps/web/lib/__tests__/signup-door.test.ts` drives Better Auth's own endpoints) but no
 * proof that the SCREENS a merchant touches hang together: the signup form, the mailed link, the
 * landing page it forwards through, and the password door on the way back.
 *
 * WHAT IS REAL HERE. Everything except the inbox. The account is created by the product's own
 * form, the verification link is the one the product handed to its mail transport (read back from
 * the stub transport's outbox — see support/auth.ts for why that, and not the database, is the
 * honest stand-in for these two link emails), the workspace is minted by the product's own
 * `afterEmailVerification`, and the second sign-in walks the login page step by step. Nothing is
 * forged and nothing is deep-linked past.
 *
 * SERIAL ON PURPOSE. The three tests are three moments of ONE merchant's first day, in order:
 * there is no way to "sign back in" as an account that was never created. `describe.serial` says
 * that out loud, so a failure in the first stops the rest instead of reporting three unrelated
 * defects.
 */
import { test, expect } from "@playwright/test";
import {
  clearAuthRateLimitCounters,
  clearMailOutbox,
  linkFromInbox,
  signInWithPassword,
} from "../support/auth.js";
import { prisma } from "../support/db.js";

// Not a seeded fixture: this journey is ABOUT the account not existing yet. The address is unique
// to this journey for the same reason every fixture slug is — two journeys sharing one would share
// a person.
const EMAIL = "newcomer@e2e.test";
const PASSWORD = "correct-horse-battery-staple";
const SHOP = "Newcomer Cafe";

test.describe.serial("FRONT-A2 — registration, verification, and the way back in", () => {
  test("A stranger registers, confirms the mailed link, and lands in the product", async ({ page }) => {
    await clearAuthRateLimitCounters();
    await clearMailOutbox();

    await page.goto("/signup?from=/create");
    await page.getByLabel("Shop name").fill(SHOP);
    await page.getByLabel("Email", { exact: true }).fill(EMAIL);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();

    // The product says what it did, and names the address it did it for.
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    await expect(page.getByText(EMAIL)).toBeVisible();

    // Unverified means no tenant and no money yet — the claim the signup screen makes ("your
    // starter credits are added after confirmation") asserted rather than assumed.
    expect(await prisma.user.findUnique({ where: { email: EMAIL } })).toBeNull();

    // The link the product mailed. It lands on the product's own waiting page, which forwards to
    // Better Auth's verification endpoint; verification signs the merchant in and returns them to
    // where signup started them off (`?from=/create`).
    await page.goto(await linkFromInbox());
    await expect(page).toHaveURL(/\/create/);
    await expect(page.getByRole("link", { name: "FIKIRTIVE home" })).toBeVisible();

    // Verification is what turns "email proven" into a workspace.
    expect(await prisma.user.findUnique({ where: { email: EMAIL } })).not.toBeNull();
  });

  test("The registered merchant signs back in with their password and returns to /create", async ({ page }) => {
    // The round trip FRONT-A2 names: the wall keeps the destination, the password door honours it.
    await page.goto("/create");
    await expect(page).toHaveURL(/\/login/);
    expect(new URL(page.url()).searchParams.get("from")).toBe("/create");

    await signInWithPassword(page, EMAIL, PASSWORD, "/create");
  });

  test("A wrong password reads the same whether or not the address has an account", async ({ page }) => {
    // FRONT-A2's last clause. A registered address and one nobody has ever registered must read
    // identically on a failed attempt — otherwise the login form is an account-existence oracle.
    const answers: string[] = [];
    for (const email of [EMAIL, "nobody-here@e2e.test"]) {
      await clearAuthRateLimitCounters();
      await page.goto("/login?from=/create");
      await page.getByRole("button", { name: "Continue with email" }).click();
      await page.getByLabel("Email", { exact: true }).fill(email);
      await page.getByRole("button", { name: "Use password instead" }).click();
      await page.getByLabel("Password", { exact: true }).fill("not-the-right-password");
      await page.getByRole("button", { name: "Log in" }).click();

      const alert = page.getByRole("alert");
      await expect(alert).toBeVisible();
      answers.push(((await alert.textContent()) ?? "").trim());
      // And neither attempt got in.
      await expect(page).toHaveURL(/\/login/);
    }

    expect(answers[0]).toBe(answers[1]);
    // Not merely equal — equal AND silent about the address itself.
    expect(answers[0]).not.toContain(EMAIL);
    expect(answers[0]).not.toMatch(/no account|not found|doesn't exist|unknown/i);
  });
});
