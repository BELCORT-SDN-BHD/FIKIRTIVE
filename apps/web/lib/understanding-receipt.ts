/**
 * understanding-receipt —— 一件上传素材的**自动理解回执**,商家读得到的那一行。
 *
 * Founder 2026-09-16 裁决(规格 `docs/specs/money-engine.md` §5 2026-09-16 变更登记):
 * 输入附近的常驻价目说明不回来(R3-F06 原样有效),但商家传上来的那件素材被自动读过之后,
 * **那件素材自己身上要留一行回执**,例如 "Understood · 0.1 credits"。理由是「有迹可循」:
 * 理解是商家从没按过的一颗按钮,扣的却是真钱 —— 事前不再拿一段小字堵在输入框下,事后就必须
 * 在发生的地方说一句。
 *
 * 这个文件只回答「该说哪一句」,一个字面量价钱都不带:
 *   · 数字由调用方从**账本折出来的已结算净额**传进来(`loadUploadUnderstandingCredits`,
 *     `lib/canvas-lineage-data.ts`),与 Billing 价目区同一条来源链(`pricedUnderstandingCredits`
 *     写快照 → worker 按快照 settle → 账本)。这里不调价目函数、也不现算,回执说的必须是
 *     **真的被扣的那一笔**,不是今天的牌价(MONEY-A7:调价不追溯)。
 *   · 措辞与单位走 `creditsLabel`,与余额、报价卡、消费历史同一套钱话。
 *
 * 三态,每一态都有它不许说的话:
 *   · **还没定论**(`pending`)—— 一个金额都不许出现:理解行已经建下但还没结算的那几十秒里
 *     说任何数字都是猜(FSE-203 的病根);说的是调用方传进来的权威中间态文案。
 *   · **已结算且真的扣了钱** —— 回执成立,说清楚「读过了」和「扣了多少」。
 *   · **已到终态但净额为 0** —— 没有回执可说:要么那一笔失败/被退款(账本 RESERVE+REFUND
 *     净额恒 0,与消费历史「Held, then refunded in full」同一个口径),要么扫描器此刻根本
 *     捞不到这件素材 —— **不是**因为它来路特殊(裁剪存下的新素材照样落 `source:"UPLOAD"`,
 *     `lib/asset-actions.ts:299/:323`,与任何上传同一张白名单),而是因为它的**元数据还没
 *     补齐**:图要宽高、视频要时长(`apps/worker/src/jobs/understand.ts` 的
 *     `METADATA_READY_FOR_UNDERSTANDING`),而宽高由 ingest 的 ffprobe 事后写。所以这个 0
 *     可能是「这辈子不会被读」(ffprobe 始终失败、或超过 24 小时补投窗),也可能只是「还没
 *     轮到它」—— 两者今天在数据上长得一样,这一格据此不作任何承诺。
 *     既不编一句「Understood · 0 credits」,也不留一行空回执 —— 调用方据此整行不渲染,
 *     与详情面其余几块回执同一条纪律(有则显示、无则整行不出现)。
 */

import { creditsLabel } from "./credit-format";

/** 回执要的三件事实,全部由调用方从已经读好的账本 / 理解行折出来。 */
export type UnderstandingCostFacts = {
  /** 这件素材上那些理解任务**已结算**的净扣费(显示 credits)。0 = 没扣到钱。 */
  creditsCharged: number;
  /** 至少还有一行理解没到终态(或还没建行但迟早会被扫描器捞走)⇒ 金额尚无定论。 */
  pending: boolean;
  /**
   * `pending` 为真时该说的那一句。服务端取好整句传进来(`UNDERSTANDING_WAITING_FOR_CREDITS` /
   * `UNDERSTANDING_PROVIDER_PAUSED`,权威在 `@fikirtive/core`)—— 这个模块被
   * `"use client"` 组件读,不能碰 Node 版总入口(`__tests__/client-core-imports.test.ts` 围栏)。
   * 省略 = 用下面那句默认的「还在读」。
   */
  pendingCopy?: string | undefined;
};

/** 回执那一行的措辞与形状,三态各一种。`none` 没有 `line` —— 没有回执就是没有回执。 */
export type UnderstandingReceipt =
  | { state: "pending"; line: string }
  | { state: "charged"; line: string; amount: string }
  | { state: "none" };

/** 回执那一个词。两处界面共用同一个字,不各写各的。 */
export const UNDERSTOOD_LABEL = "Understood";

/**
 * QUEUED / RUNNING 的默认中间态句 —— 这一句本来就不是 `@fikirtive/core` 的权威文案
 * (那两句是 PAUSED_BALANCE / PAUSED 专用的),所以它的单一来源在这里。
 */
export const UNDERSTANDING_PENDING_FALLBACK = "still reading this file — price settles shortly";

/** 这件上传素材今天该不该有一行回执,有的话说什么。纯函数:不读库、不算价、不花钱。 */
export function understandingReceipt(facts: UnderstandingCostFacts): UnderstandingReceipt {
  if (facts.pending) {
    return { state: "pending", line: facts.pendingCopy ?? UNDERSTANDING_PENDING_FALLBACK };
  }
  if (facts.creditsCharged > 0) {
    const amount = creditsLabel(facts.creditsCharged);
    return { state: "charged", line: `${UNDERSTOOD_LABEL} · ${amount}`, amount };
  }
  return { state: "none" };
}
