"use client";

/**
 * 沉浸式 · Discover —— 灵感瀑布流(全真图 + hover 视频预览)。
 * 每张卡接一个真去处:Make this yours → canvas 预置会话(?from=<id>,连接器 1)。
 * §O3 shelves:零头像、零 coral —— 灵感是素材,不是 Otto 的作品。原生重建(无 GalleryFrame)。
 */

import * as React from "react";
import Link from "next/link";
import { Compass, Pause, Play, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { DISCOVER_ITEMS, DISCOVER_TAGS, type DiscoverItem } from "@/components/northstar/assets/_data";
import { SegChips } from "@/components/northstar/assets/_zone";
import { PageHeader, EmptyState, AssetsNav, ASSETS_BASE } from "./kit";

export function AssetsDiscover() {
  const [tag, setTag] = React.useState("All");
  const visible = DISCOVER_ITEMS.filter((it) => tag === "All" || it.tag === tag);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1280px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Discover"
        subtitle="Ideas from shops like yours. Hover a video to preview, then make it yours."
        actions={<AssetsNav />}
      />

      <div className="mt-6">
        <SegChips
          options={DISCOVER_TAGS.map((t) => ({ key: t, label: t }))}
          value={tag}
          onChange={setTag}
          ariaLabel="Filter ideas by tag"
        />
      </div>

      <div className="mt-6 flex flex-1 flex-col">
        {visible.length === 0 ? (
          <EmptyState icon={Compass} title="Nothing matches this tag." />
        ) : (
          <div className="columns-2 gap-4 md:columns-3 xl:columns-4">
            {visible.map((it) => (
              <DiscoverCard key={it.id} item={it} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DiscoverCard({ item }: { item: DiscoverItem }) {
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
      {/* eslint-disable-next-line @next/next/no-img-element -- 原型层用 <img> 热链 NS_IMAGES(不走 next/image) */}
      <img
        src={item.thumb}
        alt={item.title}
        className={cn("w-full object-cover transition-transform duration-150", previewing && "scale-[1.02]")}
        style={{ aspectRatio: `480 / ${item.h}` }}
      />

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

      <div className="absolute inset-x-2 bottom-12 flex justify-center opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
        <Link
          href={`${ASSETS_BASE}/create/canvas?from=${item.id}`}
          className="inline-flex h-8 items-center gap-1.5 rounded-[10px] border border-border bg-card px-3 text-[13px] font-semibold text-foreground shadow-[var(--shadow-sm)] outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/40"
        >
          <Sparkles className="size-4" strokeWidth={2} />
          Make this yours
        </Link>
      </div>

      <div className="flex items-center gap-2 border-t border-border px-3 py-2">
        <p className="min-w-0 flex-1 truncate text-[13px] leading-[18px] font-medium text-foreground">{item.title}</p>
        <span className="shrink-0 text-[11px] leading-[14px] text-muted-foreground">{item.tag}</span>
      </div>
    </div>
  );
}
