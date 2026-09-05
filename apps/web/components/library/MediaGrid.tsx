"use client";

/**
 * Library 的媒体网格(`design-system/patterns/library/README.md` §3.1 与
 * `LibraryReference.tsx` 的 `MediaTile` / `MediaGrid` / 加载骨架)。
 *
 * 从 `LibraryView.tsx` 原样搬出来的 —— 一行行为都没改。搬的理由只有一个:Favorites、
 * Collections 与 Generation history 必须是**同一个**网格。复制第二份的那一天,三处的
 * 比例、时长与标题规则就会开始各说各话,而这三样恰好都是「不许再回到夹具」的规则。
 *
 * 选择模式(勾选框与它的批量动作)是本段新加的:它在 seg2a 那一票里被登记为「设计有、
 * 后端没有契约」,而收藏与合集落地之后契约有了,所以它按已批准设计回到网格上。
 */

import * as React from "react";
import { Film } from "lucide-react";

import { Button } from "@/design-system/primitives/button";
import { Checkbox } from "@/design-system/primitives/checkbox";
import { Skeleton } from "@/design-system/primitives/skeleton";
import { libraryItemAccessibleName } from "@/lib/library-item-a11y";
import {
  groupLibraryItems,
  libraryDurationLabel,
  libraryItemRawName,
  libraryItemTitle,
  type LibraryTimeZone,
} from "@/lib/library-view-model";
import { cn } from "@/lib/utils";

/**
 * 网格画一块砖只需要这几件事实 —— `LibraryItem`(生成历史 / 上传)与
 * `LibrarySubjectItem`(收藏 / 合集成员)都满足它,所以三处共用同一块砖。
 */
export type MediaTileItem = {
  id: string;
  url: string;
  kind: "image" | "video";
  prompt: string;
  /** 上传与生成在同一张表里,靠这一列分身份 —— 标题规则(上传写文件名、引擎产物写
      提示词)认的就是它。`LibraryItem` 与 `LibrarySubjectItem` 都带着它。 */
  source: "upload" | "generated";
  filename: string;
  width: number | null;
  height: number | null;
  durationS: number | null;
  createdAt: string;
};

