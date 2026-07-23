"use client";
import React, { useEffect, useState } from "react";
import { getMetaConnection, disconnectMeta, getMetaInsights, type MetaAdAccount } from "@/lib/meta-actions";
import { setAdsAutonomy, setAdsWritesPaused } from "@/lib/otto-client-actions";
import type { AccountInsights } from "@/lib/meta-insights";
import { Button } from "@/components/ui/button";

type State =
  | { phase: "loading" }
  | { phase: "disconnected" }
  | { phase: "connected"; status?: string; accounts: MetaAdAccount[]; canWrite: boolean; adsAutonomy: string; adsWritesPaused: boolean }
  | { phase: "reconnect" }
  // F37: Meta couldn't be reached right now (network / 5xx / rate limit) — the
  // connection itself is fine, so offer a retry instead of a false reconnect scare.
  | { phase: "unreachable" };

export default function OttoConnections() {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [insights, setInsights] = useState<AccountInsights[] | null>(null);
  const [saving, setSaving] = useState<null | "autonomy" | "paused">(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function load() {
    await Promise.resolve();
    setState({ phase: "loading" });
    try {
      const res = await getMetaConnection();
      if ("error" in res || !res.connected) return setState({ phase: "disconnected" });
      if (res.transientError) return setState({ phase: "unreachable" });
      if (res.needsReconnect) return setState({ phase: "reconnect" });
      setState({
        phase: "connected",
        status: res.status,
        accounts: res.accounts ?? [],
        canWrite: res.canWrite ?? false,
        adsAutonomy: res.adsAutonomy ?? "ASK",
        adsWritesPaused: res.adsWritesPaused ?? false,
      });
    } catch {
      setState({ phase: "unreachable" });
    }
  }

  async function handleAutonomy(mode: "ASK" | "AUTO") {
    if (state.phase !== "connected") return;
    const prevMode = state.adsAutonomy;
    setSaving("autonomy");
    setSaveError(null);
    setState((s) => s.phase === "connected" ? { ...s, adsAutonomy: mode } : s);
    const res = await setAdsAutonomy(mode);
    setSaving(null);
    if ("error" in res) {
      // Server rejected — roll back the optimistic update so UI matches DB state
      setState((s) => s.phase === "connected" ? { ...s, adsAutonomy: prevMode } : s);
      setSaveError(res.error);
    }
  }

  async function handlePaused(paused: boolean) {
    if (state.phase !== "connected") return;
    const prevPaused = state.adsWritesPaused;
    setSaving("paused");
    setSaveError(null);
    setState((s) => s.phase === "connected" ? { ...s, adsWritesPaused: paused } : s);
    const res = await setAdsWritesPaused(paused);
    setSaving(null);
    if ("error" in res) {
      // Server rejected — roll back the optimistic update so UI matches DB state
      setState((s) => s.phase === "connected" ? { ...s, adsWritesPaused: prevPaused } : s);
      setSaveError(res.error);
    }
  }
  useEffect(() => { queueMicrotask(() => void load()); }, []);

  useEffect(() => {
    if (state.phase !== "connected") return;
    void getMetaInsights("last_30d").then((res) => {
      if ("accounts" in res) setInsights(res.accounts);
    });
  }, [state.phase]);

  return (
    // leading-[1.5] — design-baseline body line-height (Analytics standard)
    <div className="gb leading-[1.5]" style={{ flex: 1, overflow: "auto", padding: "1.25rem" }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <h2 className="text-foreground" style={{ margin: 0, fontSize: "1.125rem" }}>Connections</h2>
        <p className="text-muted-foreground text-[0.875rem]" style={{ margin: "0.25rem 0 1rem" }}>
          Connect Instagram and Facebook so Otto can schedule posts, remind you to post, and read results — auto-publish is coming soon. Otto never changes an ad on its own — every change needs your approval, and the controls below stay in your hands.
        </p>

        <div className="bg-card border border-border rounded-[14px]" style={{ padding: "1rem" }}>
          <div className="text-foreground font-semibold" style={{ fontSize: 15 }}>Meta (Facebook &amp; Instagram Ads)</div>

          {state.phase === "loading" && (
            <div style={{ marginTop: "0.5rem", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "0.5rem" }}>
              <p className="text-muted-foreground text-[0.75rem]" style={{ margin: 0 }}>
                Checking…
              </p>
              <Button asChild size="sm" variant="ghost">
                <a href="/api/meta/authorize" style={{ textDecoration: "none" }}>
                  Connect Meta
                </a>
              </Button>
            </div>
          )}

          {state.phase === "disconnected" && (
            <Button asChild size="sm" variant="brand" className="mt-2">
              <a href="/api/meta/authorize" style={{ textDecoration: "none" }}>
                Connect Meta
              </a>
            </Button>
          )}

          {state.phase === "unreachable" && (
            <div style={{ marginTop: "0.5rem", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "0.5rem" }}>
              <p className="text-muted-foreground text-[0.75rem]" style={{ margin: 0 }}>
                Couldn&rsquo;t reach Meta just now — this is usually temporary. Your connection is fine.
              </p>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <Button type="button" size="sm" variant="ghost" onClick={() => void load()}>
                  Retry
                </Button>
                <Button asChild size="sm" variant="brand">
                  <a href="/api/meta/authorize" style={{ textDecoration: "none" }}>
                    Reconnect Meta
                  </a>
                </Button>
              </div>
            </div>
          )}

          {state.phase === "reconnect" && (
            <div style={{ marginTop: "0.5rem" }}>
              <p className="text-[var(--error-soft-foreground)] text-[0.75rem]">Your Meta connection expired.</p>
              <Button asChild size="sm" variant="brand">
                <a href="/api/meta/authorize" style={{ textDecoration: "none" }}>Reconnect</a>
              </Button>
            </div>
          )}

          {state.phase === "connected" && (
            <div style={{ marginTop: "0.5rem" }}>
              <div className="text-muted-foreground text-[0.75rem]" style={{ marginBottom: "0.5rem" }}>Connected · {state.accounts.length} ad account{state.accounts.length === 1 ? "" : "s"}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                {state.accounts.map((a) => {
                  const ins = insights?.find((i) => i.accountId === a.id);
                  const m = ins?.metrics;
                  return (
                    <div key={a.id} className="border-b border-border" style={{ padding: "4px 0" }}>
                      <div className="text-foreground text-[0.8125rem]" style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>{a.name || a.id}</span>
                        <span className="text-muted-foreground">{a.currency}{a.status ? ` · ${a.status}` : ""}</span>
                      </div>
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
              {state.canWrite ? (
                <div className="border-t border-border" style={{ marginTop: "1rem", paddingTop: "0.75rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  {/* Autonomy selector */}
                  <div>
                    <div className="text-foreground font-semibold text-[0.8125rem]" style={{ marginBottom: "0.25rem" }}>Otto autonomy</div>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <Button
                        type="button"
                        size="sm"
                        variant={state.adsAutonomy === "ASK" ? "brand" : "ghost"}
                        disabled={saving === "autonomy"}
                        onClick={() => void handleAutonomy("ASK")}
                      >
                        Ask
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={state.adsAutonomy === "AUTO" ? "brand" : "ghost"}
                        disabled={saving === "autonomy"}
                        onClick={() => void handleAutonomy("AUTO")}
                      >
                        Auto
                      </Button>
                    </div>
                    <p className="text-muted-foreground text-[0.75rem]" style={{ margin: "0.25rem 0 0" }}>
                      {state.adsAutonomy === "AUTO"
                        ? "Auto lets Otto pause ads & lower budgets on its own — anything that spends still asks you."
                        : "Ask (default) — Otto always asks before making changes."}
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
                      variant={state.adsWritesPaused ? "destructive" : "ghost"}
                      disabled={saving === "paused"}
                      onClick={() => void handlePaused(!state.adsWritesPaused)}
                    >
                      {state.adsWritesPaused ? "Paused — resume?" : "Pause"}
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
      </div>
    </div>
  );
}
