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

import { useEffect, useRef } from "react";
import type { CanvasComparePair } from "@/lib/canvas-batch-identity";
import { Button } from "@/components/ui/button";

export type CanvasCompareCard = {
  id: string;
  type: string | null;
  url: string | null;
  prompt: string | null;
};

function CompareSide({ card, label }: { card: CanvasCompareCard; label: string }) {
  const said = (card.prompt ?? "").trim();
  return (
    <div data-compare-side={card.id} className="cv-compare-side">
      <div className="cv-compare-side-head">
        <span className="cv-compare-label">{label}</span>
        <span className="cv-compare-said">{said || "No description kept"}</span>
      </div>
      <div className="cv-compare-media">
        {card.url === null ? (
          // A card with no media has nothing to compare — say so instead of showing a blank box.
          <span className="cv-compare-nomedia">Nothing to show for this card yet.</span>
        ) : card.type === "video" ? (
          <video src={card.url} controls playsInline preload="metadata" aria-label={said || "Video"} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={card.url} alt={said || "Image"} />
        )}
      </div>
    </div>
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
  const frameRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    frameRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      ref={frameRef}
      role="dialog"
      aria-modal="true"
      aria-label={pair.title}
      tabIndex={-1}
      className="cv-compare"
    >
      <header className="cv-compare-head">
        <span className="cv-compare-title">{pair.title}</span>
        {/* #840 车4:`al-btn al-btn-sm` = 透明底/透明边/继承色的小键 → ghost + 显式压回
            al-btn-sm 的高度、内距与字号(圆角天生同值)。 */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-auto px-[13px] py-1.5 text-[12.5px]"
          aria-label="Close compare"
          onClick={onClose}
        >
          Close
        </Button>
      </header>
      <div className="cv-compare-grid">
        <CompareSide card={left} label={pair.left.label} />
        <CompareSide card={right} label={pair.right.label} />
      </div>
    </div>
  );
}

export default CanvasComparePanel;
