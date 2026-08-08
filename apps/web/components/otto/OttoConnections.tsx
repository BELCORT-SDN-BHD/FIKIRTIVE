"use client";
import React, { useEffect, useState } from "react";
import { disconnectMeta, getMetaInsights, type MetaAdAccount } from "@/lib/meta-actions";
import { setAdsAutonomy, setAdsWritesPaused } from "@/lib/otto-client-actions";
import type { AccountInsights } from "@/lib/meta-insights";
import { getAccountViewData } from "@/lib/account-view-data";
import { UNAVAILABLE_PUBLISHING_CHANNEL_IDS } from "@/lib/channels/channel-meta";
import { CONNECTION_BLOCKER_COPY } from "@fikirtive/core/schedule-draft";
import { describeMetaAdAccountStatus } from "@/lib/meta-ad-account-status";
import type { ChannelState } from "./settings/sections";
import { Button } from "@/components/ui/button";

// The single Connections page (#513 三、2 / #518): every "Connect a channel" entry
// point in the product — Otto's sidebar, Settings, CRM's zero-channel empty state —
// lands here. Channels are grouped by merchant task, not by which team built them:
// Publishing (schedule/post) vs Messaging (CRM inbound/outbound). Each channel has
// exactly one status source, one button, one connection record.

type MetaState =
  | { phase: "loading" }
  | { phase: "disconnected" }
  | { phase: "connected"; status?: string; accounts: MetaAdAccount[]; canWrite: boolean; adsAutonomy: string; adsWritesPaused: boolean }
  | { phase: "reconnect" }
  // F37: Meta couldn't be reached right now (network / 5xx / rate limit) — the
  // connection itself is fine, so offer a retry instead of a false reconnect scare.
  | { phase: "unreachable" };

type ChannelsState =
  | { phase: "loading" }
  | { phase: "error" }
  | { phase: "loaded"; channels: ChannelState[] };

// Messaging channels never come from lib/channels/registry.ts — none has an adapter yet.
// Listed here, statically, with the same "soon" honesty as lib/analytics-platforms.ts:
// no fake Connect button, just an accurate label.
const MESSAGING_CHANNELS: { id: string; label: string }[] = [
  { id: "whatsapp", label: "WhatsApp" },
];

// X has no OAuth route yet — lib/channels/x.ts's connectUrl points at an unbuilt
// /api/x/authorize, and its insight reads are still stubbed. Until that adapter is
// real, X gets the same "soon" honesty as Messaging: no fake Connect/Reconnect/Manage
// button (#518 finding 1). That list now lives in lib/channels/channel-meta.ts, where
// Schedule and the account page read it too — this page was the only honest one (#694).

// #511 — a failed Meta connect comes back here as /otto?view=connections&error=<code>:
// "missing" or "state" from app/api/meta/callback/route.ts, "not_configured" from
// app/api/meta/authorize/route.ts, and whatever completeMetaConnect returned otherwise
// ("not_configured"/"exchange" from lib/meta-graph.ts, "incomplete" from lib/meta-actions.ts's
// #573 fail-closed guard). Nothing in the app read that param before, so a merchant whose
// connect failed landed on an unchanged Connections page with no idea why. New codes will
// appear, so the unknown branch must still say something true rather than guess a cause.
type ConnectErrorCopy = { message: string; retry: boolean; rawCode?: string };

