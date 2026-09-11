/**
 * Journey 23 —— **两扇门，一个工作区**（docs/specs/sign-in.md 已冻结 · v1，验收 SIGNIN-A12）。
 *
 * 验收表第 12 格逐字：「陌生邮箱收码登录 → 生成一张图 → 登出 → 同邮箱 Google 登录」，看到的是
 * 「刚才那张图；始终是同一个工作区」。这是整张验收表里唯一一条**跨两扇门**的判定，也是唯一一条
 * 只有端到端才证得了的：单测能证明 `handleOAuthUserInfo` 会按已验证邮箱合并，证不了商家换一扇门
 * 回来之后屏幕上还是他那张图。合并这件事一旦坏掉，坏法不是报错，是**第二个空工作区** —— 商家以为
 * 自己的东西丢了，而每一条服务端断言都还是绿的。
 *
 * 真的是什么，替身是什么：
 *   · 码门：全真。码是产品自己铸的（`support/auth.ts` 读的是它交给投递通道的那一份），登录页
 *     一步一步真的按过去，账号、工作区、赠金全是 `bootstrapPersonalOrg` 现场开的。
 *   · Google 门：只有 **Google 自己那个签名**是替身（`packages/core/src/e2e-google-door-stub.ts`
 *     的两把锁；走的是 Better Auth 自己的 One Tap 入口）。之后的账号合并、三步判定、会话闸、
 *     身份收敛、会话 cookie 全程照跑。
 *   · 「生成一张图」：这台跑道上没有 worker，也没有任何供应商凭据（`support/env.ts` 逐条挡），
 *     所以那张图与那笔账由套件自己按产品的形状写下 —— 素材走 `seedLibraryMedia`（库页真的读
 *     得到的那一行），钱走 `seedSettledJob`（RESERVE + SETTLE，键与 `packages/db/src/credits.ts`
 *     逐字同形）。这一步不是本旅程要问的问题；本旅程要问的是**换一扇门回来之后它们还在不在、
 *     有没有变成两份**。
 */
import { test, expect } from "@playwright/test";
import {
  adoptProductWorkspace,
  countLedgerRows,
  seedLibraryMedia,
  seedSettledJob,
} from "../support/seed.js";
import { prisma } from "../support/db.js";
import { clearAuthRateLimitCounters, codeFromInbox, signInWithGoogle } from "../support/auth.js";

/** 商家认得出自己那张图，靠的是这句提示词 —— 库页上那颗按钮的名字就是它。 */
const PROMPT = "Kopi tin on a rattan table at golden hour";

