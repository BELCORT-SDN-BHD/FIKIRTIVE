"use client";

import Link from "next/link";
import { CANVAS_HREF } from "@fikirtive/core/navigation";
import { UNDERSTANDING_PROVIDER_PAUSED, UNDERSTANDING_WAITING_FOR_CREDITS } from "@fikirtive/core";
import { creditsLabel } from "@/lib/credit-format";
import type { GenerationLineage } from "@/lib/actions";
import { PRODUCT_VOCABULARY } from "@/lib/product-vocabulary";

/**
 * `costPending` 为真时该说哪一句 —— 判官修根 P1-1(PR #1415,FSE-203/205/211)。
 * PAUSED_BALANCE / PAUSED 都不是「快有结果」,商家该做的事也不一样(充值 vs 什么都不用做),
 * 混着说成一句「settles shortly」是撒谎。两句权威文案原样搬运(`@fikirtive/core`),
 * 不在这里另造第三套说法(家规 §7.3 单一源头)。
 */
function pendingCostCopy(reason: GenerationLineage["costPendingReason"]): string {
  if (reason === "waiting_for_credits") return UNDERSTANDING_WAITING_FOR_CREDITS;
  if (reason === "provider_paused") return UNDERSTANDING_PROVIDER_PAUSED;
  // QUEUED / RUNNING —— 真的快,原话不动。
  return "still reading this file — price settles shortly";
}

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
        <p className="cv-detail-fact-copy">References used: {lineage.references.join(", ")}</p>
      )}
      {lineage.costPending ? (
        // FSE-203 —— 上传成功到自动理解结算之间那几十秒,这一格从前写死 0,于是说出
        // "Cost: no credits charged" 这句假话(这笔钱随后一定会收)。结算没定论前说诚实
        // 中间态,绝不能说没花钱。FSE-211 判官修根 P1-1:PAUSED_BALANCE / PAUSED 不是
        // 「快」,文案按 `costPendingReason` 分岔(见上方 `pendingCostCopy`)。
        <p className="cv-detail-fact-copy">Cost: {pendingCostCopy(lineage.costPendingReason)}</p>
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
