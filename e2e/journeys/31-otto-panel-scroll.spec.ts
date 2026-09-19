/**
 * Journey 31 —— R3-F34:Otto 面板收到一条长回答之后,滚轮还滚得动,回复框还在看得见的地方。
 *
 * 走查现场(staging `bd5877c3`,2026-09-19):一条 4,870 字的回答之后,
 * `textarea[aria-label="Reply to Otto"]` 落在可视区下面 **6,982px**,而鼠标滚轮在整块面板里
 * 一格都不动 —— 滚轮事件到得了、没有人 preventDefault、`el.scrollTop=200` 赋得进去,
 * 同一份输入在一个对照 div 上滚得动。商家读到的不是「再往下滚」,是「面板卡死了」。
 * 现场与量到的数见 `docs/audits/fullstack-staging-2026-09-14/findings-catalog.md` R3-F34。
 *
 * **为什么这条旅程非真浏览器不可**:病根是一条 CSS 高度链
 * (`[data-otto-panel-body]` 少了 `flex flex-col` ⇒ `display:block` ⇒ 子层 `flex-1` 失效 ⇒
 * 会话列按内容长到体外面 ⇒ 会话视口 `height:100%` 对着内容撑出来的父亲解析 ⇒
 * `clientHeight === scrollHeight`,零行程,而它还带着 `overscroll-contain`,滚轮被咬住不往上传)。
 * jsdom 不排版,量不了一个像素;那一半只钉得住结构合同
 * (`apps/web/lib/__tests__/otto-panel-scroll-chain-r3f34.test.tsx`)。**行程、矩形、滚轮**
 * 这三件事只有真的排过版、真的滚过一次才算数 —— 这条旅程就是那一次。
 *
 * 真的是什么,替身是什么:那条长回答由套件按产品自己的形状写进库
 * (`seedAgentText`,与 Otto 说话时落的是同一张表同一种 kind);这台跑道上一把供应商钥匙都没有
 * (`support/env.ts` 逐条挡),所以「让 Otto 现场答一句」不可能、也不该可能。渲染、排版、
 * 滚动与滚轮全程是产品自己的代码。
 */
import { test, expect, type Page } from "@playwright/test";
import { seedWorkspace, seedThread, seedAgentText } from "../support/seed.js";
import { signIn } from "../support/auth.js";
import { waitUntilInteractive } from "../support/ui.js";

/** 一条**长到装不下**的回答。走查里那条 4,870 字,这里按同一量级造,内容与判定无关。 */
const LONG_ANSWER = Array.from(
  { length: 40 },
  (_, i) =>
    `Step ${i + 1} — Plan this week's posts. Pick one product, write one caption, and schedule it for the morning slot when your customers are actually awake and scrolling.`,
).join("\n\n");

/** 面板体、会话视口、回复框、面板框 —— 一次量回来,免得来回四趟各自看到不同的一帧。 */
async function measure(page: Page) {
  return page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>("[data-otto-panel]")!;
    const body = document.querySelector<HTMLElement>("[data-otto-panel-body]")!;
    const viewport = document.querySelector<HTMLElement>('[data-slot="message-scroller-viewport"]')!;
    const composer = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Reply to Otto"]')!;
    const box = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height };
    };
    return {
      panel: box(panel),
      body: { ...box(body), scrollTop: body.scrollTop, scrollHeight: body.scrollHeight, clientHeight: body.clientHeight },
      viewport: {
        ...box(viewport),
        scrollTop: viewport.scrollTop,
        scrollHeight: viewport.scrollHeight,
        clientHeight: viewport.clientHeight,
      },
      composer: box(composer),
    };
  });
}

/** 把鼠标放到会话正文中间,滚 `ticks` 下。正负 = 往下/往上。 */
async function wheelOverConversation(page: Page, deltaY: number) {
  const viewport = page.locator('[data-slot="message-scroller-viewport"]');
  const box = (await viewport.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, deltaY);
  // 滚动是异步提交的,给浏览器一帧把它落到 scrollTop 上。
  await page.waitForTimeout(250);
}

