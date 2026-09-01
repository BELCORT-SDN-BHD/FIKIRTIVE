"use client";
/**
 * CanvasLineagePanel — 「这张卡的来龙去脉」,北极星画布上的血缘树(#605 T6 · spec #599 D8)。
 *
 * 商家点开任何一张卡,树上说的每一句都必须是落盘的事实:哪张卡做出了它、它做出了哪些卡、
 * 它和哪几张是一次生成出来的兄弟。四列之外的东西(坐标、卡片先后、板上还剩几张)一律不参与,
 * 形状由 `buildCanvasLineageTree` 一处决定,这里只负责画。
 *
 * 诚实优先于好看:
 *   · 读不出来 ⇒ 整棵树换成「Lineage unavailable」,一条关系都不画(fail-closed 先例)。
 *   · 来源没记下来 ⇒ 说没记下来,不改口叫「原创」。
 *   · 来源不在这块板上 ⇒ 直说,不画一条通往看不见的卡的线。
 *   · 批次序号没记 ⇒ 位置留空,不按顺序补。
 *
 * 引擎保密:这里只出现商家看得懂的东西(类型、提示词、批次位置),永远没有模型或供应商名字。
 */

import type { CanvasLineageTree, CanvasLineageTreeRow } from "@/lib/canvas-lineage-tree";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { TooltipButton } from "@/components/ui/tooltip-button";
import { XIcon } from "lucide-react";

/** What the focused card records about its own source, in the merchant's words. */
const ORIGIN_NOTE: Record<CanvasLineageTree["origin"], string | null> = {
  "not-recorded": "No source recorded for this card.",
  "off-board": "Source is not on this board.",
  "on-board": null,
};

function LineageRow({
  row,
  indentFrom,
  onPick,
}: {
  row: CanvasLineageTreeRow;
  indentFrom: number;
  onPick: (id: string) => void;
}) {
  const said = row.prompt;
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      data-lineage-row={row.id}
      aria-current={row.isFocus ? "true" : undefined}
      onClick={() => onPick(row.id)}
      className="cv-lineage-row h-8 w-full justify-start px-2 font-normal text-muted-foreground"
      style={{ marginLeft: Math.max(0, row.depth - indentFrom) * 12 }}
    >
      <span className="cv-lineage-kind">{row.kind}</span>
      <span className="cv-lineage-said">{said || "No description kept"}</span>
      {row.letter && <Badge className="cv-lineage-letter">{row.letter}</Badge>}
      {!row.letter && row.batchPosition && (
        <Badge variant="outline" className="cv-lineage-pos">{row.batchPosition}</Badge>
      )}
    </Button>
  );
}

export function CanvasLineagePanel({
  tree,
  unavailable,
  onPick,
  onClose,
}: {
  /** Null when no single card is picked — the tree is about ONE card. */
  tree: CanvasLineageTree | null;
  /** The board's history could not be read. Nothing is drawn while this is true. */
  unavailable: boolean;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const originNote = tree ? ORIGIN_NOTE[tree.origin] : null;
  return (
    <aside aria-label="Lineage" className="cv-lineage">
      <Card size="sm" className="cv-lineage-card">
        <CardHeader className="relative pr-9">
          <CardTitle>Lineage</CardTitle>
          <CardDescription>Trace how the selected card was made.</CardDescription>
          <TooltipButton
            type="button"
            variant="ghost"
            size="icon-xs"
            className="absolute -right-1 -top-1"
            label="Close lineage"
            tooltip="Close"
            onClick={onClose}
          >
            <XIcon aria-hidden="true" />
          </TooltipButton>
        </CardHeader>

        <CardContent className="cv-lineage-content">
        {unavailable ? (
        // FAIL CLOSED. A board read that failed says nothing about today's relationships, and the
        // snapshot still on screen may already be wrong — so the tree stops talking rather than
        // keep telling a story it cannot stand behind.
          <Empty className="cv-lineage-empty">
            <EmptyHeader>
              <EmptyTitle>Lineage unavailable</EmptyTitle>
              <EmptyDescription>
                We couldn&apos;t read this board&apos;s history just now, so nothing is shown here. Your
                cards are untouched.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
      ) : !tree ? (
          <Empty className="cv-lineage-empty">
            <EmptyHeader>
              <EmptyTitle>Pick a card</EmptyTitle>
              <EmptyDescription>Choose one card to see where it came from.</EmptyDescription>
            </EmptyHeader>
          </Empty>
      ) : (
        <div className="cv-lineage-body">
          <section>
            <p className="cv-panel-label">Made from</p>
            {originNote && <p className="cv-panel-note">{originNote}</p>}
            <div className="cv-lineage-rows">
              {tree.chain.map((row) => (
                <LineageRow key={`chain-${row.id}`} row={row} indentFrom={0} onPick={onPick} />
              ))}
            </div>
          </section>

          {tree.batch && (
            <>
              <Separator />
              <section>
                <p className="cv-panel-label">Same batch · Batch of {tree.batch.size}</p>
                <p className="cv-panel-note">
                  One press made these together. Standing side by side is not the same as coming from
                  one another.
                </p>
                <div className="cv-lineage-rows">
                  {tree.batch.rows.map((row) => (
                    <LineageRow key={`batch-${row.id}`} row={row} indentFrom={0} onPick={onPick} />
                  ))}
                </div>
              </section>
            </>
          )}

          {tree.descendants.length > 0 && (
            <>
              <Separator />
              <section>
                <p className="cv-panel-label">Made from this</p>
                <div className="cv-lineage-rows">
                  {tree.descendants.map((row) => (
                    <LineageRow
                      key={`down-${row.id}`}
                      row={row}
                      indentFrom={tree.chain.length}
                      onPick={onPick}
                    />
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      )}
        </CardContent>
      </Card>
    </aside>
  );
}

export default CanvasLineagePanel;
