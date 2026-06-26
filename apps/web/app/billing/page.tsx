import { getMyAccount } from "@/lib/account-actions";
import { listCreditPacks } from "@/lib/billing-actions";
import { BuyPackButton } from "@/components/billing/BuyPackButton";
import { Card } from "@/components/fk";
import { Wallet } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Billing · Fikirtive" };

function fmtPrice(amountCents: number, currency: string): string {
  return (amountCents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const [accountResult, packs] = await Promise.all([getMyAccount(), listCreditPacks()]);
  const account = "error" in accountResult ? null : accountResult;

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "var(--space-6)" }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: "var(--weight-bold)" as React.CSSProperties["fontWeight"],
            fontSize: "var(--text-2xl)",
            color: "var(--text-strong)",
            margin: 0,
          }}
        >
          Billing
        </h1>
        <p
          style={{
            fontSize: "var(--text-base)",
            color: "var(--text-muted)",
            marginTop: "var(--space-2)",
            marginBottom: "var(--space-5)",
          }}
        >
          Buy credits to power your generations.
        </p>

        {/* Status note */}
        {status === "success" && (
          <div
            role="status"
            style={{
              padding: "12px 16px",
              borderRadius: "var(--radius-card)",
              backgroundColor: "var(--success-50, #f0fdf4)",
              border: "1px solid var(--success-200, #bbf7d0)",
              color: "var(--success-700, #15803d)",
              fontSize: "var(--text-sm)",
              marginBottom: "var(--space-5)",
            }}
          >
            Payment received — credits will appear shortly.
          </div>
        )}
        {status === "cancel" && (
          <div
            role="status"
            style={{
              padding: "12px 16px",
              borderRadius: "var(--radius-card)",
              backgroundColor: "var(--surface-sunken)",
              border: "1px solid var(--border-subtle)",
              color: "var(--text-muted)",
              fontSize: "var(--text-sm)",
              marginBottom: "var(--space-5)",
            }}
          >
            Checkout cancelled — no charge was made.
          </div>
        )}

        {/* Current balance */}
        <Card variant="tint" padding="lg" style={{ marginBottom: "var(--space-5)" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-2)",
              color: "var(--text-muted)",
              fontSize: "var(--text-sm)",
            }}
          >
            <Wallet size={18} color="var(--brand)" /> Your credit balance
          </div>
          {account ? (
            <>
              <div
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: "var(--weight-bold)" as React.CSSProperties["fontWeight"],
                  fontSize: "var(--text-4xl, 2.5rem)",
                  color: "var(--text-strong)",
                  marginTop: "var(--space-2)",
                }}
              >
                ${account.balanceUsd.toFixed(2)}
              </div>
              <div style={{ fontSize: "var(--text-sm)", color: "var(--text-faint)", marginTop: 4 }}>
                {account.balance.toLocaleString()} credits
                {account.reserved > 0
                  ? ` · ${account.reserved.toLocaleString()} held for work in progress`
                  : ""}
              </div>
            </>
          ) : (
            <div style={{ fontSize: "var(--text-sm)", color: "var(--text-faint)", marginTop: "var(--space-2)" }}>
              Could not load balance — please refresh.
            </div>
          )}
        </Card>

        {/* Credit packs */}
        <h2
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: "var(--weight-semibold)" as React.CSSProperties["fontWeight"],
            fontSize: "var(--text-lg)",
            color: "var(--text-strong)",
            marginTop: "var(--space-6)",
            marginBottom: "var(--space-3)",
          }}
        >
          Top up
        </h2>

        {packs.length === 0 ? (
          <div style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>
            No credit packs are available right now.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            {packs.map((pack) => (
              <Card key={pack.priceId} variant="default" padding="md">
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "var(--space-3)",
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontWeight: "var(--weight-semibold)" as React.CSSProperties["fontWeight"],
                        fontSize: "var(--text-base)",
                        color: "var(--text-strong)",
                      }}
                    >
                      {pack.label}
                    </div>
                    <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", marginTop: 2 }}>
                      {pack.credits.toLocaleString()} credits ·{" "}
                      {fmtPrice(pack.amountCents, pack.currency)}
                    </div>
                  </div>
                  <BuyPackButton
                    priceId={pack.priceId}
                    label={`Buy · ${fmtPrice(pack.amountCents, pack.currency)}`}
                  />
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
