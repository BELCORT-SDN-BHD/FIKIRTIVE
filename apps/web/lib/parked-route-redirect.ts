import { MERCHANT_NAV_REDIRECTS } from "@fikirtive/core/navigation";

/**
 * 停放旧地址的唯一答法 —— **一条真的 HTTP 307**,在渲染开始之前就答完(R3-F10)。
 *
 * ── 为什么不是 `page.tsx` 里的 `redirect()` ────────────────────────────────────────────────
 * 规格 `docs/specs/wave2-shell.md` §2.5 写的是「每一条旧地址都 **307**,永不 404」。
 * `redirect()` 只有在**外壳还没冲出去**的时候才兑现得了这句话:一旦这个 segment 头上有一层
 * `loading.tsx`(它就是一个 Suspense 边界),Next 会先把外壳连同骨架当成 **HTTP 200** 冲出去,
 * `redirect()` 就降级成一次客户端跳转 —— 地址栏先停在旧地址上闪一屏骨架,爬虫、`curl`、
 * 任何不跑 JS 的客户端拿到的是 200 而不是 307。
 *
 * 本机实测(`next build` + `next start`,`curl --max-redirs 0`,2026-09-15):
 *
 *   | 旧地址                | 头上有 loading.tsx 吗            | 答案(修前) |
 *   |----------------------|----------------------------------|-----------|
 *   | `/campaign`          | 有,但在**同一层**(见下)          | 307       |
 *   | `/campaign/calendar` | 同上                             | 307       |
 *   | `/crm`               | 没有                             | 307       |
 *   | `/schedule`          | `app/schedule/loading.tsx`       | **200**   |
 *   | `/schedule/analytics`| 同上(继承父层)                   | **200**   |
 *   | `/library/editor`    | `app/library/loading.tsx`        | **200**   |
 *
 * `/campaign` 之所以是 307,靠的是一个**文件摆放的巧合**:`loading.tsx` 圈住的是这一层的
 * children,而 `app/campaign/layout.tsx` 自己站在那个边界**外面**,所以它的 `redirect()` 抢在
 * 冲外壳之前。同机变异实证:把 `redirect()` 放进一个**子层**的 `layout.tsx`(头上仍有
 * `loading.tsx`)—— 照样 200。也就是说「放 layout 还是放 page」根本不是分水岭,「头上有没有
 * 边界」才是。
 *
 * ── 所以停放路由改用 Route Handler ────────────────────────────────────────────────────────
 * Route Handler 压根不进渲染:没有外壳、没有 Suspense、没有骨架,`loading.tsx` 摆在哪里都影响
 * 不到它。同机实测同一条路由改成 handler 之后:`307`,正文 **0 字节**。附带一件真实的好处 ——
 * 旧书签不再把整个 app shell(含 root layout 那次 `isImpersonating()` 会话读)渲染一遍再扔掉。
 *
 * ── 去处从权威表里读,不在路由文件里手打第二遍 ──────────────────────────────────────────
 * `MERCHANT_NAV_REDIRECTS` 那张表的契约逐字写在它自己的注释里:每一条 `from` 都必须有一个真的
 * route 文件把人送到 `to`。FRONT-A14 抓到过的正是两边各说一句话(表写 Home、文件跳 Schedule)。
 * 这里把 `to` 直接从表里取,那条缝就不再是「靠人记得同时改两处」——它在构造上不存在。
 *
 * 查不到那一行就抛:一条没有权威出处的重定向,比一次响亮的失败更糟。围栏
 * (`lib/__tests__/route-redirects.test.ts` 与 e2e journey 28)逐行核对表与文件,所以这一抛
 * 永远上不了线。
 *
 * `Location` 写成**相对路径**,与另外三条旧地址的 `redirect()` 吐出来的头一模一样
 * (`location: /`),也就不必猜代理后面的对外主机名。
 */
export function parkedRouteRedirect(from: string): Response {
  const row = MERCHANT_NAV_REDIRECTS.find((entry) => entry.from === from);
  if (!row) {
    throw new Error(
      `parkedRouteRedirect: "${from}" 不在 MERCHANT_NAV_REDIRECTS 里。停放旧地址的去处只有那一张表说了算 —— 先往表里加一行(带 why),再让路由文件读它。`,
    );
  }
  return new Response(null, { status: 307, headers: { Location: row.to } });
}

/**
 * 停放前缀底下**没建过**的那些地址 —— 同一条 307,去处仍然只由那张表说了算(R3-F11)。
 *
 * `parkedRouteRedirect` 答的是表里逐字写着的那几条地址。它答不了的是**它们底下那一片**:
 * `/crm/<没建过的段>`(书签被截断、外部链接多带一层、手打错一个字)在第三轮 staging 走查里
 * 撞的是 Next 自带的裸 404 —— 没有导轨、没有账号菜单、没有一条回去的路。规格
 * `docs/specs/wave2-shell.md` §2.2 写的是「`/crm` **及其全部子路由** → `/`」,§2.5 写的是
 * 「每一条旧地址都 307,永不 404」:那一片本来就在承诺里面。
 *
 * **最长匹配者独赢**,与导轨高亮同一条规则(`components/navigation/rail/rail-tree.ts` 的
 * `activeNavHref`)。这不是为了对称:`/schedule/analytics/<没建过的段>` 必须落到
 * `/analysis`(表里 `/schedule/analytics` 那一行),而不是落到 `/schedule` 那一行的 Home ——
 * 商家要找的是表现分析,不是总览。取第一条或取最短的那条都会把他送错门。
 *
 * 一个前缀都匹配不上就抛:catch-all 路由文件只摆在停放前缀底下,所以匹配不上意味着有人把
 * 文件搬到了表外的地方 —— 一条没有权威出处的重定向,比一次响亮的失败更糟。
 */
export function parkedSubpathRedirect(pathname: string): Response {
  const row = MERCHANT_NAV_REDIRECTS.filter(
    (entry) => pathname === entry.from || pathname.startsWith(`${entry.from}/`),
  ).reduce<(typeof MERCHANT_NAV_REDIRECTS)[number] | null>(
    (longest, entry) => (!longest || entry.from.length > longest.from.length ? entry : longest),
    null,
  );
  if (!row) {
    throw new Error(
      `parkedSubpathRedirect: "${pathname}" 不长在任何一条停放前缀底下。兜底路由只该摆在 MERCHANT_NAV_REDIRECTS 有的那几个前缀里 —— 先往表里加一行(带 why),再把 catch-all 摆进去。`,
    );
  }
  return parkedRouteRedirect(row.from);
}
