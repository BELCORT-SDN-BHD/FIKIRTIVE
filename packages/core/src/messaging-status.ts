/**
 * 消息渠道现在到底是什么状态 —— **全仓唯一的说法**(#792 r2 判词 P1)。
 *
 * 为什么要有这个文件:同一个事实原来有三份说法,而且互相打架。
 *   · 导航(#792 r1)说「渠道还连不上」;
 *   · Otto 的指令与 `listChannelScopes` 技能描述却说「渠道列表为空就建议商家去连一个」——
 *     #541 早就裁过那是一条死路(Connections 里 Messaging 整段写着 Not available yet,
 *     产品里根本没有连接入口)。
 * 于是产品一边告诉商家「连不上」,一边让助手劝商家「去连」。这正是本仓的主根因:说的与
 * 做的失同步,而且是两个「说的」互相失同步。
 *
 * 所以这件事从此只有一处措辞,两个读者各取自己那一句 —— **不是两个事实,是一个事实的两种
 * 说法**。渠道真接通的那一天,改这一个文件,导轨徽章、预览页、Otto 指令与技能描述一起改口。
 *
 * 纯字符串、零依赖(浏览器端导轨与 Otto 指令都读得到)。
 */

/**
 * 「连不上渠道」这件事的**那一句**(r3 判词 P2-1)。
 *
 * 它原来住在 `apps/web/lib/crm-channel-connection.ts`,自称「产品里关于连接渠道的唯一一句」
 * (#727 立的)。#792 r2 又在这里立了第二份权威,于是同一个产品事实有了两个常量,预览页还
 * 一次把两句都渲染出来 —— 修漂移的那一单自己制造了一次漂移。r3 把它收编到这里:收件箱、
 * 模板页与预览页读的都是这一个常量,`crm-channel-connection.ts` 里那份已删。
 *
 * 措辞一字未改(那三个面上的字不动),换的只是它住在哪。
 */
export const MESSAGING_STATUS_CANNOT_CONNECT = "Messaging channels are not available to connect yet.";

/**
 * 商家读到的那一句(导轨 Preview 徽章的 title + Customers 预览页第一屏)。
 *
 * **两层实话**(r2 判词 P1):渠道连不上只是第一层。就算明天接上一个渠道也不够 —— 发送与
 * 接收本身在产品里也还没接线(收件箱的回复送出、模板送审、广播真发,三处都是永远失败的
 * chokepoint;广播与 Routine 的执行只有模拟分支)。只说渠道,等于把「还差很多」说成
 * 「只差一根线」。
 *
 * 第一句**拼**自上面那个常量,不是抄一遍 —— 两处措辞从此不可能各自漂移(r3 判词 P2-1)。
 */
export const MESSAGING_STATUS_MERCHANT =
  `${MESSAGING_STATUS_CANNOT_CONNECT} The sending and receiving paths are not wired up either — nothing in here can send a message to a customer or receive one from them. Keeping customer records is the part that works today.`;

/**
 * Otto 读到的那一句(系统指令 + `listChannelScopes` 技能描述)。
 *
 * 关键是最后半句:空的渠道列表**不是商家的待办**。旧措辞让 Otto 把一个产品侧的空白说成
 * 商家没做的事,商家照做就撞上一堵没有门的墙。
 *
 * 这里**不写地名**(#802):该指去哪儿由调用点用 `navPath()` / `navLabel()` 接上去 —— 地名
 * 手打一次,改名就漂一次,而这个文件够不着导航那棵树(navigation.ts 反过来 import 它)。
 */
export const MESSAGING_STATUS_ASSISTANT =
  "There is no way to connect a messaging channel in Fikirtive yet, and the sending and receiving paths are not wired up either. An empty channel list is therefore NOT a to-do for the merchant — never tell them to connect one. Say plainly that messaging is not available yet.";
