"use client";

import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AtSign,
  Bot,
  Camera,
  ChevronRight,
  CircleAlert,
  Info,
  Megaphone,
  Plug,
  RefreshCw,
  ShieldCheck,
  Unplug,
} from "lucide-react";
import { disconnectMeta, getMetaInsights, type MetaAdAccount } from "@/lib/meta-actions";
import { setAdsAutonomy, setAdsWritesPaused } from "@/lib/otto-client-actions";
import type { AccountInsights } from "@/lib/meta-insights";
import { getAccountViewData } from "@/lib/account-view-data";
import {
  channelCapabilityBlurb,
  channelMeta,
  isMetaBackedChannel,
  publishingChannelRows,
} from "@/lib/channels/channel-meta";
import { CONNECTION_BLOCKER_COPY, connectionsNotice } from "@fikirtive/core/schedule-draft";
import { describeMetaAdAccountStatus } from "@/lib/meta-ad-account-status";
import { supportMailto } from "@/lib/exits";
import type { ChannelState } from "./settings/sections";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { PRODUCT_VOCABULARY } from "@/lib/product-vocabulary";

type MetaState =
  | { phase: "loading" }
  | { phase: "disconnected" }
  | {
      phase: "connected";
      status?: string;
      accounts: MetaAdAccount[];
      canWrite: boolean;
      adsAutonomy: string;
      adsWritesPaused: boolean;
    }
  | { phase: "reconnect" }
  | { phase: "unreachable" };

type ChannelsState =
  | { phase: "loading" }
  | { phase: "error" }
  | { phase: "loaded"; channels: ChannelState[] };

type ConnectErrorCopy = {
  message: string;
  retry: boolean;
  rawCode?: string;
  contactSupport?: boolean;
};

function describeConnectError(code: string): ConnectErrorCopy {
  if (code === "Paused while impersonating a customer — exit impersonation to connect Meta.") {
    return { message: code, retry: false };
  }

  switch (code) {
    case "missing":
      return { message: "Meta sent you back before the connection finished.", retry: true };
    case "state":
      return {
        message:
          "This connect link couldn’t be verified — these links expire, and they only work for the account that started them.",
        retry: true,
      };
    case "not_configured":
      return {
        message:
          "Meta connections aren’t switched on for this server yet — we can switch them on for you.",
        retry: false,
        contactSupport: true,
      };
    case "exchange":
      return { message: "Meta didn’t finish the sign-in handshake.", retry: true };
    case "incomplete":
      return {
        message:
          "Meta didn’t confirm which account you connected, so nothing was saved. Try connecting again.",
        retry: true,
      };
    default:
      return { message: "Meta couldn’t be connected.", retry: true, rawCode: code };
  }
}

const CHANNEL_ICONS: Record<string, LucideIcon> = {
  instagram: Camera,
  facebook: Megaphone,
  x: AtSign,
};

function ChannelIcon({ id }: { id: string }) {
  const Icon = CHANNEL_ICONS[id] ?? Plug;
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground">
      <Icon aria-hidden />
    </span>
  );
}

function ChannelRowsLoading() {
  return (
    <div className="flex flex-col gap-4 py-4" aria-label="Checking channel connections">
      {["one", "two", "three"].map((key) => (
        <div key={key} className="flex items-center gap-3">
          <Skeleton className="size-10 rounded-lg" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-48 max-w-full" />
          </div>
          <Skeleton className="h-9 w-20" />
        </div>
      ))}
    </div>
  );
}

function connectionStatus(row: {
  connectable: boolean;
  state: ChannelState | null;
}): { label: string; variant: "outline" | "success" | "warning" } {
  if (!row.connectable) return { label: "Unavailable", variant: "outline" };
  if (!row.state) return { label: "Status unavailable", variant: "warning" };
  if (row.state.blocker || row.state.status === "needs_reconnect") {
    return { label: "Needs attention", variant: "warning" };
  }
  if (row.state.status === "connected") return { label: "Connected", variant: "success" };
  return { label: "Not connected", variant: "outline" };
}

