/**
 * ConversationCostHint —— 商家在**送出之前**读到的那一条:这一轮对话本身要钱。
 *
 * 规格:`docs/specs/otto-engine.md` §7.4(两级「先披露、后执行」的**第一级**)与 §7.6 处置一
 * (ENGINE-A3 第⑦段;Founder 未另裁 ⇒ 按推荐的处置一落地)。
 *
 * 为什么非有不可。⑦段把画布上最便宜的一条出图路径撤了:从前一张 lite 图 = 1 显示 credit
 * (`packages/core/src/spend.ts` 的公式价),按一下工具条上的 Generate 就出;从今天起同一张图
 * 必须先经过至少一轮 Otto 对话,而**一轮对话本身按用量计费**(供应商成本 ×
 * `OTTO_CONVERSATION_TURN_MARGIN`)。§7.6 把这件事记成本稿的真风险:ENGINE-A3 的验收只判
 * 「得到对话回复、花钱动作仍走卡片」,钱那边的验收判「报价与扣款同源」,**两边都绿,商家的
 * 账单照涨**。处置一(推荐,已落地)= 接受这个涨价,并且**把它摆到台面上**:输入框下面常驻
 * 一句人话,说清楚 Otto 会先跟你确认、而这轮对话自己也要钱。
 *
 * 挂载位置与既有的两条(`UnderstandingCostHint` 上传理解、`SearchCostHint` 网页搜索)**同一处**
 * —— composer 上方那一叠,商家一眼读完这个输入框会花的每一种钱。
 *
 * **数值禁字面量.** 这里一个数字都不写:唯一的数来自 `CHAT_HOLD_NOTE`,而它自己是从
 * `OTTO_CONVERSATION_TURN_RESERVE_INTERNAL` 现算的(`lib/credit-format.ts`)。手打一个「4」
 * 会在下一次调预扣上限时**悄悄**变成假话。
 *
 * 这一句与 `CHAT_SPEND_NOTE`（Billing 那条口径）不冲突也不重复:那一条说「聊天按用量计费,
 * 明细在 Billing」,这一条说的是**顺序** —— 先确认,才出图;而确认之前的那段对话已经在计费。
 * 两句都不带量级承诺(`CHAT_SPEND_NOTE` 的注释里有它三次改稿的教训)。
 */
import { CHAT_HOLD_NOTE, CHAT_SPEND_NOTE } from "@/lib/credit-format";

/**
 * 处置一那句话。前半句是**承诺**(花钱之前一定先问),后半句是**代价**(问的这一程本身按
 * 用量计费),中间那个破折号是它们的关系 —— 少了后半句就是 §7.6 点名的那种「两边都绿、
 * 账单照涨」。
 */
export const CONVERSATION_COST_HINT =
  `Otto checks with you on a card before it makes anything — and the conversation itself is ` +
  `charged for what it uses. ${CHAT_HOLD_NOTE}`;

/** 悬停时那一句:钱去哪里查。与 Billing 的口径同一份字符串,不是第二份抄件。 */
export const CONVERSATION_COST_HINT_TITLE = CHAT_SPEND_NOTE;

/** 与同一叠里的另外两条(`UnderstandingCostHint` / `SearchCostHint`)同一副长相。 */
export function ConversationCostHint() {
  return (
    <span className="text-[0.75rem] text-muted-foreground" title={CONVERSATION_COST_HINT_TITLE}>
      {CONVERSATION_COST_HINT}
    </span>
  );
}

export default ConversationCostHint;
