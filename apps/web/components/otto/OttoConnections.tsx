"use client";
import React, { useEffect, useState } from "react";
import { getMetaConnection, disconnectMeta, getMetaInsights, type MetaAdAccount } from "@/lib/meta-actions";
import { setAdsAutonomy, setAdsWritesPaused } from "@/lib/otto-client-actions";
import type { AccountInsights } from "@/lib/meta-insights";

type State =
  | { phase: "loading" }
  | { phase: "disconnected" }
  | { phase: "connected"; status?: string; accounts: MetaAdAccount[]; canWrite: boolean; adsAutonomy: string; adsWritesPaused: boolean }
  | { phase: "reconnect" };

export default function OttoConnections() {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [insights, setInsights] = useState<AccountInsights[] | null>(null);
  const [saving, setSaving] = useState<null | "autonomy" | "paused">(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function load() {
    setState({ phase: "loading" });
    const res = await getMetaConnection();
    if ("error" in res || !res.connected) return setState({ phase: "disconnected" });
    if (res.needsReconnect) return setState({ phase: "reconnect" });
    setState({
      phase: "connected",
      status: res.status,
      accounts: res.accounts ?? [],
      canWrite: res.canWrite ?? false,
      adsAutonomy: res.adsAutonomy ?? "ASK",
      adsWritesPaused: res.adsWritesPaused ?? false,
    });
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
  useEffect(() => { void load(); }, []);

  useEffect(() => {
    if (state.phase !== "connected") return;
    void getMetaInsights("last_30d").then((res) => {
      if ("accounts" in res) setInsights(res.accounts);
    });
  }, [state.phase]);

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "var(--space-5)" }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <h2 style={{ margin: 0, fontSize: 18, color: "var(--text-body)" }}>Connections</h2>
        <p style={{ margin: "var(--space-1) 0 var(--space-4)", color: "var(--text-muted)", fontSize: 14 }}>
          Connect your ad accounts so Otto can read your performance. Read-only — Otto can&rsquo;t spend or change your ads.
        </p>

        <div style={{ border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", background: "var(--surface-card)", padding: "var(--space-4)" }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-body)" }}>Meta (Facebook &amp; Instagram Ads)</div>

          {state.phase === "loading" && <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Checking…</p>}

          {state.phase === "disconnected" && (
            <a href="/api/meta/authorize" className="al-btn al-btn-primary al-btn-sm" style={{ display: "inline-block", marginTop: "var(--space-2)", textDecoration: "none" }}>
              Connect Meta
            </a>
          )}

          {state.phase === "reconnect" && (
            <div style={{ marginTop: "var(--space-2)" }}>
              <p style={{ color: "var(--danger, #d65a5a)", fontSize: 13 }}>Your Meta connection expired.</p>
              <a href="/api/meta/authorize" className="al-btn al-btn-primary al-btn-sm" style={{ display: "inline-block", textDecoration: "none" }}>Reconnect</a>
            </div>
          )}

          {state.phase === "connected" && (
            <div style={{ marginTop: "var(--space-2)" }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: "var(--space-2)" }}>Connected · {state.accounts.length} ad account{state.accounts.length === 1 ? "" : "s"}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
                {state.accounts.map((a) => {
                  const ins = insights?.find((i) => i.accountId === a.id);
                  const m = ins?.metrics;
                  return (
                    <div key={a.id} style={{ padding: "4px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--text-body)" }}>
                        <span>{a.name || a.id}</span>
                        <span style={{ color: "var(--text-muted)" }}>{a.currency}{a.status ? ` · ${a.status}` : ""}</span>
                      </div>
                      {m && (
                        <div style={{ fontSize: 12, color: "var(--text-muted)", paddingLeft: 2, marginTop: 2 }}>
                          {m.spend ? `Spent ${m.spend}` : "—"} · {m.impressions ?? "—"} impr · CTR {m.ctr ?? "—"}% · CPC {m.cpc ?? "—"} · {m.purchaseRoas ? `ROAS ${m.purchaseRoas}` : "no conversion tracking"}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {/* ── Autonomy + Kill-switch controls (only when write permission granted) ── */}
              {state.canWrite ? (
                <div style={{ marginTop: "var(--space-4)", borderTop: "1px solid var(--border-subtle)", paddingTop: "var(--space-3)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                  {/* Autonomy selector */}
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-body)", marginBottom: "var(--space-1)" }}>Otto autonomy</div>
                    <div style={{ display: "flex", gap: "var(--space-2)" }}>
                      <button
                        type="button"
                        className={`al-btn al-btn-sm${state.adsAutonomy === "ASK" ? " al-btn-primary" : ""}`}
                        disabled={saving === "autonomy"}
                        onClick={() => void handleAutonomy("ASK")}
                      >
                        Ask
                      </button>
                      <button
                        type="button"
                        className={`al-btn al-btn-sm${state.adsAutonomy === "AUTO" ? " al-btn-primary" : ""}`}
                        disabled={saving === "autonomy"}
                        onClick={() => void handleAutonomy("AUTO")}
                      >
                        Auto
                      </button>
                    </div>
                    <p style={{ margin: "var(--space-1) 0 0", fontSize: 12, color: "var(--text-muted)" }}>
                      {state.adsAutonomy === "AUTO"
                        ? "Auto lets Otto pause ads & lower budgets on its own — anything that spends still asks you."
                        : "Ask (default) — Otto always asks before making changes."}
                    </p>
                  </div>

                  {/* Kill-switch */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-body)" }}>Pause all ad changes</div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Otto cannot change any ad until you unpause.</div>
                    </div>
                    <button
                      type="button"
                      className={`al-btn al-btn-sm${state.adsWritesPaused ? " al-btn-danger" : ""}`}
                      disabled={saving === "paused"}
                      onClick={() => void handlePaused(!state.adsWritesPaused)}
                    >
                      {state.adsWritesPaused ? "Paused — resume?" : "Pause"}
                    </button>
                  </div>

                  {saveError && <p style={{ margin: 0, fontSize: 12, color: "var(--danger, #d65a5a)" }}>{saveError}</p>}
                </div>
              ) : (
                <p style={{ marginTop: "var(--space-3)", fontSize: 13, color: "var(--text-muted)" }}>
                  Reconnect to let Otto manage your ads.
                </p>
              )}

              <button type="button" className="al-btn al-btn-sm" style={{ marginTop: "var(--space-3)" }} onClick={async () => { await disconnectMeta(); void load(); }}>
                Disconnect
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
