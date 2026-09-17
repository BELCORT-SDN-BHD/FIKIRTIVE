/**
 * Journey 30 —— 顾客点开商家发来的那条分享链接，第一跳与第二跳（R3-F31／R3-F32）。
 *
 * 第三轮 staging 只读核证（2026-09-17，构建 c0d25917）用匿名 curl 逮到两件事，两件都只在**一台
 * 真服务器**上看得见，仓内任何单元围栏都证不到：
 *
 *   R3-F31  `GET /s/<token>` 答 `303`，`location: https://localhost:8080/schedule/share-preview`。
 *           路由当时用 `req.nextUrl.origin` 拼绝对地址，而 Railway 的容器里那个 origin 就是进程
 *           自己监听的 localhost —— 顾客照着跳，落在他自己的电脑上。
 *   R3-F32  `GET /schedule/share-preview?t=<token>` 答 `200`（约 25 KB）：一段
 *           `<meta id="__next-page-redirect" http-equiv="refresh">` 加一屏已经冲出去的外壳
 *           （负载里带着 `href="/login"` 的「Go to sign in」）。token 于是在地址栏上停约一秒，
 *           而且那一秒里，一张自述「no sign-in, no link back into the workspace」的页面
 *           （`apps/web/app/schedule/share-preview/page.tsx`）先闪了一下登录面的东西。
 *
 * 为什么必须是 e2e，而不是再加一条单元围栏（与 journey 28 同一个理由，那份文件里写全了）：
 * 单元测试至多证得了「路由文件调用了 redirect()」。顾客的浏览器、爬虫、链接检查器、`curl` 真正
 * 收到的是 30x 还是 200，取决于 Next 有没有在冲外壳之前把重定向答完 —— 那是一台真服务器才有的
 * 事实。所以这里 `maxRedirects: 0`，读状态行、读 `Location`、读正文长度。
 *
 * ANONYMOUS：用 `request` 这个全新的、没有会话的上下文 —— 一条邮件里的链接抵达时就是这个状态。
 * 不需要 seed：两跳都在任何数据库读之前答完，token 是伪造的也一样（验不验得过是
 * `loadSharePreview` 的事，不是这两跳的事）。
 */
import { test, expect } from "@playwright/test";
import { SHELL_ROUTES } from "../../packages/core/dist/navigation.js";

/** 一个伪造但**形状真**的 token：`<base64url>.<base64url>`（packages/token-crypto）。 */
const FORGED_TOKEN = "eyJvIjoiZTJlIiwicCI6ImUyZSJ9.bm90LWEtcmVhbC1zaWduYXR1cmU";

test("R3-F31 —— `/s/<token>` 的 Location 是相对路径，容器自己的主机名一个字都不进去", async ({
  request,
}) => {
  const res = await request.get(`/s/${FORGED_TOKEN}`, { maxRedirects: 0 });

  expect(res.status(), "干净入口不再是一条真重定向").toBe(303);

  const location = res.headers()["location"];
  expect(location, "Location 里出现了主机名 —— 代理后面那就是容器自己的 localhost").toBe(
    SHELL_ROUTES.publicSharePreview,
  );
  expect(location).not.toContain("localhost");
  expect(location).not.toContain("://");

  // token 进了 HttpOnly cookie（SHARE-A6 的搬家）。这一条在这里才证得了：web 的单元测试把
  // `next/server` 换成了桩件，所以「手搓的这个响应到底还带不带 Set-Cookie」只有真服务器知道。
  const setCookie = res
    .headersArray()
    .filter((h) => h.name.toLowerCase() === "set-cookie")
    .map((h) => h.value)
    .join("\n");
  expect(setCookie, "相对 Location 改对了，cookie 却丢了 —— 顾客会落在一张空预览页上").toContain(
    FORGED_TOKEN,
  );
  expect(setCookie.toLowerCase()).toContain("httponly");
});

test("R3-F32 —— 旧式 `?t=` 链接答一条真的重定向，正文里没有外壳、没有登录面", async ({ request }) => {
  const res = await request.get(`${SHELL_ROUTES.publicSharePreview}?t=${FORGED_TOKEN}`, {
    maxRedirects: 0,
  });

  expect(
    res.status(),
    "旧链接又回到 200 + meta refresh 那条路上 —— token 会在地址栏上停一秒",
  ).toBe(307);
  // Next 会把源地址的查询串透传给去处（本机实测），所以比的是路径部分：第一跳落在同一扇门上。
  expect((res.headers()["location"] ?? "").split("?")[0]).toBe(`/s/${FORGED_TOKEN}`);

  const body = await res.text();
  expect(body, "还在冲外壳 —— 那正是 meta refresh 的来源").not.toContain("__next-page-redirect");
  expect(body, "免登录预览页的路上不许出现任何指回登录的东西").not.toContain("/login");
  expect(body.length, "一条路由层重定向不该带一屏页面回去").toBeLessThan(200);
});

test("R3-F32 —— 干净地址照旧是那张页面（这条重定向只收 `?t=`）", async ({ request }) => {
  const res = await request.get(SHELL_ROUTES.publicSharePreview, { maxRedirects: 0 });

  expect(res.status(), "把免登录预览页本身也重定向掉了").toBe(200);
  // 没有 cookie，所以画的是那张唯一的拒绝牌 —— 仍然是分享页在答，不是墙、不是停放重定向。
  expect(await res.text()).toContain("The link may have expired");
});
