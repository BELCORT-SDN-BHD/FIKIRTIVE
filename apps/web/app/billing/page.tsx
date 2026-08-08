import { getMyAccount } from "@/lib/account-actions";
import { getSpendOverview } from "@/lib/spend-history-data";
import { listCreditPacks } from "@/lib/billing-actions";
import { BuyPackButton } from "@/components/billing/BuyPackButton";
import { SpendHistory } from "@/components/billing/SpendHistory";
import { Card } from "@/components/ui/card";
import { Wallet } from "lucide-react";
import { formatCredits } from "@/lib/credit-format";
import { NO_CREDIT_PACKS_MESSAGE } from "@/lib/exits";
import { SupportExit } from "@/components/exits/Exits";

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
  const [accountResult, packs, spendResult] = await Promise.all([
    getMyAccount(),
    listCreditPacks(),
    getSpendOverview(),
  ]);
  const account = "error" in accountResult ? null : accountResult;
  const spend = "error" in spendResult ? null : spendResult;

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
                {formatCredits(account.balance)}{" "}
                <span className="text-muted-foreground" style={{ fontSize: 18, fontWeight: 500 }}>
                  credits
                </span>
              </div>
              {account.reserved > 0 ? (
                <div className="text-muted-foreground" style={{ fontSize: 14, marginTop: 4 }}>
                  {formatCredits(account.reserved)} held for work in progress
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
          // #687 — one sentence for one state (Settings renders the same constant), and an
          // exit: a merchant on this page has already decided to pay, so "there is nothing
          // here" cannot be the last thing the product says to them.
          <div className="text-muted-foreground" style={{ fontSize: 14 }}>
            {NO_CREDIT_PACKS_MESSAGE} <SupportExit subject="I want to buy credits" />
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
                      {formatCredits(pack.credits)} credits · {fmtPrice(pack.amountCents, pack.currency)}
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

        {/* #555: where the credits went. Conversation turns (Chat / Review) are listed
            here like any other charge — before this, the page showed only a balance. */}
        {spend ? (
          <SpendHistory entries={spend.entries} window={spend.window} />
        ) : (
          <section style={{ marginTop: 28 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 4px" }}>Spend history</h2>
            <div className="text-muted-foreground" style={{ fontSize: 14 }}>
              Could not load your spend history. Please refresh.
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
