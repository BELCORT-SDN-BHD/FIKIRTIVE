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
import { prisma } from "../support/db.js";
import { clearAuthRateLimitCounters, codeFromInbox, signIn } from "../support/auth.js";

/**
 * SIGNIN-A1 —— 一个从未出现过的邮箱，走码门直接进产品并且开好账号
 * （docs/specs/sign-in.md 已冻结 · v1，验收表第 1 格逐字）。
 *
 * 这是这一片真正的产品变化，所以它值一条自己的旅程：没有种子、没有名单行、没有邀请 ——
 * 只有一个谁都没听说过的地址，按 Continue with email、收码、输码，然后落在首页里。
 * 「全程没有出现第二个页面叫注册」由第二条旅程（`/signup` → `/login`，没有 Create an account）
 * 一起守着。
 */
test("SIGNIN-A1 — A merchant nobody has ever heard of asks for a code and lands inside, with an account", async ({
  page,
}) => {
  const email = `newcomer-${Date.now()}@e2e.test`;

  // 开工前：库里一个字都没有他 —— 这条旅程真的在开新号，不是在登录一个种子账号。
  expect(await prisma.betterAuthUser.count({ where: { email } })).toBe(0);
  expect(await prisma.allowedEmail.count({ where: { email } })).toBe(0);

  await clearAuthRateLimitCounters();
  await page.goto("/login?from=/create");
  await page.getByRole("button", { name: "Continue with email" }).click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Continue with email" }).click();

  // 「We sent a temporary login code to …」—— 陌生人与老商家读到的是同一句。
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  const code = await codeFromInbox(email);
  await page.getByLabel("Login code").fill(code);
  await page.getByRole("button", { name: "Continue with login code" }).click();

  // 直接进产品，落在他本来要去的地方。
  await expect(page).toHaveURL(/\/create/);
  await expect(page.getByRole("link", { name: "FIKIRTIVE home" })).toBeVisible();

  // SIGNIN-A10 —— 账号与工作区已建立：工作区名为空、邮箱已验证、名单行记着来源门。
  const user = await prisma.user.findUnique({ where: { email } });
  expect(user, "首登没有建出账号").not.toBeNull();
  const org = await prisma.organization.findUnique({ where: { id: `org_${user!.id}` } });
  expect(org, "首登没有建出工作区").not.toBeNull();
  expect(org!.name).toBe("");
  expect((await prisma.betterAuthUser.findUnique({ where: { email } }))!.emailVerified).toBe(true);
  const admitted = await prisma.allowedEmail.findUnique({ where: { email } });
  expect(admitted?.status).toBe("active");
  expect(admitted?.invitedBy).toBe("sign-in-code");
  // 赠金恰好一笔。金额由 packages/core 的常量决定，这里只钉「一笔」。
  expect(
    await prisma.creditLedger.count({ where: { orgId: `org_${user!.id}`, kind: "GRANT" } }),
  ).toBe(1);
});

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

test("SIGNIN-A4/A7 — A wrong code reads the same for a merchant, a newcomer and a revoked address", async ({
  page,
}) => {
  // 旧旅程用密码钉这一条（「Wrong email or password.」对两种地址逐字相同）。密码退役之后，同一
  // 条性质由码门扛。
  //
  // SIGNIN-A1 之后这条要多走一个地址：码门对陌生人打开之后，「真商家 vs 陌生人」两个世界在
  // 门这边已经**一样**了（两个都会拿到码），所以只比这两个已经证明不了什么。真正还剩下的那条
  // 差异是**被撤销的**地址——它一个码都拿不到，规格 §1.3 要求它的页面反应与「码错」完全一致。
  const ws = await seedWorkspace({
    slug: "neutral",
    workspaceName: "Neutral Cafe",
    personName: "Kaia",
    openingGrant: 0,
  });
  const revoked = `revoked-${Date.now()}@e2e.test`;
  await prisma.allowedEmail.create({
    data: { email: revoked, status: "revoked", invitedBy: "e2e-operator" },
  });
  // 真商家先拿一份真的码，好让「码存在但输错了」与「这个地址根本没有码」两种世界都被走到。
  await clearAuthRateLimitCounters();
  await page.goto("/login?from=/create");
  await page.getByRole("button", { name: "Continue with email" }).click();
  await page.getByLabel("Email", { exact: true }).fill(ws.email);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await codeFromInbox(ws.email);

  const answers: string[] = [];
  for (const email of [ws.email, `nobody-here-${Date.now()}@e2e.test`, revoked]) {
    await clearAuthRateLimitCounters();
    await page.goto("/login?from=/create");
    await page.getByRole("button", { name: "Continue with email" }).click();
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByRole("button", { name: "Continue with email" }).click();
    await page.getByLabel("Login code").fill("000000");
    await page.getByRole("button", { name: "Continue with login code" }).click();

    // 判官 #1336 P1:`page.getByRole("alert")` 没有作用域会连 Next 的路由播报器一起命中,
    // Playwright strict mode 直接报错。播报器是 `<next-route-announcer>` —— <body> 的直接
    // 子元素,影子根里挂着 `#__next-route-announcer__`(自带 role="alert"),`getByRole` 会
    // 穿进开放影子根,所以它跑不掉;它的内容由 `router.push`(LoginForm 每次换步都调)喂,
    // 于是 toBeVisible 时只有一条、读 textContent 时变成两条 —— 竞态,本地绿、CI 红。
    // 修法是把范围收进登录卡片(AuthStepCard → ui/card 的 data-slot="card"):播报器挂在
    // <body> 上、不在卡里(实测 `closest('[data-slot="card"]')` 为 null),而卡里每一步只有
    // 一条 Alert。刻意**不**按文案 filter:这条验收要比的就是「读到的那句话」,先按文案筛
    // 会把两种世界的差异一起筛掉。
    const alert = page.locator('[data-slot="card"]').getByRole("alert");
    await expect(alert).toBeVisible();
    answers.push(((await alert.textContent()) ?? "").trim());
    await expect(page).toHaveURL(/\/login/);
  }

  expect(answers[1]).toBe(answers[0]);
  expect(answers[2]).toBe(answers[0]);
  // 不只是相同，而且相同**并且**不提那个地址本身。
  expect(answers[0]).not.toContain(ws.email);
  expect(answers[0]).not.toContain(revoked);
  expect(answers[0]).not.toMatch(/no account|not found|doesn't exist|unknown|revoked|paused/i);
});
