/* @nsPage district="广告区" page="multi-platform" status="draft"
   sources="红旗一判决(全要 + 可插拔);蓝图第六章·多平台广告区" approvedAt="" pr="" */
"use client";

/**
 * 多平台投放扩展 — TikTok → Lazada → Shopee 逐平台连接与投放。
 *
 * 依据:PAGE-INVENTORY 五·广告区行 3(红旗一:全要 + 可插拔)。
 * 元素只有两件:平台连接卡(可切换,即"多平台切换")+ 平台专属参数位
 * (同一个参数面板组件逐平台复用 — 加平台 = 加 adapter,不加新页)。
 * 渠道连接入口归住户服务中心 · Connections(清单注),本页只链过去不复刻。
 * 全人工面:零 coral(§O3 — Otto 不在场),dock 由外壳提供。
 */

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { MockNote, PageHeader } from "@/components/northstar/_shared";
import {
  DemoStateBar,
  NsSkeleton,
  Panel,
  ProvenancePill,
  type NsDemoState,
} from "@/components/northstar/analytics/zone-kit";
import { NS_AD_PLATFORMS, type NsAdPlatform } from "@/components/northstar/ads/mock-ads";

const STATUS_BADGE: Record<NsAdPlatform["status"], "success" | "info" | "default"> = {
  connected: "success",
  next: "info",
  planned: "default",
};

/** 平台连接卡 — 卡即切换器(aria-pressed;选中 = border-foreground,不用 coral) */
function PlatformCard({
  platform,
  selected,
  onSelect,
}: {
  platform: NsAdPlatform;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "flex flex-col items-start gap-2 rounded-[14px] border bg-card p-4 text-left transition-colors duration-[120ms]",
        selected ? "border-foreground" : "border-border hover:bg-accent",
      )}
    >
      <span className="flex size-9 items-center justify-center rounded-[10px] bg-secondary font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-foreground uppercase">
        {platform.label.slice(0, 2)}
      </span>
      <span className="text-sm font-semibold text-foreground">{platform.label}</span>
      <Badge variant={STATUS_BADGE[platform.status]}>{platform.statusLabel}</Badge>
    </button>
  );
}

/** 平台专属参数位 — 同一面板逐平台复用(加平台 = 加 adapter);缺值 = "—"(§D2 honest gaps) */
function AdapterParams({ platform }: { platform: NsAdPlatform }) {
  return (
    <div className="mt-2">
      {platform.params.map((p) => (
        <div key={p.key} className="flex items-baseline gap-3 border-t border-border py-2.5 first:border-t-0">
          <span className="min-w-0 flex-1 text-[13px] leading-[18px] text-muted-foreground">{p.key}</span>
          <span
            className={cn(
              "shrink-0 font-mono text-xs leading-4 font-medium tracking-[0.02em]",
              p.value ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {p.value ?? "—"}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function Page() {
  const [demo, setDemo] = React.useState<NsDemoState>("ready");
  const [platformId, setPlatformId] = React.useState<string>("meta");

  const platform = NS_AD_PLATFORMS.find((p) => p.id === platformId) ?? NS_AD_PLATFORMS[0]!;

  return (
    <div className="mx-auto w-full max-w-[880px] px-6 pt-6 pb-24">
      {/* 页头永远渲染(§N6):错误/加载墙都住 body */}
      <PageHeader
        title="Ad platforms"
        subtitle="One workbench, one adapter per platform. TikTok first, then Lazada, then Shopee."
      />

      {demo === "error" && (
        <div className="mt-6 flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-border bg-card px-6 py-14 text-center">
          <div className="text-lg font-semibold text-foreground">
            Couldn&apos;t load platform status
          </div>
          <p className="max-w-[380px] text-[13px] leading-[18px] text-muted-foreground">
            Your connections are unchanged. Try again.
          </p>
          <Button variant="ghost" size="sm" onClick={() => setDemo("ready")}>
            Retry
          </Button>
        </div>
      )}

      {demo === "loading" && (
        <div className="mt-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <NsSkeleton className="h-[118px] rounded-[14px]" />
            <NsSkeleton className="h-[118px] rounded-[14px]" shimmer={false} />
            <NsSkeleton className="h-[118px] rounded-[14px]" shimmer={false} />
            <NsSkeleton className="h-[118px] rounded-[14px]" shimmer={false} />
          </div>
          <NsSkeleton className="mt-4 h-56 rounded-[var(--radius-card)]" />
        </div>
      )}

      {demo === "ready" && (
        <div className="mt-4">
          {/* 平台连接卡 ×4 = 多平台切换器 */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4" role="group" aria-label="Ad platforms">
            {NS_AD_PLATFORMS.map((p) => (
              <PlatformCard
                key={p.id}
                platform={p}
                selected={p.id === platformId}
                onSelect={() => setPlatformId(p.id)}
              />
            ))}
          </div>

          {/* 选中平台的 adapter 面板(同页型复用) */}
          <Panel
            title={`${platform.label} adapter`}
            basis="Platform-specific slots. Adding a platform adds an adapter, not a new page."
            stamp={platform.status === "connected" ? "connected · read-write" : undefined}
            className="mt-4"
          >
            <p className="mt-3 text-[13px] leading-[18px] text-muted-foreground">{platform.note}</p>
            <AdapterParams platform={platform} />

            {platform.status === "connected" && (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
                <Button asChild variant="secondary" size="sm">
                  <Link href="/northstar/ads/builder">Open ad builder</Link>
                </Button>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/northstar/ads/performance">View ad performance</Link>
                </Button>
              </div>
            )}

            {platform.status === "next" && (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
                {/* 连接入口住 Connections(清单注:registry 驱动,不重复计) */}
                <Button asChild variant="secondary" size="sm">
                  <Link href="/northstar/account/connections">Open Connections</Link>
                </Button>
                <span className="text-xs text-muted-foreground">
                  Connecting happens in Connections. This page lights up by itself after that.
                </span>
              </div>
            )}

            {platform.status === "planned" && (
              <p className="mt-4 border-t border-border pt-4 text-xs text-muted-foreground">
                Planned. The slots above are the whole integration surface, they fill in when this
                platform connects.
              </p>
            )}
          </Panel>

          <div className="mt-3">
            <ProvenancePill text="platform registry · design contract" />
          </div>
        </div>
      )}

      <MockNote path="/northstar/ads/multi-platform" />
      <DemoStateBar value={demo} onChange={setDemo} states={["ready", "loading", "error"]} />
    </div>
  );
}
