/**
 * Journey 29 —— 没建过的地址,商家照样有路可走(R3-F11)。
 *
 * 走查(第三轮 staging,2026-09-14)发现的洞:`/crm` 与它那十四条子路由都 307 回 Home,可是
 * `/crm/` 后面跟一个**没有路由文件**的段(旧书签的深链、外部链接被截断、手打错一个字)落进的是
 * Next 自带的裸 404 —— 页面标题只剩 `Fikirtive`,没有导轨、没有账号菜单、没有一条回去的路。
 * 商家在自己的产品里撞见一堵与产品无关的墙。
 *
 * 这条旅程按**两类**地址走,因为它们的正确答案不是同一个:
 *
 *   ① 停放前缀(`/crm`、`/campaign`、`/schedule`、`/library/editor`)底下的乱地址 —— 有去处,
 *      所以答一条真的 **307**,`Location` 逐字是权威表 `MERCHANT_NAV_REDIRECTS` 那一行的 `to`
 *      (规格 `docs/specs/wave2-shell.md` §2.2、§2.5:「每一条旧地址都 307,永不 404」)。
 *   ② 那四扇门之外的乱地址(`/definitely-not-a-route`)—— **没有**去处可送,它真的不存在,
 *      所以诚实的答案仍是 **404**;这一票要的是「这个 404 长在产品里面」:导轨在、有路回家。
 *
 * 为什么用 `page.request.get(..., { maxRedirects: 0 })` 而不是跟着跳完再看落点(与 journey 28
 * 同一个理由):规格那句话是一个**数字**。跟着跳完只证得了「最后落在对的地方」—— 上一版这四扇门
 * 里有两扇答的是 200 + `<meta http-equiv="refresh">`,跟完照样绿,而爬虫、链接检查器与任何不跑
 * JS 的客户端拿到的是 200。关掉重定向,状态行才读得出来。
 *
 * SIGNED IN,因为墙先答:没有会话时这些地址答的是 307 → `/login?from=…` —— 一个会让粗心的
 * 状态码检查通过、却什么都没证明的答案(journey 1 管墙外那一半)。
 *
 * WHAT IS REAL HERE. 真构建、真登录、真 proxy 鉴权墙、真 server 重定向:唯一的「假」是收件箱
 * (support/auth.ts 从库里读产品自己铸的码),与其余旅程同一口径。
 */
import { test, expect } from "@playwright/test";
import { MERCHANT_NAV_REDIRECTS, SHELL_ROUTES } from "../../packages/core/dist/navigation.js";
import { seedWorkspace } from "../support/seed.js";
import { signIn } from "../support/auth.js";
import { E2E_BASE_URL } from "../support/env.js";

/** 停放**前缀** = 权威表里不长在别人底下的那几条 `from`。`/campaign/calendar` 与
 *  `/schedule/analytics` 各自长在 `/campaign`、`/schedule` 底下,它们是叶子、不是门。 */
const PARKED_PREFIXES = MERCHANT_NAV_REDIRECTS.filter(
  (row) => !MERCHANT_NAV_REDIRECTS.some((other) => other.from !== row.from && row.from.startsWith(`${other.from}/`)),
);

/** 一段谁都没建过的路由:它不是打字错误的模拟,它就是打字错误本身。 */
const UNKNOWN_SEGMENT = "a-page-that-was-never-built";

/**
 * 两个深度都要走。一段与两段在这个仓库里不是同一件事:`/campaign/<一段>` 会被
 * `app/campaign/[id]/page.tsx` 认成一个 campaign id、于是照样吃到 `campaign/layout.tsx` 的
 * 重定向,而 `/campaign/<一段>/<一段>` 谁都不认。只测一段,会把「这扇门已经好了」当成结论。
 */
const UNKNOWN_DEPTHS = [UNKNOWN_SEGMENT, `${UNKNOWN_SEGMENT}/${UNKNOWN_SEGMENT}`];