function describeConnectError(code: string): ConnectErrorCopy {
  // completeMetaConnect can hand back a whole sentence instead of a code — the
  // impersonation guard does (lib/meta-actions.ts:21). Show it verbatim; retrying cannot
  // clear it. Matched on the EXACT sentence, not a substring: a code like
  // `impersonation_failed` is not this guard, and treating it as one would both print a
  // bare code as if it were prose and wrongly refuse the merchant a retry. That sentence
  // isn't exported, so if it ever changes over there this stops matching and the code
  // falls through to the generic branch below — which still tells the truth (says only
  // that Meta couldn't be connected, shows the raw text, offers a retry). That is the
  // intended failure mode, chosen deliberately over a fuzzy match that can misfire.
  if (code === "Paused while impersonating a customer — exit impersonation to connect Meta.")
    return { message: code, retry: false };
  switch (code) {
    case "missing":
      return { message: "Meta sent you back before the connection finished.", retry: true };
    case "state":
      // Exactly three things make the callback reject the state (lib/meta-oauth.ts
      // verifyState + app/api/meta/callback/route.ts:24): a signature that doesn't verify,
      // the 10-minute TTL, or a state minted for a different ownerId than the one now
      // signed in. Nothing binds it to a browser, so the copy must not claim that. A fresh
      // connect clears all three.
      return { message: "This connect link couldn’t be verified — these links expire, and they only work for the account that started them.", retry: true };
    case "not_configured":
      // Nothing the merchant can retry their way out of — the server is missing its Meta keys.
      return { message: "Meta connections aren’t switched on for this server yet. Contact support and we’ll enable it.", retry: false };
    case "exchange":
      return { message: "Meta didn’t finish the sign-in handshake.", retry: true };
    case "incomplete":
      // #573 — Meta's token check came back without the account id, so lib/meta-actions.ts
      // refused to save a half-built connection rather than keep one we could never delete
      // on request. Nothing is stored; a fresh connect normally succeeds.
      return { message: "Meta didn’t confirm which account you connected, so nothing was saved. Try connecting again.", retry: true };
    default:
      // Don't invent a cause — say only what's true, and show the code we were actually
      // given so the merchant can quote it to support.
      return { message: "Meta couldn’t be connected.", retry: true, rawCode: code };
  }
}

function ChannelGlyph({ id, size = 18 }: { id: string; size?: number }) {
  // currentColor-driven inline glyphs — same brand marks as OttoSchedule's ChannelIcon,
  // kept local here since that one isn't exported for reuse outside the Schedule view.
  switch (id) {
    case "instagram":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="2" y="2" width="20" height="20" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
        </svg>
      );
    case "facebook":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M14 8.5V7c0-.83.67-1 1-1h1.5V3.5H14C12.07 3.5 11 4.9 11 6.8V8.5H9V11h2v9.5h3V11h2.1l.4-2.5H14Z" />
        </svg>
      );
    case "x":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      );
    case "whatsapp":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.39 1.26 4.81L2 22l5.44-1.34a9.9 9.9 0 0 0 4.6 1.13h.01c5.46 0 9.9-4.45 9.9-9.91C21.96 6.45 17.51 2 12.04 2Zm0 17.89h-.01a8 8 0 0 1-4.06-1.11l-.29-.17-3.02.79.81-2.94-.19-.3a7.9 7.9 0 0 1-1.22-4.25c0-4.39 3.58-7.97 7.98-7.97 2.13 0 4.13.83 5.64 2.34a7.9 7.9 0 0 1 2.33 5.64c0 4.4-3.58 7.97-7.97 7.97Zm4.38-5.97c-.24-.12-1.42-.7-1.64-.78-.22-.08-.38-.12-.54.12-.16.24-.62.78-.76.94-.14.16-.28.18-.52.06-.24-.12-1.01-.37-1.92-1.18-.71-.63-1.19-1.42-1.33-1.66-.14-.24-.01-.37.11-.49.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.54-1.3-.74-1.78-.19-.47-.39-.4-.54-.41-.14-.01-.3-.01-.46-.01-.16 0-.42.06-.64.3-.22.24-.84.82-.84 2s.86 2.32.98 2.48c.12.16 1.7 2.6 4.12 3.64.58.25 1.03.4 1.38.51.58.18 1.11.16 1.53.1.47-.07 1.42-.58 1.62-1.14.2-.56.2-1.04.14-1.14-.06-.1-.22-.16-.46-.28Z" />
        </svg>
      );
    default:
      return null;
  }
}

