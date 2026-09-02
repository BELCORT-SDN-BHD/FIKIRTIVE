"use client";
/**
 * CanvasComparePanel — 两张卡并排看(#605 T6 · spec #599 D8)。
 *
 * 商家会截这一屏发给同事说「我选 A」。所以左右两边由 `canvasComparePair` 按落盘序号定死:
 * 先点哪一张、卡摆在哪里,都换不了边。
 *
 * 这个面板本身不判断能不能比——它只画一对已经通过闸的卡。闸是 `canvasCardsComparable`,
 * 只认落盘事实:真的一次生成出来的两张,别的都不开门。
 */

import type { CanvasComparePair } from "@/lib/canvas-batch-identity";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

export type CanvasCompareCard = {
  id: string;
  type: string | null;
  url: string | null;
  prompt: string | null;
};

function CompareSide({ card, label }: { card: CanvasCompareCard; label: string }) {
  const said = (card.prompt ?? "").trim();
  return (
    <Card size="sm" data-compare-side={card.id} className="cv-compare-side">
      <CardHeader className="cv-compare-side-head">
        <Badge variant="outline" className="cv-compare-label">{label}</Badge>
        <div className="min-w-0">
          <CardTitle className="sr-only">Option {label}</CardTitle>
          <CardDescription className="cv-compare-said">{said || "No description kept"}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="cv-compare-media">
        {card.url === null ? (
          // A card with no media has nothing to compare — say so instead of showing a blank box.
          <Empty className="cv-compare-empty">
            <EmptyHeader>
              <EmptyTitle>Preview unavailable</EmptyTitle>
              <EmptyDescription>Nothing to show for this card yet.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : card.type === "video" ? (
          <video src={card.url} controls playsInline preload="metadata" aria-label={said || "Video"} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={card.url} alt={said || "Image"} />
        )}
      </CardContent>
    </Card>
  );
}

export function CanvasComparePanel({
  pair,
  left,
  right,
  onClose,
}: {
  pair: CanvasComparePair;
  left: CanvasCompareCard;
  right: CanvasCompareCard;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="cv-compare max-h-[calc(100dvh-2rem)] max-w-[min(1120px,calc(100vw-2rem))] overflow-hidden p-4 sm:p-5">
        <DialogHeader className="pr-10">
          <DialogTitle>{pair.title}</DialogTitle>
          <DialogDescription>Review both outputs at the same scale before choosing.</DialogDescription>
        </DialogHeader>
        <div className="cv-compare-grid">
          <CompareSide card={left} label={pair.left.label} />
          <CompareSide card={right} label={pair.right.label} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default CanvasComparePanel;
