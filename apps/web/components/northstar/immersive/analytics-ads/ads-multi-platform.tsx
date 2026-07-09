"use client";

/**
 * 多平台投放(§L List;880;P2·未来)—— 原生重建。
 *
 * §五契约:平台卡切换器(aria-pressed,选中 border-foreground 非 coral);加平台 = 加
 * adapter 不加页;next 平台「Open Connections」(连接入口不复刻)。全人工面零 coral。
 *
 * WHATPASS 五章 ads 侧候选:Meta Lead Ads 实时回传 CRM [wave-b] · Conversions API 状态 [wave-b]。
 */

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Panel, ProvenancePill } from "@/components/northstar/analytics/zone-kit";
import { NS_AD_PLATFORMS, type NsAdPlatform } from "@/components/northstar/ads/mock-ads";
import { adSubmissions, connections, useStore } from "@/components/northstar/immersive/_store";
import type { NsConnection } from "@/components/northstar/immersive/account-ops/data";
import { AdsNav, PinnedHeader, ZoneBody } from "./kit";

const STATUS_BADGE: Record<NsAdPlatform["status"], "success" | "info" | "default"> = {
  connected: "success",
  next: "info",
  planned: "default",
};

const PLATFORM_CHANNELS: Record<string, NsConnection["channel"][]> = {
  meta: ["facebook", "instagram"],
  tiktok: ["tiktok"],
};

interface LiveStatus {
  status: NsAdPlatform["status"];
  label: string;
  hint?: string;
}

function liveStatus(platform: NsAdPlatform, conns: NsConnection[]): LiveStatus {
  const channels = PLATFORM_CHANNELS[platform.id];
  if (!channels) return { status: platform.status, label: platform.statusLabel };
  const mapped = conns.filter((c) => channels.includes(c.channel));
  const allConnected = mapped.length > 0 && mapped.every((c) => c.status === "connected");
  if (allConnected) return { status: "connected", label: "Connected" };
  const action = mapped.find((c) => c.status === "action");
  if (action) return { status: "next", label: "Reconnect", hint: action.note };
  return { status: "next", label: "Connect" };
}

function PlatformCard({
  platform,
  live,
  selected,
  pendingCount,
  onSelect,
}: {
  platform: NsAdPlatform;
  live: LiveStatus;
  selected: boolean;
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
        {pendingCount > 0 && <Badge variant="warning">{pendingCount} in review</Badge>}
      </div>
    </button>
  );
}

function AdapterParams({ platform }: { platform: NsAdPlatform }) {
  return (
    <div className="mt-2">
      {platform.params.map((p) => (
        <div key={p.key} className="flex items-baseline gap-3 border-t border-border py-2.5 first:border-t-0">
          <span className="min-w-0 flex-1 text-[13px] leading-[18px] text-muted-foreground">{p.key}</span>
          <span className={cn("shrink-0 font-mono text-xs leading-4 font-medium tracking-[0.02em]", p.value ? "text-foreground" : "text-muted-foreground")}>
            {p.value ?? "—"}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function AdsMultiPlatform() {
  const [platformId, setPlatformId] = React.useState<string>("meta");

  useStore();
  const conns = connections();
  const pendingByPlatform = adSubmissions().reduce<Record<string, number>>((acc, e) => {
    const key = String(e.payload.platform ?? "meta");
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const platform = NS_AD_PLATFORMS.find((p) => p.id === platformId) ?? NS_AD_PLATFORMS[0]!;
  const live = liveStatus(platform, conns);

  return (
    <>
      <PinnedHeader title="Ad platforms" nav={<AdsNav />} provenance={<ProvenancePill text="platform registry · design contract" />}>
        <p className="w-full text-xs text-muted-foreground">One workbench, one adapter per platform. TikTok first, then Lazada, then Shopee.</p>
      </PinnedHeader>

      <ZoneBody>
        <div className="mt-5">
          {/* 平台连接卡 ×4 = 多平台切换器 */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4" role="group" aria-label="Ad platforms">
            {NS_AD_PLATFORMS.map((p) => (
              <PlatformCard key={p.id} platform={p} live={liveStatus(p, conns)} selected={p.id === platformId} pendingCount={pendingByPlatform[p.id] ?? 0} onSelect={() => setPlatformId(p.id)} />
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
                  <Link href="/northstar-immersive/ads/builder">Open ad builder</Link>
                </Button>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/northstar-immersive/ads/performance">View ad performance</Link>
                </Button>
              </div>
            )}

            {live.status === "next" && (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
                <Button asChild variant="secondary" size="sm">
                  <Link href="/northstar-immersive/account/connections">Open Connections</Link>
                </Button>
                <span className="text-xs text-muted-foreground">
                  {live.hint ?? "Connecting happens in Connections. This page lights up by itself after that."}
                </span>
              </div>
            )}

            {live.status === "planned" && (
              <p className="mt-4 border-t border-border pt-4 text-xs text-muted-foreground">
                Planned. The slots above are the whole integration surface, they fill in when this platform connects.
              </p>
            )}
          </Panel>

          {/* [wave-b] Meta Lead Ads 实时回传 CRM + Conversions API 状态展示 */}
          <div className="mt-4 grid gap-3.5 md:grid-cols-2">
            <Panel title="Lead Ads → contacts" actions={<Badge variant={live.status === "connected" ? "success" : "default"}>{live.status === "connected" ? "On" : "Off"}</Badge>}>
              <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">
                When someone fills a lead form, they land in your contacts automatically — tagged with the campaign that
                brought them. No exporting spreadsheets.
              </p>
              <Button asChild variant="ghost" size="sm" className="mt-3">
                <Link href="/northstar-immersive/crm/contacts">See your contacts</Link>
              </Button>
            </Panel>
            <Panel title="Conversions API" actions={<Badge variant="warning">Not set up</Badge>}>
              <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">
                Sends real orders back to Meta so your ads keep getting sharper. A guided setup — no developer docs.
              </p>
              <Button variant="secondary" size="sm" className="mt-3">
                Start setup
              </Button>
            </Panel>
          </div>
        </div>
      </ZoneBody>
    </>
  );
}