test("R3-F34 — 长回答之后:面板滚得动、回复框在可视区内、打开就停在最新一句", async ({ page }) => {
  const ws = await seedWorkspace({
    slug: "panelscroll",
    workspaceName: "Kopi Lane",
    personName: "Aisyah",
    openingGrant: 50,
  });
  // `surface: "panel"`(FRONT-A14):停靠面板只续它自己开的对话,不写这一格落到的是前门。
  const { threadId } = await seedThread(ws, { surface: "panel" });
  await seedAgentText(ws, threadId, { seq: 1, text: LONG_ANSWER });

  await signIn(page, ws, "/?otto=1");
  const composer = page.locator('textarea[aria-label="Reply to Otto"]');
  await waitUntilInteractive(composer);
  // 会话视口要先真的画出来,再谈量它 —— 否则量到的是一个还没排版的零。
  await expect(page.locator('[data-slot="message-scroller-viewport"]')).toBeAttached();
  // 视口拿到内容、autoScroll 做完第一次落位之后再读,避免读到中间那一帧。
  await expect
    .poll(async () => (await measure(page)).viewport.scrollHeight, {
      message: "会话视口一直没有内容 —— 那条长回答没有渲染出来",
    })
    .toBeGreaterThan(400);

  const before = await measure(page);

  /* ── ① 高度链没有断:整条会话列被压在面板体里,而不是长到体外面 ──────────── */

  // 病在的时候这个数是 8714 vs 600。留 2px 余量给亚像素取整。
  expect(
    before.body.scrollHeight,
    "面板体自己溢出了 —— 会话列又长到体外面去了(高度链断在体那一层)",
  ).toBeLessThanOrEqual(before.body.clientHeight + 2);

  /* ── ② 会话视口是那个**真有行程**的滚动容器 ────────────────────────────── */

  expect(
    before.viewport.scrollHeight,
    "会话视口零行程 —— 它仍是滚动容器却没得滚,滚轮会被它咬住不往上传",
  ).toBeGreaterThan(before.viewport.clientHeight + 2);

  /* ── ③ 回复框在面板看得见的那块里(走查那天它在下面 6,982px) ──────────── */

  expect(before.composer.bottom).toBeLessThanOrEqual(before.panel.bottom + 2);
  expect(before.composer.top).toBeGreaterThanOrEqual(before.panel.top - 2);
  const pageViewport = page.viewportSize()!;
  expect(before.composer.bottom).toBeLessThanOrEqual(pageViewport.height + 2);

  /* ── ④ 打开就停在最新一句(autoScroll 活着) ────────────────────────────── */

  const maxScroll = before.viewport.scrollHeight - before.viewport.clientHeight;
  expect(
    before.viewport.scrollTop,
    "打开面板没有停在最新一句 —— 商家要自己滚下去才看得到刚付钱买的那段回答",
  ).toBeGreaterThanOrEqual(maxScroll - 4);

  /* ── ⑤ 滚轮:往上滚得回去,再往下滚得回来(走查那天两个方向都死) ────────── */

  await wheelOverConversation(page, -600);
  const up = await measure(page);
  expect(up.viewport.scrollTop, "滚轮往上一格都不动").toBeLessThan(before.viewport.scrollTop - 50);

  await wheelOverConversation(page, 2000);
  const down = await measure(page);
  expect(down.viewport.scrollTop, "滚轮往下一格都不动").toBeGreaterThan(up.viewport.scrollTop + 50);

  /* ── ⑥ 展开视图是同一段 DOM,同样要成立(走查那天它一样死) ──────────────── */

  await page.getByRole("button", { name: "Expand Otto" }).click();
  await expect(page.getByRole("button", { name: "Collapse Otto" })).toBeVisible();
  await page.waitForTimeout(400); // 宽度有 200ms 过渡,等它落定再量。

  const expanded = await measure(page);
  expect(expanded.body.scrollHeight).toBeLessThanOrEqual(expanded.body.clientHeight + 2);
  expect(expanded.composer.bottom).toBeLessThanOrEqual(expanded.panel.bottom + 2);
  expect(expanded.viewport.scrollHeight).toBeGreaterThan(expanded.viewport.clientHeight + 2);

  await wheelOverConversation(page, -600);
  const expandedUp = await measure(page);
  expect(
    expandedUp.viewport.scrollTop,
    "展开视图里滚轮往上一格都不动 —— 商家读不回那段回答的开头",
  ).toBeLessThan(expanded.viewport.scrollTop - 50);
});
