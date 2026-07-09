"use client";

/**
 * 连接 —— 每个渠道的连接状态与健康度。Meta(IG+FB)一处授权、X 单独、WhatsApp、TikTok。
 * 连接动作走一个内联的授权确认(mock OAuth,不落死链);连上后有个真去处:
 * IG/FB/X → schedule 排期,WhatsApp → inbox 收信。§D4 hairline 行 + §N3 状态色。
 */

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/northstar/_shared";
import { connectChannel, connections, disconnectChannel, useStore } from "../_store";
import { ACCOUNT_OPS_BASE as BASE, AccountNav, Card, CardHeader, ChannelTag, CHANNELS, type NsChannel } from "./kit";
import { type NsConnection } from "./data";

const USE_HREF: Record<NsConnection["channel"], { href: string; label: string }> = {
  instagram: { href: `${BASE}/schedule/plan`, label: "Schedule a post" },
  facebook: { href: `${BASE}/schedule/plan`, label: "Schedule a post" },
  x: { href: `${BASE}/schedule/plan`, label: "Schedule a post" },
  tiktok: { href: `${BASE}/schedule/plan`, label: "Schedule a post" },
  whatsapp: { href: `${BASE}/inbox/shared`, label: "Open inbox" },
};

function StatusBadge({ status }: { status: NsConnection["status"] }) {
  if (status === "connected") return <Badge variant="success">Connected</Badge>;
  if (status === "action") return <Badge variant="warning">Needs attention</Badge>;
  return <Badge variant="outline">Not connected</Badge>;
}

function ConnectionRow({
  conn,
  onConnect,
  onDisconnect,
}: {
  conn: NsConnection;
  onConnect: (channel: NsChannel) => void;
  onDisconnect: (channel: NsChannel) => void;
}) {
  const meta = CHANNELS[conn.channel];
  const status = conn.status;
  return (
    <div className="flex items-center gap-3 border-t border-border px-4 py-3.5 first:border-t-0">
      <ChannelTag channel={conn.channel} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-sm font-semibold text-foreground">{meta.label}</p>
          {status === "connected" && <span className="truncate text-xs text-muted-foreground">{meta.handle}</span>}
        </div>
        <p
          className={
            "mt-0.5 truncate text-xs " +
            (status === "action" ? "text-warning-soft-foreground" : "text-muted-foreground")
          }
        >
          {conn.note}
        </p>
      </div>
      <StatusBadge status={status} />
      {status === "connected" ? (
        <>
          <Button variant="ghost" size="sm" asChild>
            <Link href={USE_HREF[conn.channel].href}>
              {USE_HREF[conn.channel].label}
              <ArrowRight strokeWidth={2} />
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => onDisconnect(conn.channel)}
          >
            Disconnect
          </Button>
        </>
      ) : (
        <Button variant={status === "action" ? "default" : "secondary"} size="sm" onClick={() => onConnect(conn.channel)}>
          {status === "action" ? "Reconnect" : "Connect"}
        </Button>
      )}
    </div>
  );
}

export function AccountConnections() {
  useStore();
  const conns = connections();
  const [dialogChannel, setDialogChannel] = React.useState<NsChannel | null>(null);
  const [disconnectTarget, setDisconnectTarget] = React.useState<NsChannel | null>(null);
  const [pending, setPending] = React.useState(false);

  const meta = conns.filter((c) => CHANNELS[c.channel].group === "meta");
  const others = conns.filter((c) => CHANNELS[c.channel].group !== "meta");

  const openConnect = (channel: NsChannel) => setDialogChannel(channel);

  const confirmConnect = () => {
    if (!dialogChannel) return;
    setPending(true);
    const channel = dialogChannel;
    // Meta 一处授权同时点亮 IG + FB
    const toLight: NsChannel[] =
      CHANNELS[channel].group === "meta" ? ["instagram", "facebook"] : [channel];
    window.setTimeout(() => {
      toLight.forEach((c) => connectChannel(c));
      setPending(false);
      setDialogChannel(null);
    }, 800);
  };

  const confirmDisconnect = () => {
    if (!disconnectTarget) return;
    disconnectChannel(disconnectTarget);
    setDisconnectTarget(null);
  };

  const dialogMeta = dialogChannel ? CHANNELS[dialogChannel] : null;
  const isMeta = dialogChannel ? CHANNELS[dialogChannel].group === "meta" : false;
  const disconnectMeta = disconnectTarget ? CHANNELS[disconnectTarget] : null;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Connections"
        subtitle="Link your channels once. Otto publishes, listens, and replies from here."
        actions={<AccountNav />}
      />

      <div className="mt-6 flex flex-col gap-6">
        <Card>
          <CardHeader
            title="Meta"
            desc="Instagram and Facebook share one Meta login."
            action={
              <Button variant="secondary" size="sm" onClick={() => openConnect("instagram")}>
                <Plug strokeWidth={2} />
                Manage Meta
              </Button>
            }
          />
          {meta.map((c) => (
            <ConnectionRow key={c.channel} conn={c} onConnect={openConnect} onDisconnect={setDisconnectTarget} />
          ))}
        </Card>

        <Card>
          <CardHeader title="Other channels" />
          {others.map((c) => (
            <ConnectionRow key={c.channel} conn={c} onConnect={openConnect} onDisconnect={setDisconnectTarget} />
          ))}
        </Card>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        WhatsApp conversation fees live in{" "}
        <Link href={`${BASE}/account/channel-wallet`} className="font-semibold text-foreground hover:underline">
          channel fees
        </Link>
        . Generation credits are one shared wallet in{" "}
        <Link href={`${BASE}/account/credits`} className="font-semibold text-foreground hover:underline">
          credits
        </Link>
        .
      </p>

      <Dialog open={dialogChannel !== null} onOpenChange={(open) => !open && !pending && setDialogChannel(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect {isMeta ? "Meta" : dialogMeta?.label}</DialogTitle>
            <DialogDescription>
              {isMeta
                ? "You'll sign in to Meta and pick which Instagram and Facebook pages Otto can use."
                : `You'll sign in to ${dialogMeta?.label} and approve publishing access for Otto.`}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-[14px] bg-secondary/70 p-3 text-[13px] leading-[18px] text-foreground">
            Otto never posts without your approval. You can disconnect any time.
          </div>
          <DialogFooter className="flex-row justify-end gap-3">
            <Button variant="secondary" size="sm" disabled={pending} onClick={() => setDialogChannel(null)}>
              Cancel
            </Button>
            <Button size="sm" disabled={pending} onClick={confirmConnect}>
              {pending ? "Connecting…" : `Continue to ${isMeta ? "Meta" : dialogMeta?.label}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={disconnectTarget !== null} onOpenChange={(open) => !open && setDisconnectTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect {disconnectMeta?.label}?</DialogTitle>
            <DialogDescription>
              Otto stops publishing and listening on {disconnectMeta?.label}. Scheduled posts for this channel will pause until you reconnect.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-row justify-end gap-3">
            <Button variant="secondary" size="sm" onClick={() => setDisconnectTarget(null)}>
              Keep connected
            </Button>
            <Button variant="destructive" size="sm" onClick={confirmDisconnect}>
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