export default function OttoConnections({ embedded = false }: { embedded?: boolean }) {
  const [meta, setMeta] = useState<MetaState>({ phase: "loading" });
  const [insights, setInsights] = useState<AccountInsights[] | null>(null);
  const [saving, setSaving] = useState<null | "autonomy" | "paused" | "disconnect">(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [channelsState, setChannelsState] = useState<ChannelsState>({ phase: "loading" });
  const [connectErrorCode, setConnectErrorCode] = useState<string | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState("instagram");
  const [addConnectionOpen, setAddConnectionOpen] = useState(false);
  // FRONT-A14／R3-F09：Add connection 弹窗正文整篇都是真动作（每一行一颗 Connect），
  // 而 Base UI `Dialog.Popup` 的 initialFocus 默认值是「popup 里第一颗 tabbable」
  // （`@base-ui/react@1.7.0` dialog/popup/DialogPopup.d.ts:15）。Library 素材详情那种
  // 打开时正文没有可聚焦控件的面，默认值刚好落在 DialogContent 内建的 Close 上；这里
  // 却把焦点直接压在第一颗 Connect 上——商家用键盘打开后随手一个 Enter 就被送进 Meta
  // 授权。开场焦点因此显式落到弹窗自身（Base UI 给它 tabindex="-1"，读屏念的是标题与
  // 「Choose a service…」那句说明），第一次 Tab 才走到 Connect；Escape 回到入口不受影响。
  const addConnectionDialogRef = useRef<HTMLDivElement>(null);

  async function load() {
    setMeta({ phase: "loading" });
    setChannelsState({ phase: "loading" });
    const result = await getAccountViewData().catch(() => ({ error: "load-failed" }) as const);

    if ("error" in result) {
      setMeta({ phase: "disconnected" });
      setChannelsState({ phase: "error" });
      return;
    }

    const res = result.meta;
    if ("error" in res || !res.connected) setMeta({ phase: "disconnected" });
    else if (res.transientError) setMeta({ phase: "unreachable" });
    else if (res.needsReconnect) setMeta({ phase: "reconnect" });
    else {
      setMeta({
        phase: "connected",
        status: res.status,
        accounts: res.accounts ?? [],
        canWrite: res.canWrite ?? false,
        adsAutonomy: res.adsAutonomy ?? "ASK",
        adsWritesPaused: res.adsWritesPaused ?? false,
      });
    }

    setChannelsState({ phase: "loaded", channels: result.channels });
  }

  async function handleAutonomy(mode: "ASK" | "AUTO") {
    if (meta.phase !== "connected") return;
    const previous = meta.adsAutonomy;
    setSaving("autonomy");
    setSaveError(null);
    setMeta((state) => (state.phase === "connected" ? { ...state, adsAutonomy: mode } : state));
    const result = await setAdsAutonomy(mode);
    setSaving(null);
    if ("error" in result) {
      setMeta((state) => (state.phase === "connected" ? { ...state, adsAutonomy: previous } : state));
      setSaveError(result.error);
    }
  }

  async function handlePaused(paused: boolean) {
    if (meta.phase !== "connected") return;
    const previous = meta.adsWritesPaused;
    setSaving("paused");
    setSaveError(null);
    setMeta((state) => (state.phase === "connected" ? { ...state, adsWritesPaused: paused } : state));
    const result = await setAdsWritesPaused(paused);
    setSaving(null);
    if ("error" in result) {
      setMeta((state) => (state.phase === "connected" ? { ...state, adsWritesPaused: previous } : state));
      setSaveError(result.error);
    }
  }

  async function handleDisconnect() {
    setSaving("disconnect");
    setSaveError(null);
    const result = await disconnectMeta();
    setSaving(null);
    if ("error" in result) {
      setSaveError(result.error);
      return;
    }
    setInsights(null);
    void load();
  }

  useEffect(() => {
    queueMicrotask(() => void load());
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      const rawSearch = window.location.search;
      const code = new URLSearchParams(rawSearch).get("error");
      if (!code) return;
      setConnectErrorCode(code);
      const kept = rawSearch
        .replace(/^\?/, "")
        .split("&")
        .filter((part) => part !== "error" && !part.startsWith("error="));
      const nextSearch = kept.length > 0 ? `?${kept.join("&")}` : "";
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${nextSearch}${window.location.hash}`,
      );
    });
  }, []);

  useEffect(() => {
    if (meta.phase !== "connected") return;
    void getMetaInsights("last_30d").then((result) => {
      if ("accounts" in result) setInsights(result.accounts);
    });
  }, [meta.phase]);

  const publishingLoading = channelsState.phase === "loading" || meta.phase === "loading";
  const connectError = connectErrorCode ? describeConnectError(connectErrorCode) : null;
  const loadedChannels = channelsState.phase === "loaded" ? channelsState.channels : [];
  const connectionRows = publishingChannelRows(loadedChannels);
  const selectedRow = connectionRows.find((row) => row.id === selectedChannelId) ?? connectionRows[0];
  const selectedState = selectedRow?.state ?? null;
  const selectedBlocked = selectedState?.blocker
    ?? (selectedState?.status === "needs_reconnect" ? "needs_reconnect" : null);
  const selectedMetaBacked = selectedRow ? isMetaBackedChannel(selectedRow.id) : false;
  // Gate ① of the top-of-page notice, read off the SAME rows this screen draws its Connect
  // buttons from — `connectable` comes from CHANNEL_META, not from the network read, so this
  // answer is the same while loading, after an error, and once loaded. Gate ② (PUBLISHING_AVAILABLE)
  // is the function's own default. See connectionsNotice() for why it takes two.
  const canConnectMetaAccount = connectionRows.some((row) => isMetaBackedChannel(row.id) && row.connectable);
  const previewNotice = connectionsNotice(canConnectMetaAccount);
  const connectedCount = connectionRows.filter(
    (row) => row.connectable && row.state?.status === "connected" && !row.state.blocker,
  ).length;
  const needsAttention = connectionRows.some(
    (row) => row.connectable && (row.state?.blocker || row.state?.status === "needs_reconnect"),
  );

  return (
    <div className={embedded ? "min-w-0" : "flex-1 overflow-auto"}>
      <div className={embedded ? "flex min-w-0 flex-col gap-6" : "mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8"}>
        {!embedded ? (
          <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex max-w-2xl flex-col gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Connections</h1>
              <p className="text-sm leading-6 text-muted-foreground">
                Connect the services Fikirtive can use across this workspace.
              </p>
            </div>
          </header>
        ) : null}

        {/* 规格 `docs/specs/wave2-shell.md:394-395` 点名要的那一句;口径订正(两道闸而不是一道)
            登记在 `docs/specs/frontend-baseline.md` §5 的 2026-09-16 R3-F14 行。措辞和「说不说」
            都向核心权威要(`connectionsNotice()`),所以这扇屏幕上没有第二份可抄的文案;两道闸
            都开那天它自己消失,不靠谁记得回来删屏幕上的一行。
            它说的是**这一页今天能不能连、连上了发不发得出去**,两件事各有答案;右边详情面板那句
            “This service is not available to connect.” 是 X 一个服务自己的事。两句各说各的,
            谁也不复述谁。standing explanation 不戴 role(见 `components/ui/alert.tsx` 顶注)。 */}
        {previewNotice ? (
          <Alert variant="info">
            <Info aria-hidden />
            <AlertDescription>
              <p>{previewNotice}</p>
            </AlertDescription>
          </Alert>
        ) : null}

        {connectError ? (
          <Alert role="alert" variant="destructive">
            <CircleAlert aria-hidden />
            <AlertTitle>Meta connection failed</AlertTitle>
            <AlertDescription>
              <p>{connectError.message}</p>
              {connectError.rawCode ? <p>Details: {connectError.rawCode}</p> : null}
              {connectError.retry ? (
                <Button asChild size="sm"><a href="/api/meta/authorize">Try again</a></Button>
              ) : null}
              {connectError.contactSupport ? (
                <Button asChild size="sm"><a href={supportMailto("Switch on Meta connections")}>Email support</a></Button>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          {publishingLoading ? (
            <Badge><Spinner aria-hidden />Checking connections</Badge>
          ) : channelsState.phase === "error" ? (
            <Badge variant="warning">Status unavailable</Badge>
          ) : needsAttention ? (
            <Badge variant="warning">Needs attention</Badge>
          ) : connectedCount > 0 ? (
            <Badge variant="success">{connectedCount} connected</Badge>
          ) : (
            <Badge variant="outline">Nothing connected</Badge>
          )}
          <Button type="button" size="sm" variant="secondary" onClick={() => setAddConnectionOpen(true)}>
            <Plug data-icon="inline-start" aria-hidden />
            Add connection
          </Button>
        </div>

        <div className="grid min-h-[520px] overflow-hidden rounded-[var(--radius-card)] border border-border bg-card lg:grid-cols-[320px_minmax(0,1fr)]">
          <section data-section="publishing" className="border-b border-border p-4 lg:border-b-0 lg:border-r" aria-label="Connected services">
            <p className="mb-3 px-2 text-xs font-semibold text-muted-foreground">Services</p>
            {publishingLoading ? (
              <ChannelRowsLoading />
            ) : channelsState.phase === "error" ? (
              <Alert variant="warning">
                <CircleAlert aria-hidden />
                <AlertTitle>Could not load connections</AlertTitle>
                <AlertDescription>
                  <p>Your saved connections were not changed.</p>
                  <Button type="button" size="sm" variant="outline" onClick={() => void load()}>
                    <RefreshCw data-icon="inline-start" aria-hidden />
                    Retry
                  </Button>
                </AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-1">
                {connectionRows.map((row) => {
                  const status = connectionStatus(row);
                  const selected = row.id === selectedRow?.id;
                  return (
                    <Button
                      key={row.id}
                      data-channel={row.id}
                      type="button"
                      variant="ghost"
                      motion="instant"
                      aria-pressed={selected}
                      aria-label={`View ${row.label} connection`}
                      className={cn(
                        "h-auto w-full justify-start rounded-lg border border-transparent px-3 py-3 text-left font-normal",
                        selected && "border-foreground/60 bg-background shadow-xs",
                      )}
                      onClick={() => setSelectedChannelId(row.id)}
                    >
                      <ChannelIcon id={row.id} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{row.label}</span>
                        <span className="mt-1 block"><Badge variant={status.variant}>{status.label}</Badge></span>
                      </span>
                      <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                    </Button>
                  );
                })}
              </div>
            )}
          </section>

          <section className="min-w-0 px-5 py-6 sm:px-7" aria-live="polite">
            {selectedRow ? (
              <div className="mx-auto flex max-w-3xl flex-col gap-7">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex items-start gap-4">
                    <ChannelIcon id={selectedRow.id} />
                    <div>
                      <h2 className="text-xl font-semibold tracking-[-0.025em]">{selectedRow.label}</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {selectedState?.targets.join(", ") || (selectedRow.connectable ? "No account linked" : "This service is not available to connect.")}
                      </p>
                      <div className="mt-2"><Badge variant={connectionStatus(selectedRow).variant}>{connectionStatus(selectedRow).label}</Badge></div>
                    </div>
                  </div>
                  {selectedRow.connectable && selectedState ? (
                    <Button asChild size="sm" variant={selectedState.status === "connected" && !selectedBlocked ? "secondary" : "default"}>
                      <a href={selectedState.connectUrl}>
                        {selectedBlocked ? "Reconnect" : selectedState.status === "connected" ? "Manage" : "Connect"}
                      </a>
                    </Button>
                  ) : selectedRow.connectable ? (
                    <Button type="button" size="sm" variant="outline" onClick={() => void load()}>
                      <RefreshCw data-icon="inline-start" aria-hidden />Retry status
                    </Button>
                  ) : null}
                </div>

                <div className="border-y border-border">
                  <div className="grid gap-2 border-b border-border py-5 sm:grid-cols-[180px_minmax(0,1fr)]">
                    <h3 className="text-sm font-semibold">{`${PRODUCT_VOCABULARY.workspace} access`}</h3>
                    <p className="text-sm text-muted-foreground">Available to everyone in this workspace.</p>
                  </div>
                  <div className="grid gap-2 border-b border-border py-5 sm:grid-cols-[180px_minmax(0,1fr)]">
                    <h3 className="text-sm font-semibold">Connection health</h3>
                    <div className="text-sm text-muted-foreground">
                      {selectedBlocked ? CONNECTION_BLOCKER_COPY[selectedBlocked].status : connectionStatus(selectedRow).label}
                    </div>
                  </div>
                  <div className="grid gap-2 py-5 sm:grid-cols-[180px_minmax(0,1fr)]">
                    <h3 className="text-sm font-semibold">Data available</h3>
                    <p className="text-sm text-muted-foreground">
                      {channelMeta(selectedRow.id)?.capabilities
                        ? channelCapabilityBlurb(channelMeta(selectedRow.id)!.capabilities)
                        : "No data available"}
                    </p>
                  </div>
                </div>

                {selectedMetaBacked && (meta.phase === "connected" || meta.phase === "unreachable") ? (
                  <Card size="sm">
                    <CardHeader>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <Badge variant="otto-soft"><Bot aria-hidden />Otto control</Badge>
                        {meta.phase === "connected" ? (
                          <Badge variant={meta.adsWritesPaused ? "destructive" : "success"}>
                            {meta.adsWritesPaused ? "Changes paused" : "Ready"}
                          </Badge>
                        ) : null}
                      </div>
                      <CardTitle>Meta ad accounts</CardTitle>
                      <CardDescription>Accounts visible through the same Meta connection.</CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-5">
                      {meta.phase === "unreachable" ? (
                        <Alert variant="warning">
                          <CircleAlert aria-hidden />
                          <AlertTitle>Meta is temporarily unavailable</AlertTitle>
                          <AlertDescription>
                            <p>Your saved connection is still intact.</p>
                            <Button type="button" size="sm" variant="outline" onClick={() => void load()}>
                              <RefreshCw data-icon="inline-start" aria-hidden />Retry
                            </Button>
                          </AlertDescription>
                        </Alert>
                      ) : null}

                      {meta.phase === "connected" ? (
                        <>
                          <Table aria-label="Meta ad accounts">
                            <TableBody>
                              {meta.accounts.map((account) => {
                                const insight = insights?.find((item) => item.accountId === account.id);
                                const metrics = insight?.metrics;
                                const statusView = describeMetaAdAccountStatus(account.status);
                                const badgeVariant = statusView?.tone === "attention" ? "destructive" : statusView?.label === "Active" ? "success" : "outline";
                                return (
                                  <TableRow key={account.id}>
                                    <TableCell className="whitespace-normal">
                                      <div className="grid min-w-0 gap-2 py-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                                        <span className="truncate font-medium text-foreground">{account.name || account.id}</span>
                                        <Badge variant={badgeVariant}>{account.currency}{statusView ? ` · ${statusView.label}` : ""}</Badge>
                                        {statusView?.detail ? <span className="text-xs leading-5 text-destructive sm:col-span-2">{statusView.detail}</span> : null}
                                        {metrics ? (
                                          <span className="text-xs leading-5 text-muted-foreground sm:col-span-2">
                                            {metrics.spend ? `Spent ${metrics.spend}` : "—"} · {metrics.impressions ?? "—"} impressions · CTR {metrics.ctr ?? "—"}% · CPC {metrics.cpc ?? "—"} · {metrics.purchaseRoas ? `ROAS ${metrics.purchaseRoas}` : "no conversion tracking"}
                                          </span>
                                        ) : null}
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                          <Separator />
                          {meta.canWrite ? (
                            <div className="flex flex-col gap-5">
                              <div className="flex flex-col gap-3">
                                <div>
                                  <span className="font-medium text-foreground">Otto autonomy</span>
                                  <p className="mt-1 text-sm leading-6 text-muted-foreground">Ask (default) — Otto always asks before making changes. Auto lets Otto pause ads, lower budgets, and create paused draft campaigns in your ad account without asking you — anything that spends or goes live still asks you first.</p>
                                </div>
                                <ToggleGroup
                                  type="single"
                                  variant="outline"
                                  value={meta.adsAutonomy}
                                  disabled={saving === "autonomy"}
                                  aria-label="Otto autonomy"
                                  onValueChange={(value) => {
                                    if (value === "ASK" || value === "AUTO") void handleAutonomy(value);
                                  }}
                                >
                                  <ToggleGroupItem value="ASK">Ask</ToggleGroupItem>
                                  <ToggleGroupItem value="AUTO">Auto</ToggleGroupItem>
                                </ToggleGroup>
                              </div>
                              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                  <span className="font-medium text-foreground">Pause all ad changes</span>
                                  <p className="mt-1 text-sm text-muted-foreground">Otto cannot change any ad until you resume.</p>
                                </div>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant={meta.adsWritesPaused ? "default" : "destructive-secondary"}
                                  disabled={saving === "paused"}
                                  onClick={() => void handlePaused(!meta.adsWritesPaused)}
                                >
                                  {saving === "paused" ? <Spinner data-icon="inline-start" aria-hidden /> : null}
                                  {meta.adsWritesPaused ? "Resume" : "Pause"}
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <Alert variant="warning">
                              <ShieldCheck aria-hidden />
                              <AlertTitle>Ad management permission is missing</AlertTitle>
                              <AlertDescription><p>Reconnect Meta to let Otto manage ads.</p></AlertDescription>
                            </Alert>
                          )}
                          {saveError ? (
                            <Alert role="alert" variant="destructive">
                              <CircleAlert aria-hidden />
                              <AlertTitle>Could not update Meta access</AlertTitle>
                              <AlertDescription>{saveError}</AlertDescription>
                            </Alert>
                          ) : null}
                        </>
                      ) : null}
                    </CardContent>
                    {meta.phase === "connected" ? (
                      <CardFooter>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button type="button" size="sm" variant="destructive-secondary"><Unplug aria-hidden />Disconnect Meta</Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Disconnect Meta?</AlertDialogTitle>
                              <AlertDialogDescription>Instagram, Facebook, ad-account insights, and Otto ad controls will stop working until you reconnect. Existing creative work stays saved.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel disabled={saving === "disconnect"}>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                disabled={saving === "disconnect"}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                onClick={() => void handleDisconnect()}
                              >
                                {saving === "disconnect" ? <Spinner data-icon="inline-start" aria-hidden /> : null}
                                Disconnect Meta
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </CardFooter>
                    ) : null}
                  </Card>
                ) : null}
              </div>
            ) : null}
          </section>
        </div>

        <Dialog open={addConnectionOpen} onOpenChange={setAddConnectionOpen}>
          <DialogContent ref={addConnectionDialogRef} initialFocus={addConnectionDialogRef}>
            <DialogHeader>
              <DialogTitle>Add connection</DialogTitle>
              <DialogDescription>Choose a service to make its approved data available across this workspace.</DialogDescription>
            </DialogHeader>
            <div className="divide-y divide-border overflow-hidden rounded-[var(--radius-card)] border border-border">
              {connectionRows.map((row) => {
                const status = connectionStatus(row);
                return (
                  <div key={row.id} className="flex items-center gap-3 px-4 py-3.5">
                    <ChannelIcon id={row.id} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{row.label}</p>
                      <p className="text-xs text-muted-foreground">{status.label}</p>
                    </div>
                    {!row.connectable ? (
                      <Badge variant="outline">Unavailable</Badge>
                    ) : !row.state ? (
                      <Button type="button" size="sm" variant="outline" onClick={() => void load()}>Retry</Button>
                    ) : row.state.status === "connected" && !row.state.blocker ? (
                      <Badge variant="success">Connected</Badge>
                    ) : (
                      <Button asChild size="sm"><a href={row.state.connectUrl}>Connect</a></Button>
                    )}
                  </div>
                );
              })}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
