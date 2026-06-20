"use client";

import { useEffect, useState } from "react";
import { getMyAccount, signOutAction, type AccountInfo } from "@/lib/account-actions";
import { GlassPanel, Badge, Button, MonoLabel, IcUser } from "../ds";

function fmtUsd(usd: number): string {
  return usd.toLocaleString(undefined, { style: "currency", currency: "USD" });
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function fmtDelta(n: number): string {
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toLocaleString()}`;
}

export function Account() {
  const [info, setInfo] = useState<AccountInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getMyAccount().then((r) => {
      if (!live) return;
      if ("error" in r) setErr(r.error);
      else setInfo(r);
    });
    return () => { live = false; };
  }, []);

  return (
    <div className="screen">
      <div className="screen-pad" style={{ maxWidth: 720, margin: "0 auto", display: "grid", gap: 16 }}>
        {err ? (
          <GlassPanel><p role="alert" style={{ font: "var(--text-body)", color: "var(--danger)", margin: 0 }}>{err}</p></GlassPanel>
        ) : !info ? (
          <GlassPanel><p style={{ font: "var(--text-body)", color: "var(--fg-3)", margin: 0 }}>Loading…</p></GlassPanel>
        ) : (
          <>
            {/* Identity + sign out */}
            <GlassPanel style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <span className="al-avatar" aria-hidden style={{ display: "grid", placeItems: "center" }}><IcUser size={18} /></span>
              <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
                <span style={{ font: "var(--text-body)", color: "var(--fg-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{info.email}</span>
                {info.isFounder ? <span><Badge tone="accent" mono>Founder</Badge></span> : null}
              </div>
              <span style={{ flex: 1 }} />
              <form action={signOutAction}>
                <Button variant="ghost" size="sm" type="submit">Sign out</Button>
              </form>
            </GlassPanel>

            {/* Credits balance */}
            <GlassPanel variant="raised" style={{ display: "grid", gap: 6 }}>
              <MonoLabel>Credits</MonoLabel>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <span style={{ font: "var(--text-display)", color: "var(--fg-1)" }}>{info.balance.toLocaleString()}</span>
                <span style={{ font: "var(--text-body)", color: "var(--fg-3)" }}>≈ {fmtUsd(info.balanceUsd)}</span>
              </div>
              {info.reserved > 0 ? (
                <span style={{ font: "var(--text-caption)", color: "var(--fg-3)" }}>{info.reserved.toLocaleString()} held for in-flight generations</span>
              ) : null}
            </GlassPanel>

            {/* Recent activity */}
            <GlassPanel style={{ display: "grid", gap: 12 }}>
              <MonoLabel>Recent activity</MonoLabel>
              {info.recent.length === 0 ? (
                <p style={{ font: "var(--text-body)", color: "var(--fg-3)", margin: 0 }}>No activity yet.</p>
              ) : (
                <div style={{ display: "grid", gap: 2 }}>
                  {info.recent.map((r) => (
                    <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderTop: "1px solid var(--line-1, rgba(255,255,255,.06))" }}>
                      <span style={{ font: "var(--text-body)", color: "var(--fg-2)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
                      <span style={{ font: "var(--text-caption)", color: "var(--fg-3)" }}>{fmtDate(r.at)}</span>
                      <span style={{ font: "var(--text-body)", color: r.delta > 0 ? "var(--positive, #4ade80)" : "var(--fg-2)", minWidth: 56, textAlign: "right" }}>{fmtDelta(r.delta)}</span>
                    </div>
                  ))}
                </div>
              )}
            </GlassPanel>
          </>
        )}
      </div>
    </div>
  );
}