export function MediaTile({
  item,
  selected,
  onOpen,
  selectionMode = false,
  checked = false,
  onCheckedChange,
}: {
  item: MediaTileItem;
  selected: boolean;
  onOpen: () => void;
  selectionMode?: boolean;
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}) {
  const title = libraryItemTitle(item);
  // 看得见的那行字仍是 `libraryItemTitle`(设计的 caption);**读屏念的那句**走
  // `lib/library-item-a11y.ts` —— Codex staging 审计 LIB-STG-P2-005 定的那一份单源
  // (整段提示词当无障碍名,每个 Tab 停顿都念一整段;#1185 已经在 CanvasLibraryPicker 与
  // StuffLibrary 落过)。Library 网格是第三个同病的调用点,照样读同一个函数,不自建第二套截断。
  const accessibleName = libraryItemAccessibleName(libraryItemRawName(item), item.kind);
  const duration = libraryDurationLabel(item);
  // 已批准的 Library 用「保持原始比例的紧凑 media grid」(README §3.1),瀑布流的高低差
  // 就是从这来的。比例是 `Asset` 上的真实两条边,不是一个统一裁出来的框;两条边缺一条的
  // 旧行退回 4:5 的占位比例(而不是让格子塌成零高)。
  const ratio = item.width && item.height ? `${item.width} / ${item.height}` : null;
  return (
    <div className="relative mb-2 break-inside-avoid">
      {selectionMode ? (
        <div className="absolute top-2 left-2 z-10 rounded-md bg-background/90 p-1 shadow-sm backdrop-blur-sm">
          <Checkbox
            aria-label={`Select ${accessibleName}`}
            checked={checked}
            onCheckedChange={(next) => onCheckedChange?.(Boolean(next))}
          />
        </div>
      ) : null}
      <Button
        variant="ghost"
        /* 名字与已批准设计一致(`LibraryReference.tsx` 的 MediaTile):这一块砖永远叫
           「Open <名字>」,勾选那一颗才叫「Select <名字>」—— 两个控件两个名字,读屏
           不会听到同一句话说两遍。两颗键的 <名字> 走同一份 `accessibleName`(单源)。 */
        aria-label={`Open ${accessibleName}`}
        // 悬停/长按看到的是**完整**原名,和 `CanvasLibraryPicker.tsx` 同源;`title` 变量是
        // 给看得见的 caption 用的 72 字截断版,拿它当 tooltip 等于把截断又说了一遍。
        title={libraryItemRawName(item)}
        aria-selected={selected}
        onClick={selectionMode ? () => onCheckedChange?.(!checked) : onOpen}
        className={cn(
          "group relative h-auto w-full overflow-hidden rounded-lg border border-border bg-muted p-0 shadow-none",
          "hover:border-foreground/25 hover:bg-muted focus-visible:ring-offset-2",
          selected && "border-foreground ring-1 ring-ring/20",
          checked && "border-foreground ring-1 ring-foreground/20",
        )}
      >
        {item.kind === "video" ? (
          <video
            src={item.url}
            muted
            playsInline
            preload="metadata"
            style={ratio ? { aspectRatio: ratio } : undefined}
            className={cn("h-auto w-full object-cover", !ratio && "aspect-[4/5]")}
          />
        ) : (
          // 商家素材走自家 `/files` 路由,尺寸由 Asset 行决定 —— 与 StuffLibrary、
          // DetailPanel 同一种做法:裸 img/video,不过 next/image 的优化管线。
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.url}
            alt=""
            loading="lazy"
            style={ratio ? { aspectRatio: ratio } : undefined}
            className={cn(
              "h-auto w-full object-cover transition-transform duration-[var(--dur-3)] ease-[var(--ease-out)] group-hover:scale-[1.015] motion-reduce:transition-none",
              !ratio && "aspect-[4/5]",
            )}
          />
        )}
        {item.kind === "video" && duration ? (
          <span className="absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-md bg-foreground/80 px-1.5 py-1 text-xs font-medium text-background backdrop-blur-sm">
            <Film className="size-3" aria-hidden />
            {duration}
          </span>
        ) : null}
        <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-foreground/60 to-transparent px-2.5 pt-8 pb-2 text-left text-xs font-medium text-background opacity-0 transition-opacity duration-[var(--dur-2)] group-hover:opacity-100 group-focus-visible:opacity-100">
          {title}
        </span>
      </Button>
    </div>
  );
}

export function GridSkeleton() {
  return (
    <div className="[column-count:5] [column-gap:0.5rem]" aria-hidden>
      {Array.from({ length: 10 }, (_, index) => (
        <Skeleton key={index} className="mb-2 aspect-[4/5] w-full rounded-lg" />
      ))}
    </div>
  );
}

export function MediaGrid<T extends MediaTileItem>({
  items,
  selectedId,
  onOpen,
  timeZone,
  selectionMode = false,
  selectedIds,
  onSelect,
}: {
  items: readonly T[];
  selectedId?: string;
  onOpen: (item: T) => void;
  /** 分组的日界按这个时区算 —— 与 `Date created` 筛选是同一个值。 */
  timeZone: LibraryTimeZone;
  selectionMode?: boolean;
  selectedIds?: ReadonlySet<string>;
  onSelect?: (item: T, checked: boolean) => void;
}) {
  const groups = React.useMemo(
    () => groupLibraryItems(items, new Date(), timeZone),
    [items, timeZone],
  );
  return (
    <div className="space-y-7">
      {groups.map((group) => (
        <section key={group.key} aria-labelledby={`library-${group.key}`}>
          <div className="mb-3 flex items-center gap-2">
            <h2 id={`library-${group.key}`} className="text-sm font-semibold">{group.label}</h2>
            <span className="text-xs text-muted-foreground">{group.items.length}</span>
          </div>
          <div className="[column-count:5] [column-gap:0.5rem]">
            {group.items.map((item) => (
              <MediaTile
                key={item.id}
                item={item}
                selected={item.id === selectedId}
                onOpen={() => onOpen(item)}
                selectionMode={selectionMode}
                checked={selectedIds?.has(item.id) ?? false}
                onCheckedChange={(checked) => onSelect?.(item, checked)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
