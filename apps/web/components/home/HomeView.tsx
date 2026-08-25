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

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  BarChart3,
  BriefcaseBusiness,
  CalendarDays,
  Camera,
  Check,
  ChevronDown,
  Heart,
  Info,
  LockKeyhole,
  LoaderCircle,
  MessageCircle,
  Music2,
  Plus,
  type LucideIcon,
} from "lucide-react";
import { readOk, type HomeData } from "./home-data";
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
    return { kind: "unknown", message: "Connection status could not be read just now." };
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
  { label: "Top content", copy: "Identify your best performing content and formats", icon: BarChart3 },
  { label: "Audience response", copy: "Understand what resonates with your audience", icon: Heart },
  { label: "Publishing rhythm", copy: "Find your optimal posting times and consistency", icon: CalendarDays },
] as const;

function LoadingTruth({ data }: { data: HomeData }) {
  const unreadable = [data.credits, data.canvases, data.thumbs, data.upcoming, data.campaigns, data.equipment].some((item) => !item.ok);
  if (!unreadable) return null;
  return (
    <div className="r22-home-read-warning" role="status">
      <Info aria-hidden="true" />
      <span>Some workspace data could not be read just now. No empty state has been inferred from it.</span>
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
  const channels = fixture ? CHANNELS.map((channel) => ({ ...channel, available: true })) : CHANNELS;
  const fixtureHref = (href: string) => fixture ? `${href}${href.includes("?") ? "&" : "?"}fixture=r22` : href;
  const provider = connectFlow?.channel ?? "Instagram";

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
      <header className="r22-home-header">
        <div>
          <h1>{data.greeting}</h1>
          <p>{ready ? "Your verified channel connection is ready for Otto." : "Connect one channel so Otto can learn what is working."}</p>
        </div>
        <div className="r22-home-account" aria-label="Current account">
          <span>NA</span>
          <ChevronDown aria-hidden="true" />
        </div>
      </header>

      <LoadingTruth data={data} />

      {connection.kind === "unknown" ? (
        <div className="r22-home-connection-error" role="alert">
          <Info aria-hidden="true" />
          <div><b>Connection status unavailable</b><p>{connection.message} Nothing has been marked disconnected.</p></div>
          <Link href={fixtureHref("/settings/connections")}>Open connections</Link>
        </div>
      ) : null}

      <section className={`r22-home-connect-card${ready ? " is-ready" : ""}`}>
        <div className="r22-home-connect-copy">
          {ready ? (
            <>
              <div className="r22-home-ready-head">
                <span aria-hidden="true"><Check /></span>
                <div><h2>{fixtureConnected?.channel || (visibleConnection.kind === "verified_fixture" ? fixtureInitialChannel : "Meta")} is ready</h2><p>{visibleConnection.accountLabel} · access verified</p></div>
                <Link href={fixtureHref("/settings/connections")}>Manage</Link>
              </div>
              <div className="r22-home-ready-summary">
                <div><b>Connection verified</b><span>Current workspace only</span></div>
                <div><b>Publishing permissions</b><span>Shown exactly as granted by Meta</span></div>
                <div><b>Otto context</b><span>Uses only available verified data</span></div>
              </div>
              {visibleConnection.kind === "connected" && visibleConnection.transient ? <p className="r22-home-inline-warning">Meta could not be reached just now. The existing connection has not been marked disconnected.</p> : null}
            </>
          ) : connection.kind === "unknown" ? (
            <div className="r22-home-unknown-card">
              <h2>Connection status unavailable</h2>
              <p>FIKIRTIVE could not verify whether a channel is connected. No connection action is offered until that read succeeds.</p>
              <Link href={fixtureHref("/settings/connections")}>Review connections</Link>
            </div>
          ) : (
            <>
              <h2>{connection.kind === "needs_reconnect" ? "Reconnect your channel" : "Connect your first channel"}</h2>
              <p>{connection.kind === "needs_reconnect" ? "The existing Meta access expired. Reconnect it before Otto reads new data." : "Otto will use your real publishing history to find patterns and recommend what to make next."}</p>
              <div className="r22-home-channels">
                {channels.map(({ label, icon: Icon, recommended, available }) => (
                  <div className="r22-home-channel" key={label}>
                    <Icon aria-hidden="true" /><b>{label}</b>{recommended && <em>Recommended</em>}
                    {available ? <Button unstyled type="button" className="r22-home-fixture-connect" onClick={() => openConnect(label)}>{visibleConnection.kind === "needs_reconnect" ? "Reconnect" : "Connect"}</Button> : <Button unstyled type="button" disabled>Not available</Button>}
                  </div>
                ))}
              </div>
              {disconnected ? <Link className="r22-home-skip" href={fixtureHref("/create")}>Skip for now</Link> : null}
            </>
          )}
        </div>

        {connection.kind !== "unknown" ? <ol className="r22-home-connection-steps">
          <li className={disconnected || connection.kind === "needs_reconnect" ? "is-active" : ready ? "is-done" : ""}><span /><div><b>Not connected</b><p>Choose a channel to get started</p></div></li>
          <li className={ready ? "is-done" : ""}><span /><div><b>Verifying</b><p>We’ll securely verify your access</p></div></li>
          <li className={ready ? "is-done" : ""}><span /><div><b>Syncing data</b><p>We’ll import your publishing history</p></div></li>
          <li className={ready ? "is-active is-done" : ""}><span /><div><b>Ready</b><p>Otto will learn and surface insights</p></div></li>
        </ol> : null}
      </section>

      <div className="r22-home-insight-grid">
        <section className={`r22-home-performance${verifiedFixture ? " has-data" : ""}`}>
          <h2>Performance</h2>
          {verifiedFixture ? <div className="r22-home-kpis"><span><small>Published</small><b>38</b><em>Last 30 days</em></span><span><small>Reach</small><b>48.2K</b><em>+12.6%</em></span><span><small>Engagement</small><b>4.8%</b><em>+0.7 pt</em></span><span><small>Best day</small><b>Thu</b><em>18:00–21:00</em></span></div> : <div>
            <span><LockKeyhole aria-hidden="true" /></span>
            <b>{ready ? "Verified performance is not available yet" : "Connect a channel to see real performance"}</b>
            <p>{ready ? "The connection is real, but this frontend has not received a verified publishing-history dataset." : "FIKIRTIVE will show only verified publishing and audience data."}</p>
            <i /><i /><i />
          </div>}
        </section>

        <section className="r22-home-analysis">
          <h2>What Otto will analyse</h2>
          <ul>
            {ANALYSIS_ITEMS.map(({ label, copy, icon: Icon }) => (
              <li key={label}><span><Icon aria-hidden="true" /></span><div><b>{label}</b><p>{copy}</p></div></li>
            ))}
          </ul>
        </section>
      </div>

      <section className="r22-home-create-row">
        <span><Plus aria-hidden="true" /></span>
        <div><b>Create without data</b><p>Start a post or campaign now. Otto will improve suggestions once a channel is connected.</p></div>
        <Link href={fixtureHref("/create")}>Create new</Link><Button unstyled type="button" aria-label="More creation choices"><ChevronDown /></Button>
      </section>

      <section className="r22-home-context-row">
        <Info aria-hidden="true" />
        <div><b>You can add brand context and more channels later.</b><p>Optional setup never blocks creation or marks itself complete.</p></div>
        <Link href={fixtureHref("/brand")}>Add brand context</Link>
      </section>

      {fixture ? <footer>Prototype · sample data · Soft Prism v4</footer> : null}

      <Dialog open={connectFlow !== null} onOpenChange={(open) => { if (!open) dismissConnect(); }}>
        <DialogContent className="r22-home-connect-dialog" showCloseButton={false}>
          {connectFlow?.step === "permissions" ? (
            <>
              <DialogHeader>
                <DialogTitle>Connect {provider}</DialogTitle>
                <DialogDescription>FIKIRTIVE will open a secure provider window in production.</DialogDescription>
              </DialogHeader>
              <div className="r22-home-provider"><b>Continue with {provider}</b><span>No password is stored in FIKIRTIVE.</span></div>
              <ul className="r22-home-permissions">
                <li><Check aria-hidden="true" />Read published content and audience insights</li>
                <li><Check aria-hidden="true" />Publish approved work when you choose</li>
                <li><Check aria-hidden="true" />Verify the connected account and permissions</li>
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
                <DialogDescription>Only the selected profile will be connected to this workspace.</DialogDescription>
              </DialogHeader>
              {fixture ? <RadioGroup unstyled defaultValue={fixtureWorkspace.id} aria-label="Business profile"><label className="r22-home-profile"><RadioGroupItem unstyled value={fixtureWorkspace.id} /><span>{fixtureWorkspace.name.split(/\s+/).map((word) => word[0]).join("").slice(0, 2).toUpperCase()}</span><span><b>{provider === "Instagram" ? `@${fixtureWorkspace.name.toLowerCase().replace(/[^a-z0-9]+/g, "")}` : fixtureWorkspace.name}</b><small>{fixtureWorkspace.name} · Business profile</small></span></label></RadioGroup> : <div className="r22-home-provider"><b>Choose your profile with Meta</b><span>The secure Meta window lists only profiles you can authorize. FIKIRTIVE does not invent that list.</span></div>}
              <p className="r22-home-dialog-note">FIKIRTIVE verifies publishing, insights and ownership permissions before importing data.</p>
              <DialogFooter>
                <Button unstyled type="button" className="is-quiet" onClick={() => setConnectFlow({ channel: provider, step: "permissions" })}>Back</Button>
                <Button unstyled type="button" className="is-primary" onClick={confirmConnection}>{fixture ? "Connect this profile" : "Continue to Meta"}</Button>
              </DialogFooter>
            </>
          ) : connectFlow?.step === "submitting" ? (
            <div className="r22-home-connect-state" aria-live="polite"><LoaderCircle className="is-spinning" aria-hidden="true" /><DialogTitle>Verifying {provider}</DialogTitle><DialogDescription>Checking the selected account and permissions. No success is shown until verification finishes.</DialogDescription></div>
          ) : connectFlow?.step === "error" ? (
            <>
              <div className="r22-home-connect-state" role="alert"><Info aria-hidden="true" /><DialogTitle>Connection could not be completed</DialogTitle><DialogDescription>The provider did not confirm the account. Nothing was connected and no workspace data changed.</DialogDescription></div>
              <DialogFooter><Button unstyled type="button" className="is-quiet" onClick={dismissConnect}>Cancel</Button><Button unstyled type="button" className="is-primary" onClick={() => { setFixtureOutcome("success"); setConnectFlow({ channel: provider, step: "profile" }); }}>Retry</Button></DialogFooter>
            </>
          ) : (
            <>
              <div className="r22-home-connect-state is-success" role="status"><Check aria-hidden="true" /><DialogTitle>Success! {provider} is connected.</DialogTitle><DialogDescription>Publishing and audience access was verified for this workspace.</DialogDescription></div>
              <DialogFooter><Button unstyled type="button" className="is-primary" onClick={() => setConnectFlow(null)}>Done</Button></DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
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