test("R3-F11 — 停放前缀底下没建过的地址,答的是真的 307,去处逐字是权威表说的那一个", async ({
  page,
}) => {
  const ws = await seedWorkspace({
    slug: "parkeddeep",
    workspaceName: "Suri Bakes",
    personName: "Suri",
    openingGrant: 0,
  });
  await signIn(page, ws);

  // 围栏不空转:表里真的有停放前缀,这一圈不是零次循环。
  expect(PARKED_PREFIXES.map((row) => row.from)).toContain(SHELL_ROUTES.crm);

  for (const row of PARKED_PREFIXES) {
    for (const tail of UNKNOWN_DEPTHS) {
      const deepLink = `${row.from}/${tail}`;
      // `page.request` 带着这一页的 cookie jar,所以这些是**同一个商家**发出的请求。
      const res = await page.request.get(deepLink, { maxRedirects: 0 });

      expect(res.status(), `${deepLink} 没有答一条重定向(${row.why})`).toBe(307);
      expect(res.headers()["location"], `${deepLink} 落到了它自己那张表没说的地方`).toBe(row.to);

      // 正文 0 字节 = 兜底没有先把整个 app shell 渲染一遍再扔掉(R3-F10 那半个缺陷的量法)。
      //
      // 一个例外,而且它不是本票的:`/campaign/<一段>` 根本不由兜底答 —— 它被
      // `app/campaign/[id]/page.tsx` 认成一个 campaign id,由 `app/campaign/layout.tsx` 的
      // `redirect()` 送走。那仍是一条真 307(上面两条断言逐字量过),但走的是渲染那条路,
      // 所以带着正文回来。journey 28 里「三条已经 307 的旧地址仍先渲染一页」记的是同一件事,
      // 同样不在本票内。
      const answeredByCatchAll = !(row.from === SHELL_ROUTES.campaign && !tail.includes("/"));
      if (answeredByCatchAll) {
        expect((await res.body()).byteLength, `${deepLink} 先渲染了一页才跳`).toBe(0);
      }
    }
  }

  // 最长匹配者独赢:`/schedule/analytics` 在表里有自己的一行(去处 `/analysis`)。按「这扇门
  // 那一行」统一答,商家找表现分析会被送去总览。
  const analytics = await page.request.get(`${SHELL_ROUTES.analytics}/${UNKNOWN_SEGMENT}`, {
    maxRedirects: 0,
  });
  expect(analytics.status()).toBe(307);
  expect(analytics.headers()["location"], "表现分析底下的乱地址被送去了总览").toBe(
    SHELL_ROUTES.homeAnalysis,
  );
});

test("R3-F11 — 四扇门之外的乱地址诚实答 404,但商家仍站在自己的产品里", async ({ page }) => {
  const ws = await seedWorkspace({
    slug: "notfoundshell",
    workspaceName: "Kedai Kopi",
    personName: "Aina",
    openingGrant: 0,
  });
  await signIn(page, ws);

  const res = await page.goto("/definitely-not-a-route");

  // 这一条没有去处可送 —— 它真的不存在,所以 404 是实话。上面那四扇门才有去处。
  expect(res, "浏览器没有拿到任何响应").not.toBeNull();
  expect(res!.status(), "一条不存在的地址不该假装自己存在").toBe(404);

  // 这个洞真正的痛处:裸 404 上这两样都没有。
  await expect(
    page.getByRole("navigation", { name: "Global navigation" }),
    "404 上没有导轨",
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "FIKIRTIVE home" }), "404 上没有回家的路").toBeVisible();
  await expect(page.getByText("Page not found")).toBeVisible();

  // Next 自带的那堵墙一个字都不许出现。
  await expect(page.getByText("This page could not be found")).toHaveCount(0);

  // 那条回去的路是一条真链接,而且真的走得通 —— 画一颗按钮不等于按得动。
  //
  // 无障碍树上它是 `button`:`<Button asChild>` 走 Base UI 的 `render`,那一层给非原生按钮
  // 挂 `role="button"`(全仓既有写法,`app/campaign/error.tsx`、`app/admin/error.tsx` 同样)。
  // 底下仍是一个带 `href` 的 `<a>` —— 下一行逐字量它,所以「在新标签页打开」这种事仍然成立。
  const backHome = page.getByRole("button", { name: "Back to Home" });
  await expect(backHome, "回家那一下不是一条真链接").toHaveAttribute("href", SHELL_ROUTES.home);
  await backHome.click();
  await expect(page).toHaveURL(new URL(SHELL_ROUTES.home, E2E_BASE_URL).toString());
});

/**
 * 反面:不是「这个前缀底下什么都往 Home 送」。
 *
 * `/schedule/share-preview` 是免登录的公开分享页(B0-28),它长在 `/schedule` 底下却**不是**
 * 停放子树的一员 —— 静态段优先于 catch-all,是这条收口能同时成立的机制。没有这一条,
 * 上面那条旅程会鼓励下一个人用一条更宽的规则(layout 层统吃、或 proxy 里加前缀)去做同一件事,
 * 而那种做法会把这扇公开的门一起吃掉(那个文件的头注逐字写着「DO NOT add an
 * app/schedule/layout.tsx that gates its children」)。
 *
 * `request` 夹具是一个**全新**的、没有会话的上下文 —— 一封邮件里的链接被点开时就是这个状态。
 */
test("R3-F11 — 公开分享页不被停放前缀的兜底吃掉(它没有会话,也不该有壳)", async ({ request }) => {
  const res = await request.get(SHELL_ROUTES.publicSharePreview, { maxRedirects: 0 });

  expect(res.status(), "公开分享页应当自己答,而不是被送去 Home 或登录页").toBe(200);
  expect(await res.text(), "画了一层商家的壳给一个没有账号的读者").not.toContain(
    'aria-label="Global navigation"',
  );
});
