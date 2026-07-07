"use client";

/**
 * Connections 渠道连接页
 * 全部渠道一页管理:Meta(连接/重连/自治开关/kill-switch)、X(用户 OAuth,零 API key 感)、
 * 未来平台卡位(TikTok/Shopee/Lazada/WhatsApp)。registry 驱动:一张卡模板,零 per-channel 分叉。
 * §O3:此页无 inline Otto avatar — dock only(连接是用户的身份决定)。
 * §F7:自治开关即时生效(人类动作,checked = INK,非 coral)。
 * kill-switch = tier 2 破坏性(§FB6):OttoConfirm 型对话框 + 影响清单 + 红字主按钮。
 * 布局:§L2 Detail 型单列 880。三态齐全。
 */

import * as React from "react";
import {
  Check,
  Link2,
  Link2Off,
  Plus,
  RefreshCw,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MockNote, PageHeader } from "@/components/northstar/_shared";
import { DemoStateBar, ErrorPanel, Skeleton, SweepIn, type DemoState } from "./_bits";
import { CHANNELS, type Channel, type ConnStatus, fmtDateTime } from "./_data";

const STATUS_BADGE: Record<
  ConnStatus,
  { label: string; variant: "success" | "warning" | "default" | "outline" }
> = {
  connected: { label: "Connected", variant: "success" },
  needs_reconnect: { label: "Needs reconnect", variant: "warning" },
  disconnected: { label: "Not connected", variant: "outline" },
  coming_soon: { label: "Coming soon", variant: "default" },
};

/** 渠道字标(纯字形,零外链;方形 soft 底 + 首字母) */
function ChannelGlyph({ name, muted }: { name: string; muted?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-[12px] text-base font-bold",
        muted ? "bg-muted text-muted-foreground" : "bg-secondary text-foreground",
      )}
    >
      {name[0]}
    </span>
  );
}

function ChannelCard({
  channel,
  onKillSwitch,
  onReconnect,
  onConnect,
  reconnecting,
}: {
  channel: Channel;
  onKillSwitch: (c: Channel) => void;
  onReconnect: (id: string) => void;
  onConnect: (id: string) => void;
  reconnecting: boolean;
}) {
  const [autonomy, setAutonomy] = React.useState<boolean>(channel.autonomy ?? false);
  const badge = STATUS_BADGE[channel.status];
  const soon = channel.status === "coming_soon";
  const connected = channel.status === "connected";
  const needsReconnect = channel.status === "needs_reconnect";

  return (
    <div
      className={cn(
        "flex flex-col rounded-[16px] border bg-card p-5",
        needsReconnect ? "border-warning/40" : "border-border",
      )}
    >
      <div className="flex items-start gap-3">
        <ChannelGlyph name={channel.name} muted={soon} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <p className="text-base font-semibold text-foreground">{channel.name}</p>
            <Badge variant={badge.variant}>{badge.label}</Badge>
          </div>
          {channel.accounts.length > 0 ? (
            <p className="text-[13px] text-muted-foreground">
              {channel.accounts.map((a) => a.handle).join(" · ")}
            </p>
          ) : (
            <p className="text-[13px] text-muted-foreground">{channel.note}</p>
          )}
        </div>
      </div>

      {/* 已连接账号明细 + 授权范围 */}
      {channel.accounts.length > 0 && (
        <div className="mt-4 flex flex-col gap-2 rounded-[12px] bg-secondary/60 p-3">
          {channel.accounts.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-3">
              <span className="truncate text-[13px] font-medium text-foreground">{a.handle}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{a.kind}</span>
            </div>
          ))}
        </div>
      )}

      {channel.grants.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {channel.grants.map((g) => (
            <li key={g} className="flex items-start gap-2 text-xs text-muted-foreground">
              <Check className="mt-0.5 size-3.5 shrink-0 text-success-soft-foreground" strokeWidth={2} />
              {g}
            </li>
          ))}
        </ul>
      )}

      {channel.connectedAt && (
        <p className="mt-3 font-mono text-[11px] leading-[14px] font-medium text-muted-foreground">
          Connected {fmtDateTime(channel.connectedAt)}
        </p>
      )}

      {needsReconnect && channel.note && (
        <div
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-[12px] bg-warning-soft px-3 py-2.5"
        >
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning-soft-foreground" strokeWidth={2} />
          <p className="text-xs leading-[16px] font-medium text-warning-soft-foreground">
            {channel.note}
          </p>
        </div>
      )}

      {/* Otto 自治开关(仅支持自治且已连接;§F7 即时生效) */}
      {connected && channel.supportsAutonomy && (
        <div className="mt-4 flex items-start justify-between gap-3 border-t border-border pt-4">
          <label htmlFor={`autonomy-${channel.id}`} className="flex min-w-0 flex-1 flex-col">
            <span className="text-[13px] font-semibold text-foreground">Let Otto act here</span>
            <span className="mt-0.5 text-xs text-muted-foreground">
              {autonomy
                ? "Otto replies and posts on its own. You still see everything."
                : "Otto only drafts. Nothing goes out without your approval."}
            </span>
          </label>
          <Switch
            id={`autonomy-${channel.id}`}
            checked={autonomy}
            onCheckedChange={setAutonomy}
            aria-label={`Let Otto act on ${channel.name}`}
          />
        </div>
      )}

      {/* 动作行 */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {connected && (
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onReconnect(channel.id)}
              disabled={reconnecting}
            >
              <RefreshCw className="size-4" strokeWidth={2} />
              {reconnecting ? "Refreshing…" : "Refresh"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onKillSwitch(channel)}>
              <Link2Off className="size-4" strokeWidth={2} />
              Disconnect
            </Button>
          </>
        )}
        {needsReconnect && (
          <Button size="sm" onClick={() => onConnect(channel.id)} disabled={reconnecting}>
            <RefreshCw className="size-4" strokeWidth={2} />
            {reconnecting ? "Reconnecting…" : "Reconnect"}
          </Button>
        )}
        {channel.status === "disconnected" && (
          <Button size="sm" onClick={() => onConnect(channel.id)}>
            <Link2 className="size-4" strokeWidth={2} />
            Connect
          </Button>
        )}
        {soon && (
          <Button variant="secondary" size="sm" disabled>
            <Plus className="size-4" strokeWidth={2} />
            Notify me
          </Button>
        )}
      </div>
    </div>
  );
}

