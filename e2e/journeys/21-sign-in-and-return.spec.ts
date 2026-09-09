/**
 * Journey 21 — one door, and the way back to where you were headed.
 *
 * 这条旅程原本叫 "register and return"：商家在 `/signup` 用邮箱＋密码开号、点验证信、再用密码
 * 登录回 `/create`。密码整体退役之后（docs/specs/sign-in.md，已冻结 · v1；SIGNIN-A4）那三步里
 * 有两步的门已经不存在了，所以旅程按同一件事的新走法重写：**码门**走完整个来回。
 *
 * 钉的还是 FRONT-A2 的后半段（`?from=` 的来回不许丢目的地）与规格 §1 第 2 问（`/login` 是唯一
 * 的门），只是凭据从密码换成六位码。
 *
 * WHAT IS REAL HERE. 除了收件箱以外全是真的：码是产品自己铸的（读的是它交给投递通道的那一份，
 * 见 support/auth.ts），登录页一步一步真的按过去，会话由产品自己发。什么都没有伪造，也没有
 * 深链绕过任何一道闸。
 */
import { test, expect } from "@playwright/test";
import { seedWorkspace } from "../support/seed.js";
import { clearAuthRateLimitCounters, codeFromInbox, signIn } from "../support/auth.js";

test("SIGNIN-A4 — A merchant comes in through the one door and lands where they were headed", async ({
  page,
}) => {
  const ws = await seedWorkspace({
    slug: "return",
    workspaceName: "Return Cafe",
    personName: "Aisha",
    openingGrant: 40,
  });

  // 墙先把目的地记下来 —— 这一半是 FRONT-A2 点名的来回。
  await page.goto("/create");
  await expect(page).toHaveURL(/\/login/);
  expect(new URL(page.url()).searchParams.get("from")).toBe("/create");

  // 门只有一扇：`signIn` 走的就是登录页上那两步（要码、输码），没有第二条路可选。
  await signIn(page, ws, "/create");
});

test("SIGNIN-A4 — The login page offers no password anywhere, and no second signup page", async ({
  page,
}) => {
  await page.goto("/login?from=/create");

  // hub：两扇门，没有「Create an account」。
  await expect(page.getByRole("button", { name: "Continue with email" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create an account" })).toHaveCount(0);
  await expect(page.locator('input[type="password"]')).toHaveCount(0);

  // email 步：只有邮箱与一颗按钮，没有「Use password instead」。
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Use password instead" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Forgot password?" })).toHaveCount(0);
  await expect(page.locator('input[type="password"]')).toHaveCount(0);

  // 以前用 `?step=password` 就能直接跳进密码那一屏。现在那一屏不存在，深链落回 hub。
  await page.goto("/login?step=password&from=/create");
  await expect(page.getByRole("heading", { name: "Log in to Fikirtive" })).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
});

test("SIGNIN-A4 — A wrong code reads the same whether or not the address has an account", async ({
  page,
}) => {
  // 旧旅程用密码钉这一条（「Wrong email or password.」对两种地址逐字相同）。密码退役之后，同一
  // 条性质要由码门扛：一个真商家与一个从来没有过的地址，输错码读到的必须是同一句话。
  const ws = await seedWorkspace({
    slug: "neutral",
    workspaceName: "Neutral Cafe",
    personName: "Kaia",
    openingGrant: 0,
  });
  // 真商家先拿一份真的码，好让「码存在但输错了」与「这个地址根本没有码」两种世界都被走到。
  await clearAuthRateLimitCounters();
  await page.goto("/login?from=/create");
  await page.getByRole("button", { name: "Continue with email" }).click();
  await page.getByLabel("Email", { exact: true }).fill(ws.email);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await codeFromInbox(ws.email);

  const answers: string[] = [];
  for (const email of [ws.email, "nobody-here@e2e.test"]) {
    await clearAuthRateLimitCounters();
    await page.goto("/login?from=/create");
    await page.getByRole("button", { name: "Continue with email" }).click();
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByRole("button", { name: "Continue with email" }).click();
    await page.getByLabel("Login code").fill("000000");
    await page.getByRole("button", { name: "Continue with login code" }).click();

    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible();
    answers.push(((await alert.textContent()) ?? "").trim());
    await expect(page).toHaveURL(/\/login/);
  }

  expect(answers[0]).toBe(answers[1]);
  // 不只是相同，而且相同**并且**不提那个地址本身。
  expect(answers[0]).not.toContain(ws.email);
  expect(answers[0]).not.toMatch(/no account|not found|doesn't exist|unknown/i);
});
