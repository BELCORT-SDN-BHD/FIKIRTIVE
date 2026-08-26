"use client";

/**
 * LibraryCard.tsx —— 网格里的一格,以及列表视图里的一行。
 *
 * 两种视图共用一个组件,因为它们说的是同一件事,只是排法不同 —— 拆成两个文件会立刻长出
 * 两套勾选逻辑与两套星标逻辑,而这一面最容易坏的就是「勾了却没选上」。
 *
 * shift 连选拿不到 Radix 的事件对象(`onCheckedChange` 只给布尔),所以先在 `onClick` 里
 * 把那一下按没按 shift 记下来,再在 `onCheckedChange` 里用。两个回调在同一次点击里按序跑,
 * 中间不会插进别的点击。
 */

import { Play, Star } from "lucide-react";
import { useRef, type MouseEvent } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

import { dayLabel, type LibraryAsset } from "./library-fixture";

export function LibraryCard({
  asset,
  layout,
  selected,
  selecting,
  onOpen,
  onSelect,
  onStar,
}: {
  asset: LibraryAsset;
  layout: "grid" | "list";
  selected: boolean;
  selecting: boolean;
  onOpen: (asset: LibraryAsset) => void;
  onSelect: (asset: LibraryAsset, extend: boolean) => void;
  onStar: (asset: LibraryAsset) => void;
}) {
  const shiftRef = useRef(false);
  const kindLabel = asset.kind === "video" ? "Video" : "Image";
  const originLabel = asset.source === "uploaded" ? "Uploaded" : asset.projectName ?? "Untitled project";

  function rememberShift(event: MouseEvent<HTMLElement>) {
    shiftRef.current = event.shiftKey;
  }

  const check = (
    <span className="r22-lib-check">
      <Checkbox
        checked={selected}
        aria-label={`Select ${asset.name}`}
        onClick={rememberShift}
        onCheckedChange={() => onSelect(asset, shiftRef.current)}
      />
    </span>
  );

  const star = (
    <Button
      unstyled
      type="button"
      className="r22-lib-star"
      aria-pressed={asset.starred}
      aria-label={`${asset.starred ? "Remove" : "Add"} ${asset.name} ${asset.starred ? "from" : "to"} Starred`}
      onClick={() => onStar(asset)}
    >
      <Star fill={asset.starred ? "currentColor" : "none"} aria-hidden="true" />
    </Button>
  );

  if (layout === "list") {
    return (
      <article className="r22-lib-row" data-selected={selected || undefined}>
        {check}
        <Button unstyled type="button" className="r22-lib-row-open" onClick={() => onOpen(asset)}>
          <span className="r22-lib-row-thumb"><img src={asset.poster} alt="" /></span>
          <b>{asset.name}</b>
          <span>{originLabel}</span>
          <span>{kindLabel}</span>
          <time dateTime={asset.createdAt}>{dayLabel(asset.createdAt)}</time>
        </Button>
        {star}
      </article>
    );
  }

  return (
    <article className="r22-lib-tile" data-selected={selected || undefined} data-selecting={selecting || undefined}>
      <Button unstyled type="button" className="r22-lib-tile-open" aria-label={`Open ${asset.name}`} onClick={() => onOpen(asset)}>
        <span className="r22-lib-media">
          <img src={asset.poster} alt="" />
          {asset.kind === "video" ? <span className="r22-lib-clip"><Play aria-hidden="true" />{asset.duration}</span> : null}
        </span>
        <span className="r22-lib-meta">
          <b>{asset.name}</b>
          <span>{originLabel}</span>
        </span>
      </Button>
      {check}
      {star}
    </article>
  );
}

export default LibraryCard;
