/**
 * Journey 22 — the merchant who forgot their password.
 *
 * FRONT-A2's second half (docs/specs/frontend-baseline.md §2): "再走一次忘记密码 … 重置邮件可用、
 * 新密码能登录;错误提示不泄露该邮箱是否存在". Three things have to hold at once, and only the
 * three together mean anything:
 *
 *   · the reset link the product mails actually works, end to end, through the screens;
 *   · the new password is a real way in afterwards;
 *   · the screen says the SAME sentence for an address with an account and one without — while
 *     the world behind it differs. Asserting only the words would go green on a product that
 *     mailed nothing to anybody; asserting only the rows would go green on a product that told
 *     the browser which address exists. So this journey asserts both halves, together.
 *
 * The merchant here is a seeded workspace rather than a registration: what is under test is the
 * reset door, and journey 21 already walks the registration one. Resetting is allowed to be a
 * merchant's FIRST password (Better Auth creates the credential when there is none), which is
 * exactly the shape of a merchant who has only ever used sign-in codes.
 */
import { test, expect } from "@playwright/test";
import { seedWorkspace } from "../support/seed.js";
import {
  clearAuthRateLimitCounters,
  clearMailOutbox,
  linkFromInbox,
  signInWithPassword,
} from "../support/auth.js";
import { prisma } from "../support/db.js";

const NEW_PASSWORD = "a-brand-new-password-1";
/** Better Auth files a reset under `reset-password:<token>` (verification table). Counting them is
 *  how this journey sees whether a link was really minted, without ever reading a token. */
const countResetTokens = () =>
  prisma.betterAuthVerification.count({ where: { identifier: { startsWith: "reset-password:" } } });

test("A merchant resets a forgotten password and signs in with the new one", async ({ page }) => {
  const ws = await seedWorkspace({
    slug: "reset",
    workspaceName: "Kaia Cafe",
    personName: "Kaia",
    openingGrant: 40,
  });

  await clearAuthRateLimitCounters();
  await clearMailOutbox();
  const before = await countResetTokens();

  await page.goto("/forgot-password?from=/create");
  await page.getByLabel("Email", { exact: true }).fill(ws.email);
  await page.getByRole("button", { name: "Email me a reset link" }).click();

  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await expect(page.getByText("one-time reset link is on its way")).toBeVisible();
  // A link really was minted for this address.
  expect(await countResetTokens()).toBe(before + 1);

  // Follow the mailed link the way a merchant does. It goes to Better Auth's own reset route,
  // which checks the token is live and forwards to the product's reset screen with it.
  await page.goto(await linkFromInbox());
  await expect(page.getByRole("heading", { name: "Set a new password" })).toBeVisible();

  await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page.getByRole("heading", { name: "Password updated" })).toBeVisible();

  // Reset does not hand out a session — the merchant still has to come through the door.
  await page.goto("/billing");
  await expect(page).toHaveURL(/\/login/);

  await signInWithPassword(page, ws.email, NEW_PASSWORD, "/billing");
  await expect(page.getByText("Available balance")).toBeVisible();
});

test("The reset screen says the same thing for an address with no account — and mails nothing", async ({ page }) => {
  await clearAuthRateLimitCounters();
  await clearMailOutbox();
  const before = await countResetTokens();

  await page.goto("/forgot-password?from=/create");
  await page.getByLabel("Email", { exact: true }).fill("no-such-merchant@e2e.test");
  await page.getByRole("button", { name: "Email me a reset link" }).click();

  // Word for word what the merchant with an account was told.
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await expect(page.getByText("one-time reset link is on its way")).toBeVisible();
  await expect(page.getByText("The link expires in one hour")).toBeVisible();

  // …and nothing at all happened behind it. Better Auth writes the reset row inside the request,
  // before the neutral answer is returned, so this count is settled by the time the screen above
  // is on display — no waiting, nothing racy.
  expect(await countResetTokens()).toBe(before);
  expect(await prisma.betterAuthUser.findUnique({ where: { email: "no-such-merchant@e2e.test" } })).toBeNull();
});