test("SIGNIN-A12 — 陌生邮箱收码登录、生成一张图、登出，再用同邮箱的 Google 登录：看到刚才那张图，始终是同一个工作区", async ({
  page,
}) => {
  const email = `two-doors-${Date.now()}@e2e.test`;

  // 开工前库里一个字都没有他：这一趟真的在开新号。
  expect(await prisma.betterAuthUser.count({ where: { email } })).toBe(0);
  expect(await prisma.user.count({ where: { email } })).toBe(0);
  expect(await prisma.allowedEmail.count({ where: { email } })).toBe(0);

  /* ── ① 码门：陌生邮箱收码，直接进产品 ──────────────────────────────────── */

  await clearAuthRateLimitCounters();
  await page.goto("/login?from=/");
  await page.getByRole("button", { name: "Continue with email" }).click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  const code = await codeFromInbox(email);
  await page.getByLabel("Login code").fill(code);
  await page.getByRole("button", { name: "Continue with login code" }).click();
  await expect(page.getByRole("link", { name: "FIKIRTIVE home" })).toBeVisible();

  // 产品自己开出来的那个工作区 —— 这里一行都不补，只是把它读出来（见 `adoptProductWorkspace`）。
  const ws = await adoptProductWorkspace(email);
  const orgIdAfterCode = ws.orgId;

  /* ── ② 生成一张图，账本上恰好一笔收费 ─────────────────────────────────── */

  const { refId } = await seedSettledJob(ws, { held: 1, kind: "IMAGE" });
  await seedLibraryMedia(ws, { prompt: PROMPT });
  // 一次生成 = 一次扣款：一条 RESERVE 加一条 SETTLE，没有第三条。
  expect(await countLedgerRows(ws, refId)).toBe(2);
  expect(
    await prisma.creditLedger.count({ where: { orgId: ws.orgId, refId, kind: "SETTLE" } }),
  ).toBe(1);

  // 商家在库里看得见它。
  await page.goto("/library");
  await expect(page.getByRole("button", { name: `Open ${PROMPT}` })).toBeVisible();

  /* ── ③ 登出：cookie 真的死了 ───────────────────────────────────────────── */

  await page.getByRole("banner").getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/library");
  await expect(page).toHaveURL(/\/login/);

  /* ── ④ 同一个邮箱，换 Google 门回来 ───────────────────────────────────── */

  const google = await signInWithGoogle(page, email);
  expect(google.status, "Google 门没有让这个已经存在的邮箱进来").toBe(200);

  /* ── ⑤ 看到的是刚才那张图，而且始终是同一个工作区 ─────────────────────── */

  await page.goto("/library");
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByRole("button", { name: `Open ${PROMPT}` })).toBeVisible();

  // 「同一个工作区」不只是屏幕上看起来一样：库里必须**只有一个**。合并坏掉的时候，屏幕上是一个
  // 空库，而这几行才说得出为什么。
  const users = await prisma.user.findMany({ where: { email }, select: { id: true } });
  expect(users).toHaveLength(1);
  expect(`org_${users[0]!.id}`).toBe(orgIdAfterCode);
  const baUsers = await prisma.betterAuthUser.findMany({ where: { email }, select: { id: true } });
  expect(baUsers).toHaveLength(1);
  expect(
    await prisma.membership.count({ where: { userId: users[0]!.id, orgId: orgIdAfterCode } }),
  ).toBe(1);

  // 第二扇门没有再开一次户：赠金仍然只有一笔，那笔收费也仍然只有一笔。
  expect(
    await prisma.creditLedger.count({ where: { orgId: orgIdAfterCode, kind: "GRANT" } }),
  ).toBe(1);
  expect(
    await prisma.creditLedger.count({ where: { orgId: orgIdAfterCode, refId, kind: "SETTLE" } }),
  ).toBe(1);

  // 两扇门确实是**两扇**：google 那份凭据挂在同一个用户上，不是另一个用户上。
  expect(
    await prisma.betterAuthAccount.count({ where: { providerId: "google", userId: baUsers[0]!.id } }),
  ).toBe(1);

  // 名单那一行还是码门写下的那一行 —— 第二扇门没有把来源门标记改掉，也没有多写一行。
  const admitted = await prisma.allowedEmail.findMany({ where: { email } });
  expect(admitted).toHaveLength(1);
  expect(admitted[0]!.invitedBy).toBe("sign-in-code");
});

/**
 * SIGNIN-A12 的**证据本身**要立得住：上面那一趟绿，只有在替身真的是一道检查、而不是一个永远
 * 说是的橡皮图章时才有意义。
 *
 * 所以这一条反着走一遍，而且是**同一个载荷、只差一个 HMAC** 的两态对照（判官 #1349 P2）：
 *   · 签名不对 → 401，而且是替身**验签失败**那一步拒的（库对 `verifyIdToken` 返回 false 的
 *     判词逐字是 `INVALID_TOKEN`，`api/routes/sign-in.mjs:82-85`）。不查这个码，401 可能来自
 *     另外五个地方（供应商不认、拿不到用户信息、载荷里没邮箱、合并失败……），这条反证就证不到
 *     它要证的那一步。
 *   · 同一个邮箱、同一份载荷，签名换回对的 → 200 并且真的开出了那一行。少了这一半，「401」也
 *     可能只是说明这条路对**任何**替身 token 都说不。
 *
 * 「一行都没留下」查的必须是被拒那个 token **自己声称**的邮箱 —— 查别的邮箱是一句恒真的话。
 */
test("SIGNIN-A12 — 替身不是橡皮图章：同一份载荷，只把签名改掉就进不来", async ({ page }) => {
  const email = `forged-google-${Date.now()}@e2e.test`;
  expect(await prisma.betterAuthUser.count({ where: { email } })).toBe(0);

  const forged = await signInWithGoogle(page, email, { forgeSignature: true });
  expect(forged.status, "一个签名不对的 id_token 换到了会话").toBe(401);
  expect(forged.code, "拒是拒了，但不是替身验签那一步拒的 —— 这条反证没证到它要证的地方").toBe(
    "INVALID_TOKEN",
  );

  // 没有会话，也没有为**这个 token 声称的那个邮箱**留下任何一行。
  await page.goto("/library");
  await expect(page).toHaveURL(/\/login/);
  expect(await prisma.betterAuthUser.count({ where: { email } })).toBe(0);
  expect(await prisma.user.count({ where: { email } })).toBe(0);

  // 只把签名换回对的：同一个邮箱这一次进得来。两次之间只差一个 HMAC，所以上面那个 401
  // 只能归给验签。
  const honest = await signInWithGoogle(page, email);
  expect(honest.status, "签得对的替身 token 也进不来 —— 那上面那条 401 就说明不了任何事").toBe(200);
  expect(await prisma.betterAuthUser.count({ where: { email } })).toBe(1);
});