function ChannelRow({ channel }: { channel: ChannelState }) {
  // A connection that exists but can't publish outranks the bare "Connected" — in the SAME words
  // the Schedule screen uses for the same fact, so the merchant never gets two stories about one
  // connection (#741 r5 P1/P2). The button has to follow the same fact: `needs_page_permission`
  // usually arrives with status "connected", so keying the CTA off status alone put "Manage" next
  // to "Page access needed" while Schedule was saying "Reconnect" about the very same connection.
  const blocked = channel.blocker ?? (channel.status === "needs_reconnect" ? "needs_reconnect" : null);
  const label = blocked ? "Reconnect" : channel.status === "connected" ? "Manage" : "Connect";
  const variant = blocked ? "brand" : channel.status === "connected" ? "ghost" : "brand";
  // Every one of these sentences comes from the shared table — the "Reconnect needed" branch used
  // to be a hand-written copy of it, and it is genuinely reachable (status needs_reconnect with no
  // blocker attached), so "one wording, one source" was not actually true.
  const hint = blocked
    ? CONNECTION_BLOCKER_COPY[blocked].status
    : channel.status === "connected"
      ? channel.targets.join(", ") || "Connected"
      : "Not connected";
  return (
    <div
      className="border-b border-border last:border-b-0"
      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", padding: "0.75rem 0", flexWrap: "wrap" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <span className="text-muted-foreground" style={{ flexShrink: 0 }} aria-hidden>
          <ChannelGlyph id={channel.id} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div className="text-foreground text-[0.875rem] font-medium">{channel.label}</div>
          <div className="text-muted-foreground text-[0.75rem]">{hint}</div>
        </div>
      </div>
      <Button asChild size="sm" variant={variant}>
        <a href={channel.connectUrl} style={{ textDecoration: "none" }}>
          {label}
        </a>
      </Button>
    </div>
  );
}

function MessagingRow({ label }: { label: string }) {
  return (
    <div
      className="border-b border-border last:border-b-0"
      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", padding: "0.75rem 0", flexWrap: "wrap" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <span className="text-muted-foreground" style={{ flexShrink: 0 }} aria-hidden>
          <ChannelGlyph id={label.toLowerCase()} />
        </span>
        <div className="text-foreground text-[0.875rem] font-medium">{label}</div>
      </div>
      <span className="text-muted-foreground text-[0.75rem]">Not available yet</span>
    </div>
  );
}

