import { getMyAccount } from "@/lib/account-actions";
import { listCreditPacks } from "@/lib/billing-actions";
import { BuyPackButton } from "@/components/billing/BuyPackButton";
import { Card } from "@/components/ui/card";
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
    <div className="gb" style={{ flex: 1, overflow: "auto", minHeight: "100dvh", padding: 24 }}>
      <div style={{ maxWidth: 560, margin: "0 auto" }}>
        <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.03em", margin: 0 }}>Billing</h1>
        <p className="text-muted-foreground" style={{ fontSize: 16, marginTop: 6, marginBottom: 24 }}>
          Buy credits to power your campaigns.
        </p>

        {status === "success" && (
          <div
            role="status"
            style={{
              padding: "12px 16px",
              borderRadius: "var(--radius-card)",
              background: "var(--success-soft)",
              color: "var(--success-soft-foreground)",
              fontSize: 14,
              marginBottom: 20,
            }}
          >
            Payment received. Credits will appear shortly.
          </div>
        )}
        {status === "cancel" && (
          <div
            role="status"
            style={{
              padding: "12px 16px",
              borderRadius: "var(--radius-card)",
              background: "var(--secondary)",
              color: "var(--muted-foreground)",
              fontSize: 14,
              marginBottom: 20,
            }}
          >
            Checkout cancelled. No charge was made.
          </div>
        )}

        <Card style={{ marginBottom: 20 }}>
          <div
            className="text-muted-foreground"
            style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}
          >
            <Wallet size={18} style={{ color: "var(--brand)" }} /> Your balance
          </div>
          {account ? (
            <>
              <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: "-0.02em", marginTop: 6 }}>
                {account.balance.toLocaleString()}{" "}
                <span className="text-muted-foreground" style={{ fontSize: 18, fontWeight: 500 }}>
                  credits
                </span>
              </div>
              {account.reserved > 0 ? (
                <div className="text-muted-foreground" style={{ fontSize: 14, marginTop: 4 }}>
                  {account.reserved.toLocaleString()} held for work in progress
                </div>
              ) : null}
            </>
          ) : (
            <div className="text-muted-foreground" style={{ fontSize: 14, marginTop: 6 }}>
              Could not load balance. Please refresh.
            </div>
          )}
        </Card>

        <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 12px" }}>Top up</h2>

        {packs.length === 0 ? (
          <div className="text-muted-foreground" style={{ fontSize: 14 }}>
            No credit packs are available right now.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {packs.map((pack) => (
              <Card key={pack.priceId}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 16 }}>{pack.label}</div>
                    <div className="text-muted-foreground" style={{ fontSize: 14, marginTop: 2 }}>
                      {pack.credits.toLocaleString()} credits · {fmtPrice(pack.amountCents, pack.currency)}
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
