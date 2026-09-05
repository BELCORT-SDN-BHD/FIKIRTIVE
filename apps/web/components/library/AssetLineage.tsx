"use client";

import Link from "next/link";
import { CANVAS_HREF } from "@fikirtive/core/navigation";
import { creditsLabel } from "@/lib/credit-format";
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
 * `netChargedInternalCredits`)、状态来自 `GenJob.status`、用途来自这一行自己身上的
 * `shotId` / `campaignId`。
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
      {lineage.costCredits != null && (
        <p className="cv-detail-fact-copy">
          {lineage.costCredits === 0 ? "Cost: no credits charged" : `Cost: ${creditsLabel(lineage.costCredits)}`}
        </p>
      )}
      <p className="cv-detail-fact-copy">Status: {lineage.status}</p>
      {lineage.usedIn.length > 0 && (
        <p className="cv-detail-fact-copy">Used in: {lineage.usedIn.join(", ")}</p>
      )}
    </div>
  );
}

export default AssetLineage;
