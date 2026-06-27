"use client";
import React, { useEffect, useState } from "react";
import { getMetaConnection, disconnectMeta, type MetaAdAccount } from "@/lib/meta-actions";

type State =
  | { phase: "loading" }
  | { phase: "disconnected" }
  | { phase: "connected"; status?: string; accounts: MetaAdAccount[] }
  | { phase: "reconnect" };

export default function OttoConnections() {
  const [state, setState] = useState<State>({ phase: "loading" });

  async function load() {
    setState({ phase: "loading" });
    const res = await getMetaConnection();
    if ("error" in res || !res.connected) return setState({ phase: "disconnected" });
    if (res.needsReconnect) return setState({ phase: "reconnect" });
    setState({ phase: "connected", status: res.status, accounts: res.accounts ?? [] });
  }
  useEffect(() => { void load(); }, []);

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
                {state.accounts.map((a) => (
                  <div key={a.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--text-body)", padding: "4px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                    <span>{a.name || a.id}</span>
                    <span style={{ color: "var(--text-muted)" }}>{a.currency}{a.status ? ` · ${a.status}` : ""}</span>
                  </div>
                ))}
              </div>
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
