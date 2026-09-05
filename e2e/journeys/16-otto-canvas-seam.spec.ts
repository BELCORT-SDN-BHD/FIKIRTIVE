/**
 * Journey 16 — CREATE-A1: 商家和 Otto 聊完，**不打开任何抽屉**就能确认，确认之后画布上真的有东西。
 *
 * 走查现场（2026-09-04，`scratchpad/creation-friction-audit.html`，staging，1440×900，
 * 真商家账号、真供应商）：
 *
 *   · P0-3 —— Otto 在始终可见那张卡上写「You'll see **two cards** above」（星号照原样显示），
 *     而那两张带 Generate 按钮的卡在**默认折起**的 Conversation 抽屉里；打开抽屉之后还自动
 *     滚过了头，卡在上边界之外。屏幕上唯一始终看得见的 Otto 卡，一个确认位都没有。
 *   · P0-1 —— 按下「Generate · 1 credit」之后，卡片走到「✓ Done · it used 1 credit」、余额
 *     73 → 72，而画布**全程一片空白**；按一次 F5，图就在那儿。
 *   · P1-1 —— 一次成功生成之后，那张可见卡上写着「🖼 result」——那是渲染器认领用的内部记号，
 *     不是给商家读的话。
 *
 * 这一趟走的是产品自己的门（Home → Create → 描述 → Start），种下去的只有「商家开口之前就该
 * 有的东西」：一条对话、Otto 说过的一句话、两张报得出价的方案卡。**这套 e2e 手上一把供应商
 * 钥匙都没有**（`support/env.ts` 逐条挡），所以真正按下 Generate 那一步用库状态代替：种一张
 * 已批准、任务在排队的卡，再看画布该不该有东西 —— 走查里它没有。
 */
import { test, expect } from "@playwright/test";
import { seedWorkspace, seedThread, seedPlanCard, seedAgentText, seedApprovedPlanCard, countLedgerRows } from "../support/seed.js";
import { signIn } from "../support/auth.js";
import { waitUntilInteractive } from "../support/ui.js";

test("CREATE-A1 — 确认卡在始终可见的 Otto 卡里，确认过的活儿在画布上看得见", async ({ page }) => {
  const ws = await seedWorkspace({
    slug: "seam",
    workspaceName: "Kopi Corner",
    personName: "Rahim",
    openingGrant: 73,
  });
  const { threadId } = await seedThread(ws);
  // Otto 说过的那句话，带的正是走查里露出星号的那种 markdown。
  await seedAgentText(ws, threadId, { seq: 1, text: "Here's the plan. You'll see **two cards** with what I'll make." });
  const { cardId } = await seedPlanCard(ws, threadId, { seq: 2, credits: 1 });
  await seedPlanCard(ws, threadId, { seq: 3, credits: 11, kind: "video", prompt: "Pan across the kopi set" });

  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, ws, "/");

  // 产品自己的门，不深链（journey 12 记的是这两步）。
  await page.getByRole("link", { name: "Create something new" }).click();
  await expect(page).toHaveURL(/\/create$/);
  await page.goto(`/create/canvas?project=${ws.projectId}&thread=${threadId}`);

  const turnCard = page.getByLabel("Otto current turn");
  await expect(turnCard).toBeVisible();

  // ① 确认位就在那张始终可见的卡里 —— 一个抽屉都没打开。走查里这里什么都没有。
  const confirmation = turnCard.getByLabel("Generation confirmation").first();
  await expect(confirmation).toBeVisible();
  // 价格在按钮上，所以「按下去」本身就是那次批准 —— 没有第二块写着同一个数字的确认屏。
  await expect(confirmation.getByRole("button", { name: /Generate · 1 credit/ })).toBeVisible();
  // 规格行逐字来自卡自己那份 payload（服务端按执行真正认的东西建的），不是聊天气泡里的说法。
  await expect(confirmation).toContainText("1 image");
  await expect(confirmation).toContainText("Brand and product photo");

  // ② 正文是人话：markdown 渲染成粗体，星号不出现在屏幕上。
  await expect(turnCard).toContainText("two cards");
  await expect(turnCard).not.toContainText("**");
  // 内部占位串永远不当正文（走查 P1-1 的另一半）。
  await expect(turnCard).not.toContainText("🖼");
  await expect(turnCard).not.toContainText("plan card");

  // ③ 卡上说的是这一刻的真状态。
  await expect(turnCard).toContainText("Needs confirmation");

  // 到这里为止一分钱都没花：确认位只是被看见了，没有被按下。
  expect(await countLedgerRows(ws, cardId)).toBe(0);

  // ④ 商家按下确认之后（库状态＝任务已建、在排队），画布上当场有一张生成中的卡。
  //    走查里这一步画布是空的，要按 F5 才看得见。
  const { threadId: approvedThread } = await seedThread(ws);
  await seedApprovedPlanCard(ws, approvedThread, { seq: 1, prompt: "A cup of kopi on a rattan table" });
  await page.goto(`/create/canvas?project=${ws.projectId}&thread=${approvedThread}`);

  const board = page.locator(".react-flow__node").first();
  await expect(board).toBeVisible({ timeout: 20_000 });
  // 它是一张**在生成中**的卡，不是空白、不是失败 —— 板上说得出自己在做什么。
  await expect(board).toContainText(/Generating|queue/i);
});
