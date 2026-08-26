/**
 * Help 这扇门的 beta 总闸(Founder 2026-08-27 批,beta 卫生终闸收官清扫①)。**默认关。**
 *
 * 病灶不是「Help 页丑」,是这一面**全是样张**:三篇文章是写死的样本,详情页自己写着
 * "This is a sample article for this preview.";其中两篇还在教商家用 beta 期根本进不去的
 * 门(一篇讲发布前的审阅,一篇讲重新连接发布渠道);页脚第三条出口又是 Settings 里一个
 * 被闸起来的节的第二个地址。一整面帮助里没有一句在回答 beta 商家真会问的问题,而它顶上
 * 写着 "How can we help?" —— 那是这个产品里最不该骗人的一句话。
 *
 * beta V1 只卖创作,而创作线上真正的帮助渠道是 Otto 与人:Otto 在每扇门里都在,
 * `SUPPORT_EMAIL` 那条邮件出口一直是真的。所以 beta 期这扇门整个收起来,商家读到的是
 * 一句实话加两条真出口,而不是一柜子样章。
 *
 * **只藏,不删**,照 `BETA_HIDDEN_NAV_KEYS` / `BETA_SETTINGS_SECTIONS` 的先例:
 *   · `R22HelpView` 那一整面(搜索、文章、支持请求六态、邮件出口)一行没删;
 *   · `/help` 那条路由照常在,直接输地址不 404 —— 落到 `R22HelpClosed` 那句实话上;
 *   · `SHELL_ROUTES.help` 与 `packages/core` 的导航权威一格没动。
 * 收窄只发生在三处壳层:Help 抽屉里那条「Help and support」、Otto 回话卡上那颗
 * 「Get support」、以及 `/help` 自己的落地。
 *
 * **显式开关**:`?help=all` 把整面原样放回来(后端线接真文章、或 beta 之后要验这一面时,
 * 不用改一行代码)。
 */
export const BETA_HELP_DOOR = false;

/** `?help=all` —— 与 Settings 的 `?sections=all` 同一种形状,读法也一样。 */
export const BETA_HELP_GATE_PARAM = "help";
export const BETA_HELP_GATE_OPEN_VALUE = "all";

/** 这一次请求有没有把闸开回来。参数长成 `string | string[] | undefined`(Next 的 searchParams)。 */
export function isHelpGateOpen(value: string | string[] | undefined): boolean {
  return (Array.isArray(value) ? value[0] : value) === BETA_HELP_GATE_OPEN_VALUE;
}

/** Help 这扇门现在开不开着 —— 三处壳层读的是同一个答案,谁都不用手抄第二份条件。 */
export function helpDoorOpen(value?: string | string[] | undefined): boolean {
  return BETA_HELP_DOOR || isHelpGateOpen(value);
}
