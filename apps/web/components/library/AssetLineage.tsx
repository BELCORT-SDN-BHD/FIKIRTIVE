"use client";

import Link from "next/link";
import { CANVAS_HREF } from "@fikirtive/core/navigation";
import { creditsLabel } from "@/lib/credit-format";
import { understandingReceipt } from "@/lib/understanding-receipt";
import type { GenerationLineage } from "@/lib/actions";
import { PRODUCT_VOCABULARY } from "@/lib/product-vocabulary";

/**
 * 血缘节 —— 一件素材的出处、参考、成本、状态、用途(清单 B3 / P1-007;
 * 规格 `docs/specs/frontend-baseline.md` §5 2026-09-05 行)。
 *
 * 「每个东西都要有迹可循」在素材详情面上的那一半。五格全部读**已经记下来的**列
 * (`lib/actions.getGenerationLineage`),一个都不现算:出处画布/对话来自
 * `Generation.projectId` / `threadId`(两条都能点回去)、参考来自生成那一刻冻结的元素名
 * 快照、成本折的是产出它那一单的**账本行**(与画布卡片信息面同一个
 * `netChargedInternalCredits`;上传那一路没有任务,折的是那件素材上**自动理解**任务的账本行
 * —— 同样与画布卡片信息面同一个 `loadUploadUnderstandingCredits`,FSE-009)、状态来自
 * `GenJob.status`、用途来自这一行自己身上的 `shotId` / `campaignId`。
 *
 * 每一行**没有记录就不出现**:没有引用就不写 "None"、成本未知就不写一个 0。整块拿不到
 * 记录时调用方连这个组件都不挂 —— 与详情面另外三块回执同一条纪律(有则显示、无则整行
 * 不出现)。
 *
 * **为什么住在自己的文件里,而不是 `DetailPanel.tsx` 里。** 文案围栏
 * (`lib/__tests__/otto-pronoun-consistency.test.ts` 借 `scripts/tools/copy-stream-model.mjs`)
 * 按**每个文件**穷举带条件的文案组合,上限 64 个条件;`DetailPanel.tsx` 本来就顶在
 * 上限上,把这一节塞进去会把整份文件推过线,于是围栏对**整个面板**罢工 —— 那是把这道
 * 围栏最该看的地方蒙上。拆成一个文件之后两边都在围栏之内。放在 `components/library/`
 * 是因为这一节是 Library 详情的验收项(清单 B3),面板只是它的宿主。
 *
 * 只画,不读:所有事实由调用方一次读好传进来。
 */
