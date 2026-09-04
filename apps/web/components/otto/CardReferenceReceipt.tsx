"use client";

/**
 * CardReferenceReceipt —— 确认卡上「这一趟会用到哪几件东西」的那一块,**一份**。
 *
 * ── 为什么它存在(Codex 只读 E2E QA-CRE-FE9-013,2026-09-04)──────────────────
 *
 * 那一轮的确认卡只列得出 `Aisyah (person)`。商家在 composer 上明明看见一个 `Image ref`
 * 的芯片(他从 Library 选的那只蓝杯子),卡上却一个字都没提它 —— 而那张图早在服务端就被
 * 静默丢掉了。他按下 `Generate · N credits`,买回来的是一张没有他指定产品的商业素材。
 *
 * 所以这一块的规矩只有两条:
 *   ① **逐项列出**,人物与媒体一样对待 —— 名字、类型,媒体再加上缩略图与来源画布;
 *   ② 卡上有一件参考却没有它的回执(老卡,或将来某条路忘了传)⇒ 这里说出**缺哪一件**,
 *      而按钮那一侧由 `planCardGate.approvable` 关掉 —— 说不清要用什么的卡,不许拿去花钱。
 *
 * 两张卡(聊天里的 `OttoPlanCard`、画布上始终可见的 `OttoTurnCard`)读的是这一个组件:
 * 回执抄成两份,哪天一份先烂掉,商家在两个地方读到的就是两件事。
 */

import { ImageIcon, Film } from "lucide-react";

// 角色 → 商家读到的那个词。一份,住在 `@fikirtive/core/reference-budget`(它是关于引擎
// 输入数组的事实);这里只渲染,不自己翻译。子路径而不是包根 —— 包根会把 node:crypto
// 拖进客户端包(同 plan-card-contract 的那条注释)。
import { cardReferenceRoleLabel } from "@fikirtive/core/reference-budget";

import type { OttoPlanCardPayload } from "./plan-card-contract";

/** 缺回执时卡面读到的那一句 —— 缺哪一件,逐字说出来。 */
export function missingReferenceReceiptNote(missing: string[]): string | null {
  if (missing.length === 0) return null;
  return `I can't show you what this would use for the ${missing.join(" and ")} — ask me to put this together again before you pay for it.`;
}

export function CardReferenceReceipt({
  approvedEntitiesNote,
  mediaReferences,
  missing,
}: {
  /** 人物/元素那一行 —— 措辞的单一权威仍是 `approvedEntitiesNote`(core),这里只渲染。 */
  approvedEntitiesNote: string | null;
  mediaReferences: NonNullable<OttoPlanCardPayload["mediaReferences"]>;
  missing: string[];
}) {
  const missingNote = missingReferenceReceiptNote(missing);
  if (!approvedEntitiesNote && mediaReferences.length === 0 && !missingNote) return null;
  return (
    <div className="mt-[9px] flex flex-col gap-[6px] text-[0.75rem] text-muted-foreground">
      {approvedEntitiesNote && <div>{approvedEntitiesNote}</div>}
      {mediaReferences.length > 0 && (
        <ul className="flex flex-col gap-[6px]">
          {mediaReferences.map((ref) => (
            <li key={ref.generationId} className="flex items-center gap-[7px]">
              <span className="block size-8 shrink-0 overflow-hidden rounded-[6px] border border-border bg-muted">
                {ref.kind === "video" ? (
                  <video src={ref.previewUrl} muted playsInline preload="metadata" className="size-full object-cover" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={ref.previewUrl} alt="" className="size-full object-cover" />
                )}
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-[5px]">
                  {ref.kind === "video" ? <Film size={12} aria-hidden /> : <ImageIcon size={12} aria-hidden />}
                  <span className="truncate text-foreground">{ref.label}</span>
                </span>
                {/* Codex staging CRE-STG-P1-003 —— 这一件在这个计划里坐哪一格。走查的
                    商家看着卡上一行 `a women`,分不出它是「起始画面」还是「参考之一」,
                    而那两件事做出来的东西完全不同。角色由铸卡侧冻在卡上,这里只念出来。 */}
                <span className="block truncate">{cardReferenceRoleLabel(ref.role)}</span>
                {/* 出处。同一块画布上的就不说 —— 那句话是噪音;从别的画布拿过来的必须说,
                    因为 Library 是全店级的,而商家有权知道上车的是哪一块画布上的那一件。 */}
                {!ref.sameCanvas && (
                  <span className="block truncate">From {ref.sourceProjectName}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {missingNote && (
        <div className="text-[var(--warning-soft-foreground)]">{missingNote}</div>
      )}
    </div>
  );
}

export default CardReferenceReceipt;
