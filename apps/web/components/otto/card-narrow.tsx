/**
 * card-narrow.tsx —— 面板被拖到最窄(320px)时,卡片长什么样。三张卡共用的一份版式词汇表。
 *
 * 规格:`docs/specs/wave2-shell.md` §3.4「审批卡在面板内」;票 #996(W2-9)。
 *
 * ## 为什么是容器查询,不是视口断点
 *
 * 这些卡不住在页面里,住在一块**能拖宽窄**的面板里(§3.1:320px 到 min(720px, 50vw))。
 * 视口断点(`md:` / `lg:`)量的是浏览器窗口 —— 而窗口一动不动的时候,面板照样能被从
 * 520px 拖到 320px。用视口断点画这些卡,等于用一把量不到它的尺子。W2-10 给导轨立的
 * 「无断点前缀」纪律在这里是同一条:版式跟着**自己那只盒子**走,不跟着窗口走。
 *
 * 所以卡根上是 `@container`(`container-type: inline-size`),每一处版式切换写成一对
 * **互补**的容器变体:
 *
 *   `@max-[420px]:…`  →  `@container (width < 420px)`    窄版
 *   `@min-[420px]:…`  →  `@container (width >= 420px)`   宽版
 *
 * 两边严格互补(`< 420` 与 `>= 420` 之间没有缝、也没有重叠),所以任何容器宽度下**恰好
 * 一条**生效。这正是测试能对「320px 走哪一版、560px 走哪一版」做机器判定的原因:不必去
 * 解 CSS 层叠,只要按这两条区间把类名解算一遍就行(`lib/__tests__/otto-narrow-cards.test.ts`)。
 * 上面那两行编译结果不是记忆,是 2026-08-19 用本仓装着的 tailwindcss 4.3.0 实际编译出来的
 * —— 注意 `@max-[N]` 是**严格小于** N,所以两个变体必须写**同一个** 420,写成 419/420 会
 * 在 419px 上留一条谁都不生效的缝。
 *
 * ## 420 这个数从哪来
 *
 * 卡片外面是聊天区的 `p-4`(左右各 16px),所以卡容器宽度 ≈ 面板宽度 − 32px。面板最窄
 * 320px ⇒ 卡容器 ≈ 288px;那个宽度下一行里塞「图标 + 标题 + 价签 + 按钮 + 序号」只剩几十
 * px 给标题,必然截断。420px 是这一行还立得住的下限(≈ 面板 452px),再窄就换单列。
 *
 * 一条纪律:金额与 credits 数字**任何宽度下都不换行、不截断**,所以它们一律走 `CardMoney`
 * —— 那既是 `white-space: nowrap`,也是测试用来找到每一个金额并回溯它整条祖先链的把手。
 */
import * as React from "react";

/** 卡内版式的分界:容器宽度小于它走窄版,大于等于它走宽版。
 *  下面每一条类名里的 `420` 都必须是这个数(有断言钉着)。 */
export const CARD_NARROW_BREAKPOINT_PX = 420;

/** 卡根:建立容器上下文。三张卡的根都用它,否则底下的 `@max-/@min-` 一条都不会生效。 */
export const CARD_ROOT_CLASS = "gb leading-[1.5] @container";

/** 卡身内边距:窄版收一档,把宽度还给内容。 */
export const CARD_PAD_CLASS = "@max-[420px]:p-4 @min-[420px]:p-6";

/** 按钮组:宽版并排(放不下才换行),窄版直接一颗一行、拉满宽度。
 *  「按钮组换行」在窄版是结构性的,不靠量文字宽度,所以断言得住。 */
export const CARD_ACTIONS_CLASS =
  "flex gap-3 @max-[420px]:flex-col @max-[420px]:items-stretch @min-[420px]:flex-row @min-[420px]:flex-wrap @min-[420px]:items-center";

/** 一行里「一段话 + 一颗次要按钮」:宽版并排,窄版上下两行(按钮不拉满,它不是主动作)。 */
export const CARD_SPLIT_ROW_CLASS =
  "flex gap-3 @max-[420px]:flex-col @max-[420px]:items-start @min-[420px]:flex-row @min-[420px]:flex-wrap @min-[420px]:items-center";

/** 清单行(pack 里每一件):宽版一行摆完,窄版靠 `CARD_LIST_ROW_TRAIL_CLASS` 折成两行。 */
export const CARD_LIST_ROW_CLASS = "flex flex-wrap items-center gap-x-3 gap-y-2";

/** 清单行的尾段(状态 / 单件按钮 / 序号)。窄版 `w-full` ⇒ 必定另起一行,双列就此变单列。 */
export const CARD_LIST_ROW_TRAIL_CLASS =
  "flex shrink-0 items-center gap-3 @max-[420px]:w-full @max-[420px]:justify-end";

/** 金额本体的类。单独导出,好让别处引用同一份而不是再抄一次字面量。 */
export const CARD_MONEY_CLASS = "whitespace-nowrap";

/**
 * 一笔金额 / credits 数字。
 *
 * 它只做一件事:**不许这个数被断行或被省略号吃掉**。句子可以随便换行,数字不行 ——
 * 「22 cred…」比不显示更坏,商家是照着这个数决定要不要付钱的。
 *
 * `data-card-money` 不是测试专用的装饰:它是「这一段是金额」这个事实在 DOM 上的标记,
 * 测试据此找到每一个金额,再回溯它到卡根的整条祖先链,确认没有任何一层在截断它。
 */
export function CardMoney({ children }: { children: React.ReactNode }) {
  return (
    <span data-card-money="" className={CARD_MONEY_CLASS}>
      {children}
    </span>
  );
}