export function ConnectionsPage() {
  const [demo, setDemo] = React.useState<DemoState>("normal");
  const [killTarget, setKillTarget] = React.useState<Channel | null>(null);
  const [killing, setKilling] = React.useState(false);
  const [disconnected, setDisconnected] = React.useState<Set<string>>(new Set());
  const [reconnectingId, setReconnectingId] = React.useState<string | null>(null);
  const [flash, setFlash] = React.useState<string | null>(null);
  const timers = React.useRef<number[]>([]);

  React.useEffect(
    () => () => {
      timers.current.forEach((t) => window.clearTimeout(t));
    },
    [],
  );

  const channels: Channel[] = CHANNELS.map((c) =>
    disconnected.has(c.id)
      ? { ...c, status: "disconnected", accounts: [], grants: [], connectedAt: undefined, autonomy: false }
      : c,
  );

  const activeCount = channels.filter((c) => c.status === "connected").length;

  const confirmKill = () => {
    if (!killTarget) return;
    setKilling(true);
    const t = window.setTimeout(() => {
      setDisconnected((prev) => new Set(prev).add(killTarget.id));
      setKilling(false);
      setFlash(`${killTarget.name} disconnected. Otto stopped acting there.`);
      setKillTarget(null);
      const clear = window.setTimeout(() => setFlash(null), 4000);
      timers.current.push(clear);
    }, 900);
    timers.current.push(t);
  };

  const handleReconnect = (id: string) => {
    setReconnectingId(id);
    const t = window.setTimeout(() => {
      setDisconnected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setReconnectingId(null);
    }, 1200);
    timers.current.push(t);
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 pt-6 pb-10">
      <PageHeader
        title="Connections"
        subtitle="Connect your channels so Otto can read messages and post what you approve."
        meta={demo === "normal" ? [`${activeCount} connected`] : undefined}
      />

      {flash && (
        <SweepIn className="mt-4">
          <div
            role="status"
            className="flex items-center gap-2 rounded-[12px] bg-secondary/70 px-4 py-2.5 text-[13px] font-medium text-foreground"
          >
            <Link2Off className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
            {flash}
          </div>
        </SweepIn>
      )}

      <div className="mt-6 flex flex-1 flex-col">
        {demo === "loading" && (
          <div role="status" aria-label="Loading" className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex flex-col gap-3 rounded-[16px] border border-border bg-card p-5">
                <div className="flex items-center gap-3">
                  <Skeleton shimmer={i < 3} className="size-11 rounded-[12px]" />
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Skeleton shimmer={i < 3} className="h-4 w-24" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                </div>
                <Skeleton className="h-16 w-full rounded-[12px]" />
                <Skeleton className="h-8 w-28" />
              </div>
            ))}
          </div>
        )}

        {demo === "error" && (
          <ErrorPanel
            message="Couldn't load your connections. Try again."
            onRetry={() => setDemo("normal")}
          />
        )}

        {demo === "normal" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {channels.map((c) => (
              <ChannelCard
                key={c.id}
                channel={c}
                onKillSwitch={setKillTarget}
                onReconnect={handleReconnect}
                onConnect={handleReconnect}
                reconnecting={reconnectingId === c.id}
              />
            ))}
          </div>
        )}
      </div>

      {/* kill-switch 确认(§FB6 tier 2:影响清单 + 红字主按钮) */}
      <Dialog
        open={!!killTarget}
        onOpenChange={(o) => {
          if (!o && !killing) setKillTarget(null);
        }}
      >
        <DialogContent className="max-w-[min(440px,calc(100vw-2rem))]">
          <DialogHeader>
            <div className="flex size-12 items-center justify-center rounded-[16px] bg-error-soft">
              <ShieldAlert className="size-6 text-error-soft-foreground" strokeWidth={2} />
            </div>
            <DialogTitle>Disconnect {killTarget?.name}?</DialogTitle>
            <DialogDescription>You can reconnect any time. Nothing is deleted.</DialogDescription>
          </DialogHeader>
          <div className="rounded-[14px] bg-secondary/70 p-4">
            <p className="text-xs font-semibold text-foreground">What happens</p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {[
                `Otto stops reading and posting on ${killTarget?.name}.`,
                "Scheduled posts to this channel are paused.",
                "Your past posts and messages stay where they are.",
              ].map((line) => (
                <li key={line} className="flex items-start gap-2 text-[13px] text-muted-foreground">
                  <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-muted-foreground" />
                  {line}
                </li>
              ))}
            </ul>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setKillTarget(null)} disabled={killing}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmKill} disabled={killing}>
              {killing ? "Disconnecting…" : `Disconnect ${killTarget?.name ?? ""}`.trim()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MockNote path="/northstar/account/connections" />
      <DemoStateBar
        state={demo}
        onChange={setDemo}
        states={[
          { key: "normal", label: "正常" },
          { key: "loading", label: "加载" },
          { key: "error", label: "错误" },
        ]}
      />
    </div>
  );
}
