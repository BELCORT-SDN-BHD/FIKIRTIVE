"use client";
/* eslint-disable react-hooks/set-state-in-effect -- Non-production R22 fixtures restore browser-scoped drafts after hydration. */
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  BriefcaseBusiness,
  Camera,
  Check,
  ChevronDown,
  Info,
  LockKeyhole,
  LoaderCircle,
  MessageCircle,
  Music2,
  Plus,
  type LucideIcon,
} from "lucide-react";
import { HOME_COPY, readOk, type HomeData } from "./home-data";
import type { MetaConnectionResult } from "@/lib/meta-actions";
import type { Read } from "./home-data";
import { readR22WorkspaceDirectory } from "@/components/r22/r22-workspace-fixture";
import "./r22-home.css";

const CHANNELS: Array<{ label: string; icon: LucideIcon; recommended?: boolean; available: boolean }> = [
  { label: "Instagram", icon: Camera, recommended: true, available: true },
  { label: "Facebook", icon: MessageCircle, available: true },
  { label: "TikTok", icon: Music2, available: false },
  { label: "LinkedIn", icon: BriefcaseBusiness, available: false },
];

export type HomeConnection =
  | { kind: "unknown"; message: string }
  | { kind: "not_connected" }
  | { kind: "needs_reconnect" }
  | { kind: "connected"; accountLabel: string; transient: boolean }
  | { kind: "verified_fixture"; accountLabel: string };

type ConnectFlow = {
  channel: string;
  step: "permissions" | "profile" | "submitting" | "error" | "success";
};

export function homeConnectionFromMeta(meta: Read<MetaConnectionResult>): HomeConnection {
  if (!meta.ok || "error" in meta.value) {
    return { kind: "unknown", message: HOME_COPY.connectionStatusUnreadable };
  }
  if (!meta.value.connected) return { kind: "not_connected" };
  if (meta.value.needsReconnect || meta.value.status === "expired") return { kind: "needs_reconnect" };
  const account = meta.value.accounts?.[0];
  return {
    kind: "connected",
    accountLabel: account?.name || "Meta account",
    transient: meta.value.transientError === true,
  };
}

const ANALYSIS_ITEMS = [
  { label: "Top content", copy: "Identify your best performing content and formats" },
  { label: "Audience response", copy: "Understand what resonates with your audience" },
  { label: "Publishing rhythm", copy: "Find your optimal posting times and consistency" },
] as const;

/** 一行步进器的四步。标签常驻,说明句只在「这是当前这一步」时渲染一句(见渲染处)——
 *  四句原文都留在这里,不是被删掉了,是版面上同一时刻只站得下一句。 */
const CONNECTION_STEPS = [
  { label: "Not connected", description: "Choose a channel to get started" },
  { label: "Verifying", description: "We’ll securely verify your access" },
  { label: "Syncing data", description: "We’ll import your publishing history" },
  { label: "Ready", description: "Otto will learn and surface insights" },
] as const;

/** 一行步进器本体 —— 两处消费者(ready 态右栏 / connect-first 态卡内一行)共用同一份
 *  渲染逻辑,当前步带说明、其余仅标签,不因为搬家而分叉成两份实现。 */
function ConnectionStepper({ currentStep }: { currentStep: number }) {
  return (
    <div className="r22-home-stepper" role="list" aria-label="Connection progress">
      {CONNECTION_STEPS.map((step, index) => {
        const isCurrent = index === currentStep;
        const isDone = index < currentStep;
        return (
          <span key={step.label} className={`r22-home-stepper-step${isCurrent ? " is-current" : ""}${isDone ? " is-done" : ""}`} role="listitem">
            {isDone ? null : <i aria-hidden="true" />}
            <b>{step.label}</b>
            {isCurrent ? <span className="r22-home-stepper-desc"> — {step.description}</span> : null}
          </span>
        );
      })}
    </div>
  );
}

function LoadingTruth({ data }: { data: HomeData }) {
  const unreadable = [data.credits, data.canvases, data.thumbs, data.upcoming, data.campaigns, data.equipment].some((item) => !item.ok);
  if (!unreadable) return null;
  return (
    <div className="r22-home-read-warning" role="status">
      <Info aria-hidden="true" />
      <span>{HOME_COPY.workspaceDataUnreadable}</span>
    </div>
  );
}

