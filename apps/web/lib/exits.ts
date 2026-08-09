/**
 * exits — 产品里每一句「下一步去哪」真正指向的地方。
 *
 * 根因(#686 #687 #701 #707 是同一个病的四个样本):产品会告诉商家下一步做什么 ——
 * 「Contact us」「top up in Billing」「add one in Brand memory」—— 然后把它写成一段
 * 不能点的文字。商家读到了指路,却得自己找路;`not_configured` 那一处更硬:代码
 * 自己判定重试没用,唯一出路就是联系我们,而这条路在产品里根本不存在。
 *
 * 答案产品早就有,只是散落在各处:删号确认框跳的就是 mailto:tao@belcort.com,
 * 侧栏里就挂着 /billing,Brand memory 就是 /otto?view=memory。所以这里不发明新去处,
 * 只是把已有的三个去处收成一处 —— 谁要指路,只能从这里取地址。
 *
 * 纯常量 + 纯函数,不含 JSX,也不 import 任何东西 —— 所以服务端组件(法务页)、客户端
 * 组件(Settings、Otto 各卡)和纯模块都能读同一份,不受 `"use client"` / `"use server"`
 * 边界限制。渲染成可点元素的那一层在 components/exits/Exits.tsx。
 *
 * (#786:这里原本写着 billing-actions 也读这个模块。它没有 —— 它只在自己的返回体上带一个
 *  `contactSupport` 标记,由 BuyPackButton 拿去换出口。注释与事实不符就是下一个假前提。)
 */

/** 唯一的人工出口。历来就是这个地址(隐私页、条款页、删号确认框都用它)。 */
export const SUPPORT_EMAIL = "tao@belcort.com";

/** 一条真的能点开邮件的路。subject 直接说清商家为什么写信,省掉一轮来回。 */
export function supportMailto(subject: string): string {
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`;
}

/** 充值页 —— 全局导航侧栏「Billing」指的就是这里。 */
export const BILLING_HREF = "/billing";

/** Brand memory —— 「Your products」下的「+ Add product」在这个视图里。 */
export const BRAND_MEMORY_HREF = "/otto?view=memory";

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
