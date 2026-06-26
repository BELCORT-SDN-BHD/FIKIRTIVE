"use client";
import React, { useState } from "react";
import { LogOut, Wallet } from "lucide-react";
import { Card, Button } from "@/components/fk";
import { signOutAction, type AccountInfo } from "@/lib/account-actions";
import { CREDIT_PACKS, type PackKey } from "@/lib/stripe-packs";
import { createTopupCheckout } from "@/lib/topup-actions";

function whenLabel(at: string): string {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function OttoAccount({ account }: { account: AccountInfo | null }) {
  const [topupError, setTopupError] = useState<string | null>(null);
  const [loadingPack, setLoadingPack] = useState<PackKey | null>(null);

  async function handleTopup(key: PackKey) {
    setTopupError(null);
    setLoadingPack(key);
    try {
      const result = await createTopupCheckout(key);
      if ("error" in result) {
        setTopupError(result.error);
      } else {
        window.location.href = result.url;
      }
    } finally {
      setLoadingPack(null);
    }
  }

  if (!account) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}>
        Couldn&rsquo;t load your account right now.
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "var(--space-6)" }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: "var(--weight-bold)" as React.CSSProperties["fontWeight"], fontSize: "var(--text-2xl)", color: "var(--text-strong)", margin: 0 }}>
          Account
        </h1>
        <p style={{ fontSize: "var(--text-base)", color: "var(--text-muted)", marginTop: "var(--space-2)", marginBottom: "var(--space-5)" }}>
          {account.email}
        </p>

        {/* Balance */}
        <Card variant="tint" padding="lg">
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>
            <Wallet size={18} color="var(--brand)" /> Your credit balance
          </div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: "var(--weight-bold)" as React.CSSProperties["fontWeight"], fontSize: "var(--text-4xl, 2.5rem)", color: "var(--text-strong)", marginTop: "var(--space-2)" }}>
            ${account.balanceUsd.toFixed(2)}
          </div>
          {account.reserved > 0 && (
            <div style={{ fontSize: "var(--text-sm)", color: "var(--text-faint)", marginTop: 4 }}>
              {account.reserved} credits held for work in progress
            </div>
          )}
        </Card>

        {/* Add credits */}
        <h2 style={{ fontFamily: "var(--font-display)", fontWeight: "var(--weight-semibold)" as React.CSSProperties["fontWeight"], fontSize: "var(--text-lg)", color: "var(--text-strong)", marginTop: "var(--space-6)", marginBottom: "var(--space-3)" }}>
          Add credits
        </h2>
        <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
          {(Object.values(CREDIT_PACKS) as (typeof CREDIT_PACKS)[PackKey][]).map((pack) => (
            <Button
              key={pack.key}
              variant="secondary"
              size="md"
              disabled={loadingPack !== null}
              onClick={() => handleTopup(pack.key)}
            >
              {loadingPack === pack.key ? "Opening…" : `${pack.displayCredits} credits · $${pack.usd}`}
            </Button>
          ))}
        </div>
        {topupError && (
          <p style={{ fontSize: "var(--text-sm)", color: "var(--error, #dc2626)", marginTop: "var(--space-2)" }}>
            {topupError}
          </p>
        )}

        {/* Where your money went */}
        <h2 style={{ fontFamily: "var(--font-display)", fontWeight: "var(--weight-semibold)" as React.CSSProperties["fontWeight"], fontSize: "var(--text-lg)", color: "var(--text-strong)", marginTop: "var(--space-6)", marginBottom: "var(--space-3)" }}>
          Where your money went
        </h2>
        {account.recent.length === 0 ? (
          <div style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>No activity yet.</div>
        ) : (
          <Card variant="default" padding="md">
            <div style={{ display: "flex", flexDirection: "column" }}>
              {account.recent.map((a, i) => (
                <div
                  key={a.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "var(--space-3)",
                    padding: "12px 0",
                    borderTop: i === 0 ? "none" : "1px solid var(--border-subtle)",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "var(--text-sm)", color: "var(--text-body)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.label}</div>
                    <div style={{ fontSize: "var(--text-xs)", color: "var(--text-faint)" }}>{whenLabel(a.at)}</div>
                  </div>
                  <div
                    style={{
                      flex: "none",
                      fontWeight: "var(--weight-semibold)" as React.CSSProperties["fontWeight"],
                      fontSize: "var(--text-sm)",
                      color: a.delta > 0 ? "var(--success-700)" : "var(--text-strong)",
                    }}
                  >
                    {a.delta > 0 ? `+${a.delta}` : a.delta} credits
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Sign out */}
        <div style={{ marginTop: "var(--space-8)" }}>
          <form action={signOutAction}>
            <Button type="submit" variant="secondary" size="md" leftIcon={<LogOut size={18} />}>
              Sign out
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default OttoAccount;