export function HomeView({
  data,
  connection,
  fixture = false,
  fixtureConnectionOutcome = "success",
  fixtureInitialChannel = "Instagram",
  fixtureInitialReady = false,
  fixtureInitialError = false,
}: {
  data: HomeData;
  connection: HomeConnection;
  fixture?: boolean;
  fixtureConnectionOutcome?: "success" | "error";
  fixtureInitialChannel?: string;
  fixtureInitialReady?: boolean;
  fixtureInitialError?: boolean;
}) {
  const [connectFlow, setConnectFlow] = useState<ConnectFlow | null>(fixtureInitialError ? { channel: fixtureInitialChannel, step: "error" } : null);
  const [fixtureConnected, setFixtureConnected] = useState<{ channel: string; accountLabel: string } | null>(fixture ? null : fixtureInitialReady ? { channel: fixtureInitialChannel, accountLabel: fixtureInitialChannel } : null);
  const [fixtureWorkspace, setFixtureWorkspace] = useState<{ id: string; name: string }>({ id: "batik-house", name: "Batik House" });
  const [fixtureOutcome, setFixtureOutcome] = useState(fixtureConnectionOutcome);
  const visibleConnection: HomeConnection = fixtureConnected
    ? { kind: "verified_fixture", accountLabel: fixtureConnected.accountLabel }
    : connection;
  const disconnected = visibleConnection.kind === "not_connected";
  const ready = visibleConnection.kind === "connected" || visibleConnection.kind === "verified_fixture";
  const verifiedFixture = visibleConnection.kind === "verified_fixture";
  // connect-first(未连 / 需要重连)态把两栏 grid 收成单卡,步进器搬进卡内一行 —— 见
  // `.r22-home-connect-card.is-connect-first` 与下面 channels 之后的 `<ConnectionStepper>`。
  const connectFirst = !ready && connection.kind !== "unknown";
  const channels = fixture ? CHANNELS.map((channel) => ({ ...channel, available: true })) : CHANNELS;
  const fixtureHref = (href: string) => fixture ? `${href}${href.includes("?") ? "&" : "?"}fixture=r22` : href;
  const provider = connectFlow?.channel ?? "Instagram";
  const currentStep = ready ? CONNECTION_STEPS.length - 1 : 0;

  useEffect(() => {
    if (!fixture) return;
    const directory = readR22WorkspaceDirectory();
    const active = directory.workspaces.find((workspace) => workspace.id === directory.activeId) ?? directory.workspaces[0]!;
    setFixtureWorkspace({ id: active.id, name: active.name });
    if (!fixtureInitialReady) { setFixtureConnected(null); return; }
    const params = new URLSearchParams(window.location.search);
    const connectionWorkspace = params.get("connectionWorkspace") ?? "batik-house";
    if (connectionWorkspace !== active.id) { setFixtureConnected(null); return; }
    setFixtureConnected({ channel: fixtureInitialChannel, accountLabel: fixtureInitialChannel === "Instagram" ? `@${active.name.toLowerCase().replace(/[^a-z0-9]+/g, "")}` : active.name });
  }, [fixture, fixtureInitialChannel, fixtureInitialReady]);

  function openConnect(channel: string) {
    setConnectFlow({ channel, step: "permissions" });
  }

  function setFixtureConnectionUrl(state: "ready" | "error" | null, channel?: string) {
    if (!fixture) return;
    const next = new URL(window.location.href);
    if (state) next.searchParams.set("connection", state);
    else next.searchParams.delete("connection");
    if (channel) next.searchParams.set("channel", channel);
    else next.searchParams.delete("channel");
    if (state) next.searchParams.set("connectionWorkspace", fixtureWorkspace.id);
    else next.searchParams.delete("connectionWorkspace");
    window.history.replaceState(window.history.state, "", `${next.pathname}${next.search}`);
  }

  function dismissConnect() {
    if (connectFlow?.step === "error") {
      setFixtureConnectionUrl(null);
      setFixtureOutcome("success");
    }
    setConnectFlow(null);
  }

  function confirmConnection() {
    if (!connectFlow) return;
    if (!fixture) {
      window.location.assign("/api/meta/authorize");
      return;
    }
    const channel = connectFlow.channel;
    setConnectFlow({ channel, step: "submitting" });
    window.setTimeout(() => {
      if (fixtureOutcome === "error") {
        setFixtureConnectionUrl("error", channel);
        setConnectFlow({ channel, step: "error" });
        return;
      }
      setFixtureConnected({ channel, accountLabel: channel === "Instagram" ? `@${fixtureWorkspace.name.toLowerCase().replace(/[^a-z0-9]+/g, "")}` : fixtureWorkspace.name });
      setFixtureConnectionUrl("ready", channel);
      setConnectFlow({ channel, step: "success" });
    }, 420);
  }
  return (
    <div className="r22-home" data-r22-home>
      <TooltipProvider>
      {/*
        右上角那一组(通知铃 + 头像 + chevron)不长在这里。原型 L12211 把头像点击直接转发给
        侧栏的 `#workspaceBtn`(`wsb.click()`)—— 触发点在右上,菜单与它的内容只有侧栏那**一份**。
        这里照抄那个结论:Home 不再自己画一个死的 `NA` 方块,整组交给壳
        (`R22DashboardShell` 的 `.r22-dashboard-quick-actions`),那里铃、badge、工作区菜单
        与登出本来就已经是活的。一个菜单、一份状态、两个触发点。
      */}
      <header className="r22-home-header">
        <div>
          <h1>{data.greeting}</h1>
          <p>{ready ? HOME_COPY.connectionReadySubhead : "Connect one channel so Otto can learn what is working."}</p>
        </div>
      </header>

      <LoadingTruth data={data} />

      {connection.kind === "unknown" ? (
        <div className="r22-home-connection-error" role="alert">
          <Info aria-hidden="true" />
          <div><b>{HOME_COPY.connectionStatusUnavailableHeading}</b><p>{connection.message} {HOME_COPY.nothingMarkedDisconnected}</p></div>
          <Link href={fixtureHref("/settings/connections")}>Open connections</Link>
        </div>
      ) : null}

      <section className={`r22-home-connect-card${ready ? " is-ready" : ""}${connectFirst ? " is-connect-first" : ""}`}>
        <div className="r22-home-connect-copy">
          {ready ? (
            <>
              <div className="r22-home-ready-head">
                <span aria-hidden="true"><Check /></span>
                <div><h2>{fixtureConnected?.channel || (visibleConnection.kind === "verified_fixture" ? fixtureInitialChannel : "Meta")} is ready</h2><p>{visibleConnection.accountLabel} · access verified</p></div>
                <Link href={fixtureHref("/settings/connections")}>Manage</Link>
              </div>
              <div className="r22-home-ready-summary">
                <div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <b tabIndex={0}>{HOME_COPY.connectionVerifiedLabel}</b>
                    </TooltipTrigger>
                    <TooltipContent>{HOME_COPY.connectionVerifiedScope}</TooltipContent>
                  </Tooltip>
                </div>
                <div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <b tabIndex={0}>{HOME_COPY.publishingPermissionsLabel}</b>
                    </TooltipTrigger>
                    <TooltipContent>{HOME_COPY.publishingPermissionsScope}</TooltipContent>
                  </Tooltip>
                </div>
                <div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <b tabIndex={0}>{HOME_COPY.ottoContextLabel}</b>
                    </TooltipTrigger>
                    <TooltipContent>{HOME_COPY.ottoContextScope}</TooltipContent>
                  </Tooltip>
                </div>
              </div>
              {visibleConnection.kind === "connected" && visibleConnection.transient ? <p className="r22-home-inline-warning">{HOME_COPY.metaUnreachable}</p> : null}
            </>
          ) : connection.kind === "unknown" ? (
            <div className="r22-home-unknown-card">
              <h2>{HOME_COPY.connectionStatusUnavailableHeading}</h2>
              <p>{HOME_COPY.connectionStatusUnavailableBody}</p>
              <Link href={fixtureHref("/settings/connections")}>Review connections</Link>
            </div>
          ) : (
            <>
              <h2>{connection.kind === "needs_reconnect" ? "Reconnect your channel" : "Connect your first channel"}</h2>
              {connection.kind === "needs_reconnect" ? <p>The existing Meta access expired. Reconnect it before Otto reads new data.</p> : null}
              <div className="r22-home-channels">
                {channels.map(({ label, icon: Icon, recommended, available }) => (
                  <div className="r22-home-channel" key={label}>
                    <Icon aria-hidden="true" /><b>{label}</b>{recommended && <em>Recommended</em>}
                    {available ? <Button unstyled type="button" className="r22-home-fixture-connect" onClick={() => openConnect(label)}>{visibleConnection.kind === "needs_reconnect" ? "Reconnect" : "Connect"}</Button> : <Button unstyled type="button" disabled>{HOME_COPY.channelNotAvailable}</Button>}
                  </div>
                ))}
              </div>
              <ConnectionStepper currentStep={currentStep} />
              {disconnected ? <Link className="r22-home-skip" href={fixtureHref("/create")}>Skip for now</Link> : null}
            </>
          )}
        </div>

        {ready ? <ConnectionStepper currentStep={currentStep} /> : null}
      </section>

      <div className="r22-home-insight-grid">
        <section className={`r22-home-performance${verifiedFixture ? " has-data" : ""}`}>
          <h3>
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>Performance</span>
              </TooltipTrigger>
              <TooltipContent>{HOME_COPY.performanceVerifiedOnlyBody}</TooltipContent>
            </Tooltip>
          </h3>
          {verifiedFixture ? <div className="r22-home-kpis"><span><small>Published</small><b>38</b><em>Last 30 days</em></span><span><small>Reach</small><b>48.2K</b><em>+12.6%</em></span><span><small>Engagement</small><b>4.8%</b><em>+0.7 pt</em></span><span><small>Best day</small><b>Thu</b><em>18:00–21:00</em></span></div> : <div>
            <span><LockKeyhole aria-hidden="true" /></span>
            <b>{ready ? HOME_COPY.performanceUnavailableReady : "Connect a channel to see performance."}</b>
            {ready ? <p>{HOME_COPY.performanceUnavailableReadyBody}</p> : null}
            <i /><i /><i />
          </div>}
        </section>

        <section className="r22-home-analysis">
          <h3>Otto will analyse</h3>
          <div className="r22-home-analysis-chips">
            {ANALYSIS_ITEMS.map(({ label, copy }) => (
              <Tooltip key={label}>
                <TooltipTrigger asChild>
                  <span className="r22-home-chip" tabIndex={0}>{label}</span>
                </TooltipTrigger>
                <TooltipContent>{copy}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        </section>
      </div>

      <section className="r22-home-create-row">
        <span><Plus aria-hidden="true" /></span>
        <div><b>Create without data</b></div>
        <div className="r22-home-create-actions">
          <Link className="is-primary" href={fixtureHref("/create")}>Create new</Link>
          <Button unstyled type="button" aria-label="More creation choices"><ChevronDown /></Button>
          <Link className="is-secondary" href={fixtureHref("/brand")}>Add brand context</Link>
        </div>
      </section>

      {fixture ? <footer>Prototype · sample data</footer> : null}

      <Dialog open={connectFlow !== null} onOpenChange={(open) => { if (!open) dismissConnect(); }}>
        <DialogContent className="r22-home-connect-dialog" showCloseButton={false}>
          {connectFlow?.step === "permissions" ? (
            <>
              <DialogHeader>
                <DialogTitle>Connect {provider}</DialogTitle>
                <DialogDescription>{HOME_COPY.providerWindowNotice}</DialogDescription>
              </DialogHeader>
              <div className="r22-home-provider"><b>Continue with {provider}</b><span>{HOME_COPY.noPasswordStored}</span></div>
              <ul className="r22-home-permissions">
                <li><Check aria-hidden="true" />{HOME_COPY.permissionReadContent}</li>
                <li><Check aria-hidden="true" />{HOME_COPY.permissionPublishApproved}</li>
                <li><Check aria-hidden="true" />{HOME_COPY.permissionVerifyAccount}</li>
              </ul>
              <DialogFooter>
                <Button unstyled type="button" className="is-quiet" onClick={dismissConnect}>Cancel</Button>
                <Button unstyled type="button" className="is-primary" onClick={() => setConnectFlow({ channel: provider, step: "profile" })}>Continue with {provider}</Button>
              </DialogFooter>
            </>
          ) : connectFlow?.step === "profile" ? (
            <>
              <DialogHeader>
                <DialogTitle>Choose a business profile</DialogTitle>
                <DialogDescription>{HOME_COPY.profileScopeNotice}</DialogDescription>
              </DialogHeader>
              {fixture ? <RadioGroup unstyled defaultValue={fixtureWorkspace.id} aria-label="Business profile"><label className="r22-home-profile"><RadioGroupItem unstyled value={fixtureWorkspace.id} /><span>{fixtureWorkspace.name.split(/\s+/).map((word) => word[0]).join("").slice(0, 2).toUpperCase()}</span><span><b>{provider === "Instagram" ? `@${fixtureWorkspace.name.toLowerCase().replace(/[^a-z0-9]+/g, "")}` : fixtureWorkspace.name}</b><small>{fixtureWorkspace.name} · Business profile</small></span></label></RadioGroup> : <div className="r22-home-provider"><b>Choose your profile with Meta</b><span>{HOME_COPY.metaProfileListTruth}</span></div>}
              <p className="r22-home-dialog-note">{HOME_COPY.permissionVerificationNotice}</p>
              <DialogFooter>
                <Button unstyled type="button" className="is-quiet" onClick={() => setConnectFlow({ channel: provider, step: "permissions" })}>Back</Button>
                <Button unstyled type="button" className="is-primary" onClick={confirmConnection}>{fixture ? "Connect this profile" : "Continue to Meta"}</Button>
              </DialogFooter>
            </>
          ) : connectFlow?.step === "submitting" ? (
            <div className="r22-home-connect-state" aria-live="polite"><LoaderCircle className="is-spinning" aria-hidden="true" /><DialogTitle>Verifying {provider}</DialogTitle><DialogDescription>{HOME_COPY.verifyingNotice}</DialogDescription></div>
          ) : connectFlow?.step === "error" ? (
            <>
              <div className="r22-home-connect-state" role="alert"><Info aria-hidden="true" /><DialogTitle>{HOME_COPY.connectFailedTitle}</DialogTitle><DialogDescription>{HOME_COPY.connectFailedBody}</DialogDescription></div>
              <DialogFooter><Button unstyled type="button" className="is-quiet" onClick={dismissConnect}>Cancel</Button><Button unstyled type="button" className="is-primary" onClick={() => { setFixtureOutcome("success"); setConnectFlow({ channel: provider, step: "profile" }); }}>Retry</Button></DialogFooter>
            </>
          ) : (
            <>
              <div className="r22-home-connect-state is-success" role="status"><Check aria-hidden="true" /><DialogTitle>Success! {provider} is connected.</DialogTitle><DialogDescription>{HOME_COPY.connectSuccessBody}</DialogDescription></div>
              <DialogFooter><Button unstyled type="button" className="is-primary" onClick={() => setConnectFlow(null)}>Done</Button></DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      </TooltipProvider>
    </div>
  );
}

export function R22HomeFixture({ connectionState, channel = "Instagram" }: { connectionState?: "ready" | "error"; channel?: string }) {
  const data: HomeData = {
    greeting: "Good morning, Nadia",
    credits: readOk("1,240 credits"),
    billingHref: "/billing",
    billingLabel: "Billing & credits",
    canvases: readOk([]),
    thumbs: readOk([]),
    upcoming: readOk([]),
    campaigns: readOk([]),
    equipment: readOk([]),
  };
  return <HomeView data={data} connection={{ kind: "not_connected" }} fixture fixtureConnectionOutcome={connectionState === "error" ? "error" : "success"} fixtureInitialChannel={channel} fixtureInitialReady={connectionState === "ready"} fixtureInitialError={connectionState === "error"} />;
}

export default HomeView;
