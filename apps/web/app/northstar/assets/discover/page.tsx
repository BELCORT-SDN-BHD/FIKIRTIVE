/* @nsPage district="资产区" page="discover" status="draft"
   sources="区划图·资产区;g5c spec;GOAL A0(同源)" approvedAt="" pr="" */
"use client";

/**
 * Discover — 灵感瀑布流(P0 · live·revamp)
 * 清单要素:瀑布流(CSS columns 参差网格)、悬停播放(视频卡 hover = 预览态,
 * 状态切换零循环动画)、转创作入口(hover 动作 → Make this yours → canvas)。
 * Otto 出场(§O3 shelves):零头像、零 coral —— 灵感是素材,不是 Otto 的作品。
 */

import * as React from "react";
import Link from "next/link";
import { Compass, Pause, Play, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DemoStateBar,
  ErrorPanel,
  SegChips,
  Skeleton,
  type DemoState,
} from "@/components/northstar/assets/_zone";
import { DISCOVER_ITEMS, DISCOVER_TAGS, type DiscoverItem } from "@/components/northstar/assets/_data";
import { EmptyState, MockNote, PageHeader } from "@/components/northstar/_shared";

/** 骨架高度序列(与真实卡同形的参差;确定性字面量) */
const SKELETON_HEIGHTS = [280, 200, 240, 320, 220, 260, 300, 210];

export default function Page() {
  const [demo, setDemo] = React.useState<DemoState>("normal");
  const [tag, setTag] = React.useState("All");

  const visible = DISCOVER_ITEMS.filter((it) => tag === "All" || it.tag === tag);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1280px] flex-col px-6 pt-6 pb-10">
      <PageHeader
        title="Discover"
        subtitle="Ideas from shops like yours. Hover a video to preview, then make it yours."
      />

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <SegChips
          options={DISCOVER_TAGS.map((t) => ({ key: t, label: t }))}
          value={tag}
          onChange={setTag}
          ariaLabel="Filter ideas by tag"
        />
      </div>

      {/* 三态齐全(harmony-06 §一):header/筛选永远在场,状态活在 body */}
      <div className="mt-6 flex flex-1 flex-col">
        {demo === "loading" && (
          <div role="status" aria-label="Loading" className="columns-2 gap-4 md:columns-3 xl:columns-4">
            {SKELETON_HEIGHTS.map((h, i) => (
              <div key={i} className="mb-4 break-inside-avoid" style={{ height: h }}>
                <Skeleton shimmer={i < 3} className="h-full w-full rounded-[var(--radius-card)]" />
              </div>
            ))}
          </div>
        )}

        {demo === "empty" && (
          <EmptyState
            icon={Compass}
            title="Discover is warming up"
            body="Fresh ideas land here soon. Start something of your own in the canvas."
            action={
              <Button size="sm" asChild>
                <Link href="/northstar/create/canvas">Open canvas</Link>
              </Button>
            }
          />
        )}

        {demo === "error" && (
          <ErrorPanel message="Couldn't load ideas. Try again." onRetry={() => setDemo("normal")} />
        )}

        {demo === "normal" &&
          (visible.length === 0 ? (
            <EmptyState icon={Compass} title="Nothing matches this tag." />
          ) : (
            <div className="columns-2 gap-4 md:columns-3 xl:columns-4">
              {visible.map((it) => (
                <DiscoverCard key={it.id} item={it} />
              ))}
            </div>
          ))}
      </div>

      <MockNote path="/northstar/assets/discover" />
      <DemoStateBar state={demo} onChange={setDemo} />
    </div>
  );
}

function DiscoverCard({ item }: { item: DiscoverItem }) {
  /** 悬停播放(原型模拟):hover/focus = 预览态,纯状态切换,零循环动画 */
  const [previewing, setPreviewing] = React.useState(false);

  return (
    <div
      className="group relative mb-4 break-inside-avoid overflow-hidden rounded-[var(--radius-card)] border border-border bg-card"
      onMouseEnter={() => item.kind === "video" && setPreviewing(true)}
      onMouseLeave={() => setPreviewing(false)}
      onFocus={() => item.kind === "video" && setPreviewing(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setPreviewing(false);
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- 原型内联 SVG data URI 占位图 */}
      <img
        src={item.thumb}
        alt={item.title}
        className={cn(
          "w-full object-cover transition-transform duration-150",
          previewing && "scale-[1.02]",
        )}
        style={{ aspectRatio: `480 / ${item.h}` }}
      />

      {/* 视频卡:播放指示(状态切换,文字孪生随附) */}
      {item.kind === "video" && (
        <span className="absolute top-2 left-2 inline-flex h-6 items-center gap-1 rounded-full border border-border bg-card px-2 text-[11px] leading-none font-semibold text-muted-foreground">
          {previewing ? (
            <>
              <Pause className="size-3" strokeWidth={2} />
              Previewing
            </>
          ) : (
            <>
              <Play className="size-3" strokeWidth={2} />
              Video
            </>
          )}
        </span>
      )}

      {/* 转创作入口:悬停/focus 显现(触屏由 focus-within 兜底,§N2 同源) */}
      <div className="absolute inset-x-2 bottom-12 flex justify-center opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
        <Button variant="secondary" size="sm" asChild>
          <Link href={`/northstar/create/canvas?from=${item.id}`}>
            <Sparkles strokeWidth={2} />
            Make this yours
          </Link>
        </Button>
      </div>

      {/* 标题条:常显,truncate */}
      <div className="flex items-center gap-2 border-t border-border px-3 py-2">
        <p className="min-w-0 flex-1 truncate text-[13px] leading-[18px] font-medium text-foreground">
          {item.title}
        </p>
        <span className="shrink-0 text-[11px] leading-[14px] text-muted-foreground">{item.tag}</span>
      </div>
    </div>
  );
}
