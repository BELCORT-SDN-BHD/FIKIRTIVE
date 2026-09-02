import { getMyAccount } from "@/lib/account-actions";
import { getSpendOverview } from "@/lib/spend-history-data";
import { listCreditPacks } from "@/lib/billing-actions";
import { BuyPackButton } from "@/components/billing/BuyPackButton";
import { SpendHistory } from "@/components/billing/SpendHistory";
import { Card } from "@/components/ui/card";
import { Wallet } from "lucide-react";
import { creditsLabel, formatCredits } from "@/lib/credit-format";
import { displayCredits, pricedUnderstandingCredits } from "@fikirtive/core/spend";
import { OTTO_CHAT_MAX_SEARCHES_PER_TURN } from "@fikirtive/core/pricing-config";
import { SEARCH_TURN_MAX_LABEL, SEARCH_UNIT_LABEL } from "@/components/otto/SearchCostHint";
import { CREDIT_PACKS_UNREADABLE_MESSAGE, NO_CREDIT_PACKS_MESSAGE } from "@/lib/exits";
import { SupportExit } from "@/components/exits/Exits";

export const dynamic = "force-dynamic";
export const metadata = { title: "Billing · Fikirtive" };

/** MONEY-A9 §7.3 — the price list side of the upload disclosure. Same functions the upload
 *  hint and the charge itself run (`pricedUnderstandingCredits`), so the shelf page and the
 *  file picker can never quote two different numbers; nothing here is typed by hand. */
function understandingPrice(kind: "image-caption" | "doc-extract" | "video-qa"): string {
  return creditsLabel(displayCredits(pricedUnderstandingCredits(kind)));
}

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
  const [accountResult, shelf, spendResult] = await Promise.all([
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
            Checkout canceled. No charge was made.
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
          {/* MONEY-A5 §2 验收表 — the one term a merchant can only learn by being told.
              九问 1 lists "credits 永不过期" among the things a merchant never sees, and the
              acceptance row is explicit that the ABSENCE of an expiry code path does not pass
              this line: without the sentence on a merchant-visible surface, the row fails.
              It sits under the balance because that is the number the promise is about, and
              it renders in both states — a merchant whose balance failed to load has MORE
              reason to wonder whether the credits are still there, not less. */}
          <div className="text-muted-foreground" style={{ fontSize: 13, marginTop: 10 }}>
            Credits don&apos;t expire — what you buy stays yours until you spend it.
          </div>
        </Card>

        <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 12px" }}>Top up</h2>

        {"unreadable" in shelf ? (
          // #786 — we did not read the shelf, so we may not say it is empty, and we may not
          // hand out a human exit either: a catalogue read that failed is a retryable state,
          // and this layer's fence is "no human exit on a retryable error".
          <div className="text-muted-foreground" style={{ fontSize: 14 }}>
            {CREDIT_PACKS_UNREADABLE_MESSAGE}
          </div>
        ) : shelf.packs.length === 0 ? (
          // #687 — one sentence for one state (Settings renders the same constant), and an
          // exit: a merchant on this page has already decided to pay, so "there is nothing
          // here" cannot be the last thing the product says to them.
          <div className="text-muted-foreground" style={{ fontSize: 14 }}>
            {NO_CREDIT_PACKS_MESSAGE} <SupportExit subject="I want to buy credits" />
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {shelf.packs.map((pack) => (
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

        {/* MONEY-A9 §7.3 — the price list for the one charge a merchant never asked for:
            every image and video they upload is read automatically. The upload entries carry
            the same numbers as a one-line hint (components/otto/UnderstandingCostHint.tsx);
            this section is the fuller version, on the page where prices belong. */}
        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 4px" }}>Auto-understanding</h2>
          <div className="text-muted-foreground" style={{ fontSize: 14, lineHeight: 1.5 }}>
            Every image and video you upload is read automatically so Otto knows what is in it:{" "}
            {understandingPrice("image-caption")} an image and {understandingPrice("video-qa")} a
            video. An image that turns out to be a menu or a price list is also read as a
            document, for {understandingPrice("doc-extract")} more. You are charged the price in
            effect when the file is queued for understanding — normally the moment you upload —
            even if the reading finishes later. Files added before automatic understanding was
            priced stay free.
          </div>
        </section>

        {/* MONEY-A10 §7.4 — the chat turn's second money leg. Founder 2026-09-02 (变更登记
            「A10 聊天搜索的商家侧披露」): a price that lives only inside Otto's system prompt is
            not disclosed to anyone who can read it. The composer carries the one-line version
            (components/otto/SearchCostHint.tsx); this is the fuller one, and it is where the
            spend-cap exemption that ruling ACCEPTED gets written down — an accepted gap in a
            control the merchant themselves set has to be visible to the merchant, not only to
            us. Every number is the same constant the turn reserves and settles against. */}
        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 4px" }}>Web search in chat</h2>
          <div className="text-muted-foreground" style={{ fontSize: 14, lineHeight: 1.5 }}>
            When a question needs current information, Otto searches the web: {SEARCH_UNIT_LABEL}{" "}
            per search, and one message can make at most{" "}
            {String(OTTO_CHAT_MAX_SEARCHES_PER_TURN)} searches. You are charged only for searches
            that complete — including one that comes back empty-handed — and never for a search
            that fails, or for reading a page whose address you gave Otto. These searches ride
            inside that message&apos;s own charge, so your per-action spend cap does not stop
            them; at most {SEARCH_TURN_MAX_LABEL} of search can be added to one message.
          </div>
        </section>

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
