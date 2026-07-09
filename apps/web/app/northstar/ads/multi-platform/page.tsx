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
import { AdsTabs } from "@/components/northstar/ads/ads-tabs";
import { NS_AD_PLATFORMS, type NsAdPlatform } from "@/components/northstar/ads/mock-ads";
import { adSubmissions, connections, useStore } from "@/components/northstar/immersive/_store";
import type { NsConnection } from "@/components/northstar/immersive/account-ops/data";

const STATUS_BADGE: Record<NsAdPlatform["status"], "success" | "info" | "default"> = {
  connected: "success",
  next: "info",
  planned: "default",
};

/**
 * 广告平台 → 底层渠道连接(共享 store.connections)映射。
 * Meta 广告投放靠 Facebook + Instagram 渠道;TikTok Ads 靠 TikTok 渠道。
 * Lazada / Shopee 还没进连接注册表 —— 没映射 = 保持静态「Planned」(诚实缺口,不假装)。
 */
const PLATFORM_CHANNELS: Record<string, NsConnection["channel"][]> = {
  meta: ["facebook", "instagram"],
  tiktok: ["tiktok"],
};

interface LiveStatus {
  status: NsAdPlatform["status"];
  label: string;
  /** action/未连接时,给连接卡的一句人话(优先用渠道自己的 note) */
  hint?: string;
}

/** 平台卡状态读 store.connections:连上/需重连/未连都跟着共享连接实时变。 */
function liveStatus(platform: NsAdPlatform, conns: NsConnection[]): LiveStatus {
  const channels = PLATFORM_CHANNELS[platform.id];
  // 未映射到渠道(Lazada / Shopee):保持数据里的静态状态,不捏造连接
  if (!channels) return { status: platform.status, label: platform.statusLabel };

  const mapped = conns.filter((c) => channels.includes(c.channel));
  const allConnected = mapped.length > 0 && mapped.every((c) => c.status === "connected");
  if (allConnected) return { status: "connected", label: "Connected" };

  const action = mapped.find((c) => c.status === "action");
  if (action) return { status: "next", label: "Reconnect", hint: action.note };
  return { status: "next", label: "Connect" };
}

/** 平台连接卡 — 卡即切换器(aria-pressed;选中 = border-foreground,不用 coral) */
function PlatformCard({
  platform,
  live,
  selected,
  pendingCount,
  onSelect,
}: {
  platform: NsAdPlatform;
  /** 从 store.connections 派生的实时状态(不再读死数据) */
  live: LiveStatus;
  selected: boolean;
  /** 这个平台上待审的草稿数(广告构建器提交 → Meta 卡亮「审核中」) */
  pendingCount: number;
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
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={STATUS_BADGE[live.status]}>{live.label}</Badge>
        {pendingCount > 0 && (
          <Badge variant="warning">{pendingCount} in review</Badge>
        )}
      </div>
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

  // 待审草稿按平台计数(广告构建器 submit 落进共享事件流)。
  useStore();
  const conns = connections();
  const pendingByPlatform = adSubmissions().reduce<Record<string, number>>((acc, e) => {
    const key = String(e.payload.platform ?? "meta");
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const platform = NS_AD_PLATFORMS.find((p) => p.id === platformId) ?? NS_AD_PLATFORMS[0]!;
  // 选中平台的实时状态(读共享 store.connections;在 Connections 连/断 → 这里即时翻牌)
  const live = liveStatus(platform, conns);

  return (
    <div className="mx-auto w-full max-w-[880px] px-6 pt-6 pb-24">
      {/* 页头永远渲染(§N6):错误/加载墙都住 body */}
      <PageHeader
        title="Ad platforms"
        subtitle="One workbench, one adapter per platform. TikTok first, then Lazada, then Shopee."
      />
      <div className="mt-2">
        <AdsTabs />
      </div>

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
                live={liveStatus(p, conns)}
                selected={p.id === platformId}
                pendingCount={pendingByPlatform[p.id] ?? 0}
                onSelect={() => setPlatformId(p.id)}
              />
            ))}
          </div>

          {/* 选中平台的 adapter 面板(同页型复用) */}
          <Panel
            title={`${platform.label} adapter`}
            basis="Platform-specific slots. Adding a platform adds an adapter, not a new page."
            stamp={live.status === "connected" ? "connected · read-write" : undefined}
            className="mt-4"
          >
            <p className="mt-3 text-[13px] leading-[18px] text-muted-foreground">{platform.note}</p>
            <AdapterParams platform={platform} />

            {live.status === "connected" && (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
                <Button asChild variant="secondary" size="sm">
                  <Link href="/northstar/ads/builder">Open ad builder</Link>
                </Button>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/northstar/ads/performance">View ad performance</Link>
                </Button>
              </div>
            )}

            {live.status === "next" && (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
                {/* 连接动作跳住户服务中心 · Connections(清单注:registry 驱动,不重复计) */}
                <Button asChild variant="secondary" size="sm">
                  <Link href="/northstar/account/connections">Open Connections</Link>
                </Button>
                <span className="text-xs text-muted-foreground">
                  {live.hint ??
                    "Connecting happens in Connections. This page lights up by itself after that."}
                </span>
              </div>
            )}

            {live.status === "planned" && (
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