export default function OttoConnections() {
  const [meta, setMeta] = useState<MetaState>({ phase: "loading" });
  const [insights, setInsights] = useState<AccountInsights[] | null>(null);
  const [saving, setSaving] = useState<null | "autonomy" | "paused">(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [channelsState, setChannelsState] = useState<ChannelsState>({ phase: "loading" });
  // #511 — the ?error=<code> the OAuth routes redirect back with. Read in an effect, not
  // during render: this is a client component but Next still renders it on the server,
  // where `window` doesn't exist.
  const [connectErrorCode, setConnectErrorCode] = useState<string | null>(null);

  // Single load for the whole page, single Meta read behind it (#518 rework finding 2):
  // getAccountViewData() is the ONE call this page makes — it already did the ONE
  // getMetaConnection() read server-side and used it both to compute the Instagram/
  // Facebook row status below and to fill `meta` here. There is no second, independently-
  // timed Meta read at this level to disagree with it.
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
    else
      setMeta({
        phase: "connected",
        status: res.status,
        accounts: res.accounts ?? [],
        canWrite: res.canWrite ?? false,
        adsAutonomy: res.adsAutonomy ?? "ASK",
        adsWritesPaused: res.adsWritesPaused ?? false,
      });

    setChannelsState({ phase: "loaded", channels: result.channels });
  }

  async function handleAutonomy(mode: "ASK" | "AUTO") {
    if (meta.phase !== "connected") return;
    const prevMode = meta.adsAutonomy;
    setSaving("autonomy");
    setSaveError(null);
    setMeta((s) => (s.phase === "connected" ? { ...s, adsAutonomy: mode } : s));
    const res = await setAdsAutonomy(mode);
    setSaving(null);
    if ("error" in res) {
      // Server rejected — roll back the optimistic update so UI matches DB state
      setMeta((s) => (s.phase === "connected" ? { ...s, adsAutonomy: prevMode } : s));
      setSaveError(res.error);
    }
  }

  async function handlePaused(paused: boolean) {
    if (meta.phase !== "connected") return;
    const prevPaused = meta.adsWritesPaused;
    setSaving("paused");
    setSaveError(null);
    setMeta((s) => (s.phase === "connected" ? { ...s, adsWritesPaused: paused } : s));
    const res = await setAdsWritesPaused(paused);
    setSaving(null);
    if ("error" in res) {
      // Server rejected — roll back the optimistic update so UI matches DB state
      setMeta((s) => (s.phase === "connected" ? { ...s, adsWritesPaused: prevPaused } : s));
      setSaveError(res.error);
    }
  }

  useEffect(() => {
    queueMicrotask(() => void load());
  }, []);

  // #511 — take the failure code off the URL once, then strip just that one param with
  // replaceState (no popstate, so OttoApp's syncFromLocation stays out of this) so a
  // refresh doesn't resurrect a stale error. `connected` and every other param survive.
  useEffect(() => {
    // Deferred with queueMicrotask for the same reason load() above is: setting state
    // synchronously in an effect body trips react-hooks/set-state-in-effect.
    queueMicrotask(() => {
      const rawSearch = window.location.search;
      // Decoding is fine for the value we're about to display; it's re-encoding the OTHERS
      // that isn't.
      const code = new URLSearchParams(rawSearch).get("error");
      if (!code) return;
      setConnectErrorCode(code);
      // Surgery on the raw query string rather than serializing URLSearchParams back out:
      // a round-trip rewrites every other param's encoding (`a%20b` becomes `a+b`), which
      // silently changes params we were only ever asked to leave alone. Drop just the
      // error entries; the rest survive byte-for-byte, in their original order. pathname
      // and hash are never touched.
      const kept = rawSearch
        .replace(/^\?/, "")
        .split("&")
        .filter((part) => part !== "error" && !part.startsWith("error="));
      const nextSearch = kept.length > 0 ? `?${kept.join("&")}` : "";
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${nextSearch}${window.location.hash}`);
    });
  }, []);

  useEffect(() => {
    if (meta.phase !== "connected") return;
    void getMetaInsights("last_30d").then((res) => {
      if ("accounts" in res) setInsights(res.accounts);
    });
  }, [meta.phase]);

  // The Meta ad-account panel is supplementary detail on the SAME Meta connection that
  // backs the Instagram/Facebook Publishing rows above — `meta` (loaded once by load(),
  // above) is the single source both read, so the panel and the rows can never disagree.
  // It only makes sense to show once that connection is live (or briefly unreachable,
  // since the token itself is still fine).
  const showAdsPanel = meta.phase === "connected" || meta.phase === "unreachable";
  const publishingLoading = channelsState.phase === "loading" || meta.phase === "loading";
  const connectError = connectErrorCode ? describeConnectError(connectErrorCode) : null;

  return (
    // leading-[1.5] — design-baseline body line-height (Analytics standard)
    <div className="gb leading-[1.5]" style={{ flex: 1, overflow: "auto", padding: "1.25rem" }}>
      <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", flexDirection: "column", gap: "1.75rem" }}>
        <div>
          <h1 className="text-foreground" style={{ margin: 0, fontSize: "1.125rem" }}>Connections</h1>
          <p className="text-muted-foreground text-[0.875rem]" style={{ margin: "0.25rem 0 0" }}>
            Every channel Otto can post to or hear from your customers on, in one place.
          </p>
        </div>

        {/* #511 — the connect attempt that just failed, explained before anything else on
            the page: it's the reason the merchant is looking at this view. */}
        {connectError && (
          <div
            role="alert"
            className="bg-error-soft rounded-[14px]"
            style={{ padding: "0.875rem 1rem", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "0.5rem" }}
          >
            <p className="text-[var(--error-soft-foreground)] text-[0.8125rem]" style={{ margin: 0 }}>
              {connectError.message}
            </p>
            {connectError.rawCode && (
              <p className="text-muted-foreground text-[0.75rem]" style={{ margin: 0 }}>
                Details: {connectError.rawCode}
              </p>
            )}
            {connectError.retry && (
              <Button asChild size="sm" variant="brand">
                <a href="/api/meta/authorize" style={{ textDecoration: "none" }}>Try again</a>
              </Button>
            )}
          </div>
        )}

        {/* Publishing — where Otto posts on your behalf. */}
        <div>
          <h2 className="text-foreground font-semibold" style={{ fontSize: 15, margin: "0 0 0.25rem" }}>Publishing</h2>
          <p className="text-muted-foreground text-[0.75rem]" style={{ margin: "0 0 0.5rem" }}>
            Instagram and Facebook — Otto schedules posts and reads results here. X is listed
            below but not available yet.
          </p>
          <div className="bg-card border border-border rounded-[14px]" style={{ padding: "0 1rem" }}>
            {publishingLoading && (
              <p className="text-muted-foreground text-[0.75rem]" style={{ padding: "0.75rem 0" }}>Checking…</p>
            )}
            {!publishingLoading && channelsState.phase === "error" && (
              <div style={{ padding: "0.75rem 0", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "0.5rem" }}>
                <p className="text-muted-foreground text-[0.75rem]" style={{ margin: 0 }}>Could not load channels.</p>
                <Button type="button" size="sm" variant="ghost" onClick={() => void load()}>Retry</Button>
              </div>
            )}
            {!publishingLoading && channelsState.phase === "loaded" && channelsState.channels.map((c) =>
              UNAVAILABLE_PUBLISHING_CHANNEL_IDS.has(c.id) ? (
                <MessagingRow key={c.id} label={c.label} />
              ) : (
                // Status already comes from getAccountViewData()'s single Meta read for
                // instagram/facebook (#518 rework finding 2) — no client-side override needed.
                <ChannelRow key={c.id} channel={c} />
              ),
            )}
          </div>

          {/* Meta ad accounts — detail on the connection above, once it's live. */}
          {showAdsPanel && (
            <div className="bg-card border border-border rounded-[14px]" style={{ padding: "1rem", marginTop: "0.75rem" }}>
              <div className="text-foreground font-semibold" style={{ fontSize: 15 }}>Meta ad accounts</div>

              {meta.phase === "unreachable" && (
                <div style={{ marginTop: "0.5rem", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "0.5rem" }}>
                  <p className="text-muted-foreground text-[0.75rem]" style={{ margin: 0 }}>
                    Couldn&rsquo;t reach Meta just now — this is usually temporary. Your connection is fine.
                  </p>
                  <Button type="button" size="sm" variant="ghost" onClick={() => void load()}>
                    Retry
                  </Button>
                </div>
              )}

              {meta.phase === "connected" && (
                <div style={{ marginTop: "0.5rem" }}>
                  <div className="text-muted-foreground text-[0.75rem]" style={{ marginBottom: "0.5rem" }}>{meta.accounts.length} ad account{meta.accounts.length === 1 ? "" : "s"}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                    {meta.accounts.map((a) => {
                      const ins = insights?.find((i) => i.accountId === a.id);
                      const m = ins?.metrics;
                      // #693 — a.status is Meta's numeric account_status. It never reaches the
                      // merchant as-is; the shared mapping turns it into words (or admits it
                      // doesn't recognise the code), and says what it means for their ads.
                      const statusView = describeMetaAdAccountStatus(a.status);
                      return (
                        <div key={a.id} className="border-b border-border" style={{ padding: "4px 0" }}>
                          <div className="text-foreground text-[0.8125rem]" style={{ display: "flex", justifyContent: "space-between" }}>
                            <span>{a.name || a.id}</span>
                            <span className="text-muted-foreground">{a.currency}{statusView ? ` · ${statusView.label}` : ""}</span>
                          </div>
                          {statusView?.detail && (
                            <div
                              className={statusView.tone === "attention" ? "text-[var(--error-soft-foreground)]" : "text-muted-foreground"}
                              style={{ fontSize: "0.75rem", paddingLeft: 2, marginTop: 2 }}
                            >
                              {statusView.detail}
                            </div>
                          )}
                          {m && (
                            <div className="text-muted-foreground text-[0.75rem]" style={{ paddingLeft: 2, marginTop: 2 }}>
                              {m.spend ? `Spent ${m.spend}` : "—"} · {m.impressions ?? "—"} impr · CTR {m.ctr ?? "—"}% · CPC {m.cpc ?? "—"} · {m.purchaseRoas ? `ROAS ${m.purchaseRoas}` : "no conversion tracking"}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {/* ── Autonomy + Kill-switch controls (only when write permission granted) ── */}
                  {meta.canWrite ? (
                    <div className="border-t border-border" style={{ marginTop: "1rem", paddingTop: "0.75rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                      {/* Autonomy selector */}
                      <div>
                        <div className="text-foreground font-semibold text-[0.8125rem]" style={{ marginBottom: "0.25rem" }}>Otto autonomy</div>
                        <div style={{ display: "flex", gap: "0.5rem" }}>
                          <Button
                            type="button"
                            size="sm"
                            variant={meta.adsAutonomy === "ASK" ? "brand" : "ghost"}
                            disabled={saving === "autonomy"}
                            onClick={() => void handleAutonomy("ASK")}
                          >
                            Ask
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant={meta.adsAutonomy === "AUTO" ? "brand" : "ghost"}
                            disabled={saving === "autonomy"}
                            onClick={() => void handleAutonomy("AUTO")}
                          >
                            Auto
                          </Button>
                        </div>
                        {/* #556/#541 — the Auto disclosure must be readable BEFORE switching,
                            so it renders in both modes, not only after Auto is on. */}
                        <p className="text-muted-foreground text-[0.75rem]" style={{ margin: "0.25rem 0 0" }}>
                          Ask (default) — Otto always asks before making changes. Auto lets Otto
                          pause ads, lower budgets, and create paused draft campaigns in your ad
                          account on its own — anything that spends or goes live still asks you
                          first.
                        </p>
                      </div>

                      {/* Kill-switch */}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div>
                          <div className="text-foreground font-semibold text-[0.8125rem]">Pause all ad changes</div>
                          <div className="text-muted-foreground text-[0.75rem]">Otto cannot change any ad until you unpause.</div>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant={meta.adsWritesPaused ? "destructive" : "ghost"}
                          disabled={saving === "paused"}
                          onClick={() => void handlePaused(!meta.adsWritesPaused)}
                        >
                          {meta.adsWritesPaused ? "Paused — resume?" : "Pause"}
                        </Button>
                      </div>

                      {saveError && <p className="text-[var(--error-soft-foreground)] text-[0.75rem]" style={{ margin: 0 }}>{saveError}</p>}
                    </div>
                  ) : (
                    <div style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "0.5rem" }}>
                      <p className="text-muted-foreground text-[0.8125rem]" style={{ margin: 0 }}>
                        Reconnect to let Otto manage your ads.
                      </p>
                      <Button asChild size="sm" variant="brand">
                        <a href="/api/meta/authorize" style={{ textDecoration: "none" }}>Reconnect Meta</a>
                      </Button>
                    </div>
                  )}

                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="mt-3"
                    onClick={async () => { await disconnectMeta(); void load(); }}
                  >
                    Disconnect
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Messaging — where customers reach you (CRM). */}
        <div>
          <h2 className="text-foreground font-semibold" style={{ fontSize: 15, margin: "0 0 0.25rem" }}>Messaging</h2>
          <p className="text-muted-foreground text-[0.75rem]" style={{ margin: "0 0 0.5rem" }}>
            CRM channels your customers message you on.
          </p>
          <div className="bg-card border border-border rounded-[14px]" style={{ padding: "0 1rem" }}>
            {MESSAGING_CHANNELS.map((m) => (
              <MessagingRow key={m.id} label={m.label} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
