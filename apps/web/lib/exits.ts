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
 * W2-11:唯一的例外是 `@fikirtive/core/navigation` 这一条 import——`packages/core` 本身
 * 零 `"use client"`/`"use server"` 标记,不带任何边界,所以不破坏上面那条「哪里都能读」
 * 的承诺;换来的是 `BRAND_MEMORY_HREF` 不再手抄 Brand 那一段地址,而是从
 * `SHELL_ROUTES.brand` 推出来 —— 那一段改名,这里跟着改。
 *
 * (#786:这里原本写着 billing-actions 也读这个模块。它没有 —— 它只在自己的返回体上带一个
 *  `contactSupport` 标记,由 BuyPackButton 拿去换出口。注释与事实不符就是下一个假前提。)
 */
import { SHELL_ROUTES } from "@fikirtive/core/navigation";

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
 *  带着 `products` 一起走 —— 少了它,商家落在「About the brand」那一页,离那颗键还差一步。 */
export const BRAND_MEMORY_HREF = `${SHELL_ROUTES.brand}/records?tab=products`;

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
