/**
 * exits — 产品里每一句「下一步去哪」真正指向的地方。
 *
 * 根因(#686 #687 #701 #707 是同一个病的四个样本):产品会告诉商家下一步做什么 ——
 * 「Contact us」「top up in Billing」「add one in Brand memory」—— 然后把它写成一段
 * 不能点的文字。商家读到了指路,却得自己找路;`not_configured` 那一处更硬:代码
 * 自己判定重试没用,唯一出路就是联系我们,而这条路在产品里根本不存在。
 *
 * 答案产品早就有,只是散落在各处:删号确认框跳的就是 mailto:tao@belcort.com,
 * 侧栏里就挂着 /billing,产品编辑器就在 `/brand/records`。所以这里不发明新去处,
 * 只是把已有的三个去处收成一处 —— 谁要指路,只能从这里取地址。
 *
 * 纯常量 + 纯函数,不含 JSX —— 所以服务端组件(法务页)、客户端组件(Settings、Otto 各卡)
 * 和纯模块都能读同一份,不受 `"use client"` / `"use server"` 边界限制。渲染成可点元素的
 * 那一层在 components/exits/Exits.tsx。
 *
 * W2-11:唯一的例外是几条 `@fikirtive/core` 的**叶子子路径** import(`navigation` 与
 * `memory-sections`)——`packages/core` 本身零 `"use client"`/`"use server"` 标记,不带任何
 * 边界,所以不破坏上面那条「哪里都能读」的承诺;走子路径而不是总 barrel,是因为 barrel 会把
 * Node-only 的东西拖进客户端图(围栏 `lib/__tests__/client-core-imports.test.ts`)。
 * 换来的是 Brand 那几个地址一格都不用手抄:地址段从 `SHELL_ROUTES.brand` 推,页签从
 * 五节 → 六节的全表推 —— 上游改名,这里跟着改。
 *
 * (#786:这里原本写着 billing-actions 也读这个模块。它没有 —— 它只在自己的返回体上带一个
 *  `contactSupport` 标记,由 BuyPackButton 拿去换出口。注释与事实不符就是下一个假前提。)
 */
import {
  BRAND_SECTION_TO_LEGACY_SECTION,
  FACT_SECTION_KEYS,
  type BrandSectionKey,
  type SectionKey,
} from "@fikirtive/core/memory-sections";
import { SHELL_ROUTES } from "@fikirtive/core/navigation";

/** 记录编辑器里那颗「Add product」所在的页签。写成常量,是因为下面两处都要它。 */
const PRODUCTS_TAB: SectionKey = "products";

/** 唯一的人工出口。历来就是这个地址(隐私页、条款页、删号确认框都用它)。 */
export const SUPPORT_EMAIL = "tao@belcort.com";

/** 一条真的能点开邮件的路。subject 直接说清商家为什么写信,省掉一轮来回。 */
export function supportMailto(subject: string): string {
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`;
}

/** 充值页 —— 全局导航侧栏「Billing」指的就是这里。 */
export const BILLING_HREF = "/billing";

/** 产品的编辑器 —— 商家读到的「去加个产品」全部指这里。
 *
 *  R3-F20:这一行原本写 `SHELL_ROUTES.brand`(`/brand`),注释还说「+ Add product」在那个
 *  视图里。两句都不成立:`/brand` 今天是设计的五节工作台(`app/brand/BrandWorkspace.tsx`),
 *  上面一颗产品控件都没有 —— 指路指到了上一层楼,商家到了之后照样得自己找。
 *
 *  真有那颗键的是 `/brand/records` 的 Products 页签:`components/otto/memory/ProductShowcase.tsx`
 *  的工具条与空态各一颗「Add product」。页签由 `?tab=` 决定(`components/otto/OttoMemory.tsx`
 *  读 `useSearchParams`,值域 = `@fikirtive/core/memory-sections` 的 `SECTIONS`),所以地址
 *  带着 `products` 一起走 —— 少了它,商家落在「About the brand」那一页,离那颗键还差一步。
 *
 *  这一条是**不带出处的**产品入口(Library 空态、旧壳那两处死件用它)。从 Brand 五节里
 *  指过去的那一行改用 `brandRecordsHref(section)` —— 理由见那个函数。 */
export const BRAND_MEMORY_HREF = brandRecordsHref();

/**
 * 从 Brand 某一节指向记录编辑器时,落在**这一节说的那类记录**上。
 *
 * 判官 P2-1:页顶那一行说的是「Products, offers and audiences are edited on their own page」,
 * 五节都画之后,站在 Audiences 上点它却落在「Your products」—— 读到的是客群,到手的是产品。
 *
 * 对应关系不在这里手写第二份:记录编辑器的六个页签就是 `SECTIONS`,而五节 → 六节的全表是
 * `BRAND_SECTION_TO_LEGACY_SECTION`(Founder 2026-09-03 裁决三＋十一,`packages/core`)。
 * 剩下的一步是「这一节映到的那个页签上有没有结构化记录」:`FACT_SECTION_KEYS` 就是那条判据的
 * 单一源(about / look / rules 三个页签只收自由文本事实,客群 / 产品 / 优惠才收记录)。映到
 * 事实页签的三节(Brand voice / Style guide / Visual guidelines)没有自己那类记录可落,
 * 落回产品 —— 那是这一行存在的原因(R3-F20:指路必须落在真有「Add product」的那一屏)。
 *
 * 不传 section = 不带出处的产品入口(`BRAND_MEMORY_HREF`)。
 */
export function brandRecordsHref(section?: BrandSectionKey): string {
  const legacy = section ? BRAND_SECTION_TO_LEGACY_SECTION[section] : PRODUCTS_TAB;
  const carriesRecords = !(FACT_SECTION_KEYS as readonly string[]).includes(legacy);
  return `${SHELL_ROUTES.brand}/records?tab=${carriesRecords ? legacy : PRODUCTS_TAB}`;
}

/** 没有可售积分包时,商家读到的那一句(#687)。
 *
 *  两个账务页曾经对同一个状态说两句话(/billing 说 "No credit packs **are**
 *  available right now."、Settings 说 "No credit packs available right now."),
 *  都到此为止。收成一句之后,两处再也不可能各自漂移。
 *
 *  刻意不说「什么时候恢复」:货架空了可能是 Stripe 没配、密钥失效、或者包全下架,
 *  产品自己并不知道哪一种,更不知道多久 —— 说了就是承诺一件不知道的事。能给的只有
 *  「找得到人」,那条出口由调用方接上 supportMailto。 */
export const NO_CREDIT_PACKS_MESSAGE = "No credit packs are available right now.";

/** 没能读到积分包目录时,商家读到的那一句(#786)。
 *
 *  上面那一句的孪生兄弟,所以住在同一处:两个账务页对同一个状态必须说同一句话。
 *
 *  这一句**没有**人工出口,是刻意的 —— 目录读失败是一个可重试的状态,而这一层的围栏是
 *  「可重试的错误不挂人工出口」(#686 起就是这条,createTopupCheckout 里唯一带
 *  `contactSupport` 的那一支正是它的反面)。给的下一步是刷新,与同页「余额读不到」
 *  「花费记录读不到」两句用的是同一个动作。 */
export const CREDIT_PACKS_UNREADABLE_MESSAGE = "Could not load the credit packs. Please refresh.";
