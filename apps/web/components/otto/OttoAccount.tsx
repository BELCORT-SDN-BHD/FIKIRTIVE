"use client";
import React from "react";
import { LogOut, Wallet } from "lucide-react";
import { Card, Button } from "@/components/fk";
import { creditsLabel } from "@/lib/credit-format";
import { signOutAction, type AccountInfo } from "@/lib/account-actions";

function whenLabel(at: string): string {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function OttoAccount({ account }: { account: AccountInfo | null }) {
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
            {creditsLabel(account.balance)}
          </div>
          {account.reserved > 0 && (
            <div style={{ fontSize: "var(--text-sm)", color: "var(--text-faint)", marginTop: 4 }}>
              {account.reserved} credits held for work in progress
            </div>
          )}
        </Card>

        {/* Where your money went */}
        <h2 style={{ fontFamily: "var(--font-display)", fontWeight: "var(--weight-semibold)" as React.CSSProperties["fontWeight"], fontSize: "var(--text-lg)", color: "var(--text-strong)", marginTop: "var(--space-6)", marginBottom: "var(--space-3)" }}>
          Where your credits went
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
