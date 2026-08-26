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
import { Badge } from "@/components/ui/badge";
import { Item, ItemActions, ItemContent, ItemMedia, ItemTitle } from "@/components/ui/item";

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
    /*
     * 列表行归位 `ui/item`(审计 A-13),属性从并排的裸 `<span>` 改成有名字的
     * `<dl>`(审计 B-5)—— 屏幕上还是三列,读出来是「来源:Raya launch / 类型:图片 /
     * 做于:24 Aug」,不是三段没有归属的字。`dt` 只对读屏软件出声,视觉上不占位。
     *
     * 整行可点留给鼠标,键盘路径长在名字那颗按钮上(`<div>` 不可聚焦)。
     */
    return (
      <Item className="r22-lib-row" size="sm" data-selected={selected || undefined} onClick={() => onOpen(asset)}>
        {check}
        <ItemMedia variant="image" className="r22-lib-row-thumb"><img src={asset.poster} alt="" /></ItemMedia>
        <ItemContent className="r22-lib-row-open">
          <ItemTitle>
            <Button unstyled type="button" className="r22-lib-row-name" onClick={(event) => { event.stopPropagation(); onOpen(asset); }}>{asset.name}</Button>
          </ItemTitle>
          <dl className="r22-lib-row-facts">
            <div><dt>From</dt><dd>{originLabel}</dd></div>
            <div><dt>Type</dt><dd>{kindLabel}</dd></div>
            <div><dt>Made</dt><dd><time dateTime={asset.createdAt}>{dayLabel(asset.createdAt)}</time></dd></div>
          </dl>
        </ItemContent>
        <ItemActions>{star}</ItemActions>
      </Item>
    );
  }

  return (
    <article className="r22-lib-tile" data-selected={selected || undefined} data-selecting={selecting || undefined}>
      <Button unstyled type="button" className="r22-lib-tile-open" aria-label={`Open ${asset.name}`} onClick={() => onOpen(asset)}>
        <span className="r22-lib-media">
          <img src={asset.poster} alt="" />
          {/* 时长标是一枚芯片,不是一句话(审计 B-4 / A-15)。 */}
          {asset.kind === "video" ? <Badge className="r22-lib-clip"><Play aria-hidden="true" />{asset.duration}</Badge> : null}
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
