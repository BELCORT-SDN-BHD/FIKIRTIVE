/**
 * Journey 29 —— 停放前缀下面的一条乱地址，商家照样有壳、有路回去（R3-F11）。
 *
 * 走查（第三轮 staging，2026-09-14）发现的洞：`/crm` 与它那十四条子路由都 307 回 Home，可是
 * `/crm/` 后面跟一个**没有路由文件**的段（旧书签的深链、外部链接被截断、手打错一个字）落进的是
 * Next 自带的裸 404 —— 页面标题只剩 `Fikirtive`，没有导轨、没有账号菜单、没有一条回去的路。
 * 商家在自己的产品里撞见一堵与产品无关的墙。同一个洞在 `/campaign`、`/schedule`、
 * `/library/editor` 底下一模一样，所以这条旅程按**权威表**逐扇门走，不是只走 CRM 一扇。
 *
 * 判据出自两份权威，不是这条旅程自己发明的：
 *   · `docs/specs/wave2-shell.md` §2.2「`/crm` 及其全部子路由 → `/`，全部 307 到 Home」与
 *     §2.5「每一条旧地址都 307，永不 404（`MERCHANT_NAV_REDIRECTS` 的老纪律照旧）」；
 *   · `apps/web/design-system/information-architecture/frontend-convergence-phase-1-spec.md`
 *     §4「Compatibility destinations」第 1 条与验收 7：进入 Parked merchant surface 由
 *     server-side destination 送到冻结 owner surface，**不显示 404**。
 *
 * 去处从权威表 `MERCHANT_NAV_REDIRECTS` 读，不在这里手抄第二份：改表就必须改路由文件，
 * 否则这条旅程红。
 *
 * 一扇门一条 test（不是一条 test 走四扇），理由与这套件其余旅程一致：一扇门坏了，其余三扇的
 * 答案照样要读得到，而每一条旅程自己的商家、自己的会话、自己的时间预算最不容易互相牵连。
 *
 * WHAT IS REAL HERE. 真构建、真登录、真 proxy 鉴权墙、真 server redirect：这条旅程唯一的
 * 「假」是收件箱（support/auth.ts 从库里读产品自己铸的码），与其余旅程同一口径。
 */
import { test, expect } from "@playwright/test";
import { MERCHANT_NAV_REDIRECTS } from "../../packages/core/dist/navigation.js";
import { seedWorkspace } from "../support/seed.js";
import { signIn } from "../support/auth.js";
import { E2E_BASE_URL } from "../support/env.js";

/** 停放前缀 = 权威表里不长在别人底下的那几条 `from`。`/campaign/calendar` 与
 *  `/schedule/analytics` 各自长在 `/campaign`、`/schedule` 底下，它们是叶子不是门。 */
const PARKED_PREFIXES = MERCHANT_NAV_REDIRECTS.filter(
  (row) => !MERCHANT_NAV_REDIRECTS.some((other) => other.from !== row.from && row.from.startsWith(`${other.from}/`)),
);

/** 一段谁都没建过的路由：它不是打字错误的模拟，它就是打字错误本身。 */
const UNKNOWN_SEGMENT = "a-page-that-was-never-built";

/**
 * 两个深度都要走。一段与两段在这个仓库里不是同一件事：`/campaign/<一段>` 会被
 * `app/campaign/[id]/page.tsx` 认成一个 campaign id、于是照样吃到 `campaign/layout.tsx` 的
 * 重定向，而 `/campaign/<一段>/<一段>` 谁都不认。只测一段，会把「这扇门已经好了」当成结论。
 */
const UNKNOWN_DEPTHS = [UNKNOWN_SEGMENT, `${UNKNOWN_SEGMENT}/${UNKNOWN_SEGMENT}`];

/**
 * 十秒，逐条写出来而不是吃默认的十五秒：真到得了的话这是一秒内的事
 * （`/crm`、`/campaign` 底下是干净的服务端 307；`/schedule` 与 `/library/editor` 底下先答 200
 * 再靠 `<meta http-equiv="refresh" content="1;url=…">` 走完最后一步 —— 那是它们各自的
 * `loading.tsx` 把 Suspense 边界先冲出去造成的，两条**已经在主干上**的停放页今天就是这么答的，
 * 与本次收口无关）。等更久只会让一条红拖着不说话。
 */
const LANDING_TIMEOUT = 10_000;

test("R3-F11 — 权威表里真的有停放前缀（围栏不空转）", () => {
  expect(PARKED_PREFIXES.map((row) => row.from)).toContain("/crm");
});

for (const row of PARKED_PREFIXES) {
  const slug = `parked${row.from.replace(/[^a-z0-9]/g, "")}`;

  test(`R3-F11 — ${row.from}/<没建过的段> 落回 ${row.to}，并且带着导航壳`, async ({ page }) => {
    const ws = await seedWorkspace({
      slug,
      workspaceName: "Suri Bakes",
      personName: "Suri",
      openingGrant: 40,
    });

    await signIn(page, ws, "/");

    for (const tail of UNKNOWN_DEPTHS) {
      const deepLink = `${row.from}/${tail}`;
      const res = await page.goto(deepLink);

      // ① 规格那句话最直白的形态：这一趟不许以 404 收场（307 之后跟到的那一页也算数）。
      expect(res?.status(), `${deepLink} 答了一个 404`).not.toBe(404);

      // ② 落点逐字是权威表说的那一个 —— 不是别人家的门。
      await expect(page, `${deepLink} 没有落到 ${row.to}`).toHaveURL(
        new URL(row.to, E2E_BASE_URL).toString(),
        { timeout: LANDING_TIMEOUT },
      );

      // ③ 落地之后壳在：导轨与它的 home 链接都画出来了。这一条是这个洞真正的痛处 ——
      //    裸 404 的那一页上这两样都没有。
      await expect(
        page.getByRole("navigation", { name: "Global navigation" }),
        `${deepLink} 落地之后没有导轨`,
      ).toBeVisible({ timeout: LANDING_TIMEOUT });
      await expect(
        page.getByRole("link", { name: "FIKIRTIVE home" }),
        `${deepLink} 落地之后没有回家的路`,
      ).toBeVisible({ timeout: LANDING_TIMEOUT });

      // ④ Next 自带的那堵墙一个字都不许出现。
      await expect(
        page.getByText("This page could not be found"),
        `${deepLink} 撞上了 Next 自带的 404`,
      ).toHaveCount(0);
    }
  });
}

/**
 * 反面：不是「这个前缀底下什么都往 Home 送」。
 *
 * `/schedule/share-preview` 是免登录的公开分享页（B0-28），它长在 `/schedule` 底下却**不是**
 * 停放子树的一员 —— 静态段优先于 catch-all，是这条收口能同时成立的机制。没有这一条，
 * 上面那几条旅程会鼓励下一个人用一条更宽的规则（layout 层统吃、或 proxy 里加前缀）去做同一件事，
 * 而那种做法会把这扇公开的门一起吃掉（那个文件的头注逐字写着「DO NOT add an
 * app/schedule/layout.tsx that gates its children」）。
 */
test("R3-F11 — 公开分享页不被停放前缀的兜底吃掉（它没有会话，也不该有壳）", async ({ page }) => {
  const res = await page.goto("/schedule/share-preview");

  expect(res?.status(), "公开分享页应当自己答，而不是被送去 Home 或登录页").toBe(200);
  await expect(page).toHaveURL(new URL("/schedule/share-preview", E2E_BASE_URL).toString());
  await expect(page.getByRole("navigation", { name: "Global navigation" })).toHaveCount(0);
});