export function AssetLineage({ lineage }: { lineage: GenerationLineage }) {
  const canvasHref = `${CANVAS_HREF}?project=${encodeURIComponent(lineage.canvas.id)}`;
  const conversation = lineage.conversation;
  /**
   * 上传素材那一格的回执(Founder 2026-09-16 裁决,规格 `docs/specs/money-engine.md` §5
   * 2026-09-16 行)。三态都由 `understandingReceipt` 一处判,与画布卡片信息面同一个函数、
   * 同一个词、同一个数 —— 这里只负责画。
   *
   * 中间态与「净额为 0」两支的句子**一字未改**:R3-F06 撤掉的是输入附近的常驻价目说明,
   * 这一行是事后回执(裁决明写回执不在删除授权内),两件事不互相顶替。
   *
   * 进这一支的条件是 `costIsUnderstanding` **或** `costPending`:服务端两格同源(都挂在
   * 「没有付费任务的上传」那一支上),所以真实数据里第二个条件永远是多余的 —— 写上它是为了
   * 让 FSE-203 那条不变量不依赖新加的这一格:`costPending` 为真时绝不许掉回
   * 「no credits charged」那一支,哪怕 `costIsUnderstanding` 因为任何原因没读到。
   */
  const receipt = lineage.costIsUnderstanding || lineage.costPending
    ? understandingReceipt({
      creditsCharged: lineage.costCredits ?? 0,
      pending: lineage.costPending,
      pendingCopy: lineage.costPendingCopy,
    })
    : null;
  return (
    <div className="cv-detail-fact">
      <span className="cv-panel-label">Where this came from</span>
      <p className="cv-detail-fact-copy">
        {`${PRODUCT_VOCABULARY.canvas}: `}
        <Link href={canvasHref} className="underline">
          {lineage.canvas.name ?? "Open canvas"}
        </Link>
        {conversation ? (
          <>
            {" · Conversation: "}
            <Link
              href={`${canvasHref}&thread=${encodeURIComponent(conversation.id)}`}
              className="underline"
            >
              {conversation.title ?? "Open conversation"}
            </Link>
          </>
        ) : null}
      </p>
      {lineage.references.length > 0 && (
        /**
         * R3-F30 复审 P3(2026-09-18)—— **记录说的必须是真发生过的事。**
         *
         * 这一行从前只有一句「References used: …」。派生图(变体 / Regenerate / 编辑 /
         * 模板 / Animate)的这几个名字是从源图那一行**继承**下来的记录,而 Regenerate 那条
         * 路一张参考图都没送进引擎 —— 照旧说「用过的参考」就是把没发生过的事写进回执。
         * 所以文案跟着 `referencesInherited` 分岔:继承来的说它是**源图那一份记录**,只有
         * 这一单真的挂了元素、真的送了参考图时才说 "References used"。
         *
         * 用 `PRODUCT_VOCABULARY.elements` 而不是手抄一个词:这几个名字可能是商品,也可能
         * 是人物/服装/场景(Library `Elements` 那一支就是它们的合称),写死「Product」会在
         * 继承的是一位演员时又说一次假话。
         */
        <p className="cv-detail-fact-copy">
          {lineage.referencesInherited
            ? `${PRODUCT_VOCABULARY.elements} record (from the source image): ${lineage.references.join(", ")}`
            : `References used: ${lineage.references.join(", ")}`}
        </p>
      )}
      {receipt?.state === "charged" ? (
        // Founder 2026-09-16 —— 自动理解结清之后,那件上传素材身上留下的**唯一**一行回执:
        // 「Understood · 0.1 credits」。商家从没按过「分析」这颗按钮,所以事后必须在东西
        // 本身上说清楚读过了、扣了多少。数字折自账本已结算的净额,不是今天的牌价。
        <p className="cv-detail-fact-copy">{receipt.line}</p>
      ) : receipt?.state === "pending" ? (
        // FSE-203 —— 上传成功到自动理解结算之间那几十秒,这一格从前写死 0,于是说出
        // "Cost: no credits charged" 这句假话(这笔钱随后一定会收)。结算没定论前说诚实
        // 中间态,绝不能说没花钱。FSE-211 判官修根 P1-1:PAUSED_BALANCE / PAUSED 不是
        // 「快」,文案按 `costPendingReason` 分岔(服务端取好整句,见读模型 `pendingCopy`)。
        // 判据从 `lineage.costPending` 换成回执的 `pending` 态 —— 同一个信号,不是两个:
        // `costPending` 为真时这件素材必然有理解读路(服务端两格同一个 `!job` 条件)。
        <p className="cv-detail-fact-copy">Cost: {receipt.line}</p>
      ) : (
        lineage.costCredits != null && (
          <p className="cv-detail-fact-copy">
            {lineage.costCredits === 0 ? "Cost: no credits charged" : `Cost: ${creditsLabel(lineage.costCredits)}`}
          </p>
        )
      )}
      <p className="cv-detail-fact-copy">Status: {lineage.status}</p>
      {lineage.usedIn.length > 0 && (
        <p className="cv-detail-fact-copy">Used in: {lineage.usedIn.join(", ")}</p>
      )}
    </div>
  );
}

export default AssetLineage;
