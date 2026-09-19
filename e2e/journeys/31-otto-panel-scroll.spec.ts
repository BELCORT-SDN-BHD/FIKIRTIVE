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
 *
 * **两条纪律,写在这里因为它们是这条旅程能不能被信的前提**:
 *
 *   · **零固定等待**。整个套件 `retries: 0`,一条靠 `waitForTimeout(250)` 凑出来的绿在忙一点的
 *     跑手上就是别人 PR 的一次假红。所有等待都 poll **将要被断言的那个数**本身(视口离底还差
 *     多少、滚轮之后 scrollTop 变没变、面板宽度停没停),等到了就往下走。
 *   · **等不到不抛,判定留给断言**。上面那些等待等不到就默默超时,真正的判定在十三条
 *     `expect.soft` 上 —— 一次跑因此会把**每一格**的实情都打印出来,而不是卡在第一个等待上、
 *     只报一格。这正是变异实证(把病根改回去重新 build)要的输出。
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

/** 视口离底还差多少像素。0 = 停在最新一句。 */
type Measurement = Awaited<ReturnType<typeof measure>>;
const distanceFromBottom = (m: Measurement) =>
  m.viewport.scrollHeight - m.viewport.clientHeight - m.viewport.scrollTop;

/** 面板体、会话视口、回复框、面板框 —— 一次量回来,免得来回四趟各自看到不同的一帧。 */
async function measure(page: Page) {
  return page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>("[data-otto-panel]")!;
    const body = document.querySelector<HTMLElement>("[data-otto-panel-body]")!;
    const viewport = document.querySelector<HTMLElement>('[data-slot="message-scroller-viewport"]')!;
    const composer = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Reply to Otto"]')!;
    const items = document.querySelectorAll<HTMLElement>('[data-slot="message-scroller-item"]');
    const newest = items[items.length - 1]!;
    const box = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height };
    };
    return {
      panel: box(panel),
      newestMessage: box(newest),
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

/**
 * 等到 `probe()` 说「好了」为止;**等不到就默默走人**,不抛。
 *
 * 判定一律留给下面的 `expect.soft`(见文件头第二条纪律)。这里用 Playwright 自己的
 * `expect.poll` 而不是 `waitForTimeout`:等的是**将要被断言的那个数**,不是一个猜出来的毫秒数。
 */
async function waitUntil(probe: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  try {
    await expect.poll(probe, { timeout: timeoutMs, intervals: [50, 100, 200, 400] }).toBe(true);
  } catch {
    // 等不到 = 产品这一格是坏的。让它坏在断言上,那里能打印出真正的数。
  }
}

/** 等到 `read()` 连着两次读出同一个数(= 过渡跑完了)。 */
async function waitUntilStable(read: () => Promise<number>, timeoutMs = 5_000): Promise<void> {
  let previous = Number.NaN;
  await waitUntil(async () => {
    const value = await read();
    const settled = value === previous;
    previous = value;
    return settled;
  }, timeoutMs);
}

/** 把鼠标放到会话正文中间滚一下,然后等 scrollTop 真的动了(动不了就等超时)。 */
async function wheelOverConversation(page: Page, deltaY: number): Promise<void> {
  const viewport = page.locator('[data-slot="message-scroller-viewport"]');
  const box = (await viewport.boundingBox())!;
  const before = (await measure(page)).viewport.scrollTop;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, deltaY);
  await waitUntil(async () => (await measure(page)).viewport.scrollTop !== before);
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
  // 会话视口要先真的在 DOM 里,再谈量它。这一条是**前提**不是判定,所以它是硬断言。
  await expect(page.locator('[data-slot="message-scroller-viewport"]')).toBeAttached();

  // 等的就是下面第 ④ 段要断言的那个数:视口离底还差多少。消息项挂着
  // `content-visibility:auto` + `contain-intrinsic-size`,而原语的自动到底是靠
  // ResizeObserver 驱动的 —— 内容一边解封一边重排,落位要好几帧才稳。poll 这个数,
  // 就不必猜要等多少毫秒,也不会在忙一点的跑手上假红。
  await waitUntil(async () => {
    const m = await measure(page);
    return (
      m.viewport.scrollHeight > 400 &&
      distanceFromBottom(m) <= 4 &&
      m.newestMessage.bottom <= m.panel.bottom + 2
    );
  });

  // 从这里往下,一切判定读的都是**同一帧**。
  const before = await measure(page);

  /* ── ① 高度链没有断:整条会话列被压在面板体里,而不是长到体外面 ──────────── */

  // 病在的时候这个数是 6063 vs 586。留 2px 余量给亚像素取整。
  expect.soft(
    before.body.scrollHeight,
    "面板体自己溢出了 —— 会话列又长到体外面去了(高度链断在体那一层)",
  ).toBeLessThanOrEqual(before.body.clientHeight + 2);

  /* ── ② 会话视口是那个**真有行程**的滚动容器 ────────────────────────────── */

  expect.soft(
    before.viewport.scrollHeight,
    "会话视口零行程 —— 它仍是滚动容器却没得滚,滚轮会被它咬住不往上传",
  ).toBeGreaterThan(before.viewport.clientHeight + 2);

  /* ── ③ 回复框在面板看得见的那块里(走查那天它在下面 6,982px) ──────────── */

  expect.soft(before.composer.bottom, "回复框被推到面板下边界外面").toBeLessThanOrEqual(before.panel.bottom + 2);
  expect.soft(before.composer.top, "回复框被推到面板上边界外面").toBeGreaterThanOrEqual(before.panel.top - 2);
  const pageViewport = page.viewportSize()!;
  expect.soft(before.composer.bottom, "回复框整个在浏览器可视区外面").toBeLessThanOrEqual(pageViewport.height + 2);

  /* ── ④ 打开就停在最新一句(autoScroll 活着) ────────────────────────────── */

  // 这一格要两条断言,因为单看「视口在不在自己的底」会**空转**:病在的时候视口零行程,
  // `scrollHeight - clientHeight - scrollTop` 恒等于 0,读起来永远「在底部」——而商家屏幕上
  // 那段回答根本不在。所以先断言商家真正在意的那件事:**最新那条消息的下缘落在面板里**。
  expect.soft(
    before.newestMessage.bottom,
    "最新那条消息的结尾不在面板里 —— 商家要自己滚下去才看得到刚付钱买的那段回答",
  ).toBeLessThanOrEqual(before.panel.bottom + 2);
  // 第二条读的是滚动位置本身。有了 ② 那条「真有行程」垫底,它才是一句有内容的话。
  expect.soft(
    distanceFromBottom(before),
    "会话视口没有停在自己的最底",
  ).toBeLessThanOrEqual(4);

  /* ── ⑤ 滚轮:往上滚得回去,再往下滚得回来(走查那天两个方向都死) ────────── */

  await wheelOverConversation(page, -600);
  const up = await measure(page);
  expect.soft(up.viewport.scrollTop, "滚轮往上一格都不动").toBeLessThan(before.viewport.scrollTop - 50);

  await wheelOverConversation(page, 2000);
  const down = await measure(page);
  expect.soft(down.viewport.scrollTop, "滚轮往下一格都不动").toBeGreaterThan(up.viewport.scrollTop + 50);

  /* ── ⑥ 展开视图是同一段 DOM,同样要成立(走查那天它一样死) ──────────────── */

  await page.getByRole("button", { name: "Expand Otto" }).click();
  // 前提,硬断言:展开这一下真的发生了。
  await expect(page.getByRole("button", { name: "Collapse Otto" })).toBeVisible();
  // 宽度有 200ms 过渡。等它连着两帧读出同一个宽度,而不是猜一个毫秒数。
  await waitUntilStable(async () => {
    const m = await measure(page);
    return m.panel.right - m.panel.left;
  });
  await waitUntil(async () => distanceFromBottom(await measure(page)) <= 4);

  const expanded = await measure(page);
  expect.soft(expanded.body.scrollHeight, "展开视图里面板体溢出了").toBeLessThanOrEqual(expanded.body.clientHeight + 2);
  expect.soft(expanded.composer.bottom, "展开视图里回复框在面板外面").toBeLessThanOrEqual(expanded.panel.bottom + 2);
  expect.soft(expanded.viewport.scrollHeight, "展开视图里会话视口零行程").toBeGreaterThan(expanded.viewport.clientHeight + 2);

  await wheelOverConversation(page, -600);
  const expandedUp = await measure(page);
  expect.soft(
    expandedUp.viewport.scrollTop,
    "展开视图里滚轮往上一格都不动 —— 商家读不回那段回答的开头",
  ).toBeLessThan(expanded.viewport.scrollTop - 50);
});
