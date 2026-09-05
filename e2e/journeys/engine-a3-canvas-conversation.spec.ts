/**
 * ENGINE-A3 —— 画布输入即对话（docs/specs/otto-engine.md 验收表第三行 · S2 §7.2⑦）。
 *
 * 验收原话:「商家在画布输入框发消息 ⇒ 得到 Otto 对话回复(非直接生成);花钱动作仍走卡片确认」。
 *
 * **这一趟旅程要证的,是单元测试证不了的那一半**:真浏览器、真路由、真渲染的一整块画布上,
 * 商家找不到第二个输入框、也找不到任何一颗按下去就扣钱的键。单元那一份
 * (`apps/web/lib/__tests__/engine-a3-canvas-conversation.test.tsx`)在 jsdom 里读的是同一份
 * DOM 集合,但它替掉了路由、认证与整条流;这里一件都不替。
 *
 * **⑦段之前这块板上有什么**:右侧工具条第一颗 `Generate image` 掀开一个 composer,里面那颗
 * `Generate` 按下去**当场扣钱**(图片路走的是宪法例外①「余额即闸」,没有确认框)。已批准的
 * 画布设计只有一个输入框 —— Otto 那一个(`design-system/patterns/canvas/CanvasReference.tsx`
 * 底部唯一 composer;工具条只有 select / frame select / hand),确认长在 Otto 当前轮的卡片上。
 *
 * **一分钱都不花**:这套 e2e 手上一把供应商钥匙都没有(`support/env.ts` 逐条挡)。会花钱的那
 * 一下(在卡上按 `Generate · N credits`)由 journey 16 用库状态覆盖;这一趟只走到「卡在那里、
 * 键在卡上」为止,并且当场核对账本零新增行。
 */
import { test, expect } from "@playwright/test";
import { seedWorkspace, seedThread, seedPlanCard, seedAgentText, countLedgerRows } from "../support/seed.js";
import { signIn } from "../support/auth.js";
import { waitUntilInteractive } from "../support/ui.js";

test("ENGINE-A3 — 画布只有 Otto 那一个输入,花钱长在对话的确认卡上", async ({ page }) => {
  const ws = await seedWorkspace({
    slug: "enginea3",
    workspaceName: "Kedai Kopi",
    personName: "Aina",
    openingGrant: 75,
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, ws, "/");

  // 产品自己的门,不深链(journey 12 记的是这两步)。
  await page.getByRole("link", { name: "Create something new" }).click();
  await expect(page).toHaveURL(/\/create$/);
  const brief = page.getByRole("textbox", { name: "Otto creation prompt" });
  await waitUntilInteractive(brief);
  await brief.fill("A poster for our weekend kopi set");
  const start = page.getByRole("button", { name: "Send prompt" });
  await expect(start).toBeEnabled();
  await start.click();
  await expect(page).toHaveURL(/\/create\/canvas\?project=/);

  // ── ① 画布上只有一个输入框 ────────────────────────────────────────────────────
  const ottoComposer = page.getByRole("textbox", { name: "Reply to Otto" });
  await waitUntilInteractive(ottoComposer);
  // 「只有一个」是真的比数量,不是「找得到一个」:直出 composer 的输入是一个 TipTap
  // contenteditable,所以两种形状都数一遍。板上剩下的那个 contenteditable 只在出片确认框
  // 打开时才存在,而此刻没有任何弹窗。
  const band = page.locator(".cv-creation-band");
  await expect(band).toHaveCount(1);
  await expect(band.locator("textarea")).toHaveCount(1);
  await expect(page.locator('.mention-input [contenteditable="true"]')).toHaveCount(0);

  // ── ② 直出那条路的三件东西一件都不剩 ──────────────────────────────────────────
  const tools = page.getByRole("toolbar", { name: "Canvas tools" });
  await expect(tools).toBeVisible();
  await expect(tools.getByRole("button", { name: "Generate image", exact: true })).toHaveCount(0);
  await expect(page.locator("form.cv-composer-pop")).toHaveCount(0);
  await expect(page.locator("form.al-promptbar")).toHaveCount(0);
  // 板面上没有任何一颗键的字面就是「Generate」——「Generate · N credits」长在对话的卡片上,
  // 那是另一回事,所以这里比的是逐字相等。
  await expect(page.getByRole("button", { name: "Generate", exact: true })).toHaveCount(0);

  // ── ③ 送出之前就读得到这一轮对话的价目(§7.4 一级 / §7.6 处置一)──────────────
  // 「先确认」与「这一程对话本身按用量计费」是同一句话的两半;少了后半句,就是 §7.6 点名的
  // 那种「两边验收都绿、商家的账单照涨」。
  await expect(band).toContainText("checks with you on a card before it makes anything");
  await expect(band).toContainText("charged for what it uses");
  // 搜索那一条(MONEY-A10)在画布 composer 上是⑦段的新写点 —— 从前它只挂在对话面板里。
  await expect(band).toContainText("Otto searches the web when your question needs it");

  // ── ④ 送出去的那一句得到的是对话,不是一次生成 ────────────────────────────────
  await ottoComposer.click();
  await ottoComposer.fill("Make it feel like a rainy Saturday morning");
  await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();
  // 这里**不按** Send:发出去要真调供应商,而这套 e2e 没有钥匙。「送出即对话」的接线由
  // 单元那一份逐参数钉住(startStreamedThread 收到 surface: "canvas");这一趟证的是屏幕上
  // 只有这一条路可走 —— 上面 ①②③ 已经把它证完了。草稿仍然是商家的,一分钱没动。
  await expect(ottoComposer).toHaveValue("Make it feel like a rainy Saturday morning");

  // ── ⑤ 花钱那一下长在对话的确认卡上 ────────────────────────────────────────────
  // 一条真的、报得出价的方案卡(服务端写的那份形状),放进这个 project 的另一条对话里。
  const { threadId } = await seedThread(ws);
  await seedAgentText(ws, threadId, { seq: 1, text: "Here's what I'd make — confirm and I'll start." });
  const { cardId } = await seedPlanCard(ws, threadId, { seq: 2, credits: 1 });
  await page.goto(`/create/canvas?project=${ws.projectId}&thread=${threadId}`);

  const turnCard = page.getByLabel("Otto current turn");
  await expect(turnCard).toBeVisible();
  const confirmation = turnCard.getByLabel("Generation confirmation").first();
  await expect(confirmation).toBeVisible();
  // 价钱在按钮上,所以按下去本身就是那次批准 —— 这是画布上**唯一**的花钱入口。
  await expect(confirmation.getByRole("button", { name: /Generate · 1 credit/ })).toBeVisible();
  // 对话回复本身先到 —— 「非直接生成」这半句的证据。
  await expect(turnCard).toContainText("Here's what I'd make");

  // 全程零花费:卡被看见了,没有被按下。
  expect(await countLedgerRows(ws, cardId)).toBe(0);
});
