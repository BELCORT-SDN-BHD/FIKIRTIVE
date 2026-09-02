import { getMyAccount } from "@/lib/account-actions";
import { getSpendOverview } from "@/lib/spend-history-data";
import { listCreditPacks } from "@/lib/billing-actions";
import { BuyPackButton } from "@/components/billing/BuyPackButton";
import { SpendHistory } from "@/components/billing/SpendHistory";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ShieldCheck, WalletCards } from "lucide-react";
import { creditsLabel, formatCredits } from "@/lib/credit-format";
import { displayCredits, pricedUnderstandingCredits } from "@fikirtive/core/spend";
import { OTTO_CHAT_MAX_SEARCHES_PER_TURN } from "@fikirtive/core/pricing-config";
import { SEARCH_TURN_MAX_LABEL, SEARCH_UNIT_LABEL } from "@/components/otto/SearchCostHint";
import { CREDIT_PACKS_UNREADABLE_MESSAGE, NO_CREDIT_PACKS_MESSAGE } from "@/lib/exits";
import { SupportExit } from "@/components/exits/Exits";
import { SettingsShell } from "@/components/settings/SettingsShell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Billing & credits · Fikirtive" };

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
    <SettingsShell
      active="billing"
      title="Billing & credits"
      description="See what is available, top up this workspace, and track every credit movement."
      scopeNote="Credits and purchases belong to this workspace."
    >
      <div className="flex w-full flex-col gap-8">
        {status === "success" && (
          <Alert role="status" variant="success">
            <ShieldCheck aria-hidden />
            <AlertTitle>Payment received</AlertTitle>
            <AlertDescription>Your credits will appear here shortly.</AlertDescription>
          </Alert>
        )}
        {status === "cancel" && (
          <Alert role="status">
            <AlertTitle>Checkout canceled</AlertTitle>
            <AlertDescription>No charge was made and your balance did not change.</AlertDescription>
          </Alert>
        )}

        <section className="grid gap-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,2fr)]">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2 text-muted-foreground">
                <WalletCards className="size-4" aria-hidden />
                <span className="text-sm font-medium">Available balance</span>
              </div>
              <CardDescription>Shared across creation, research, and Otto.</CardDescription>
            </CardHeader>
            <CardContent>
              {account ? (
                <div className="flex flex-col gap-3">
                  <div className="font-mono text-4xl font-semibold tracking-tight tabular-nums">
                    {formatCredits(account.balance)} <span className="font-sans text-base font-medium text-muted-foreground">credits</span>
                  </div>
                  {account.reserved > 0 ? (
                    <Badge variant="warning">{formatCredits(account.reserved)} credits held</Badge>
                  ) : (
                    <Badge variant="success">Nothing on hold</Badge>
                  )}
                </div>
              ) : (
                <Alert role="alert" variant="warning">
                  <AlertTitle>Balance unavailable</AlertTitle>
                  <AlertDescription>Refresh to try reading it again.</AlertDescription>
                </Alert>
              )}
            </CardContent>
            <CardFooter className="flex-col items-start gap-2 border-t pt-4 text-sm text-muted-foreground">
              <p>Held credits belong to work in progress. Unused credits return automatically when that work settles.</p>
              {/* MONEY-A5 §2 验收表 — the one term a merchant can only learn by being told.
                  九问 1 lists "credits 永不过期" among the things a merchant never sees, and the
                  acceptance row is explicit that the ABSENCE of an expiry code path does not pass
                  this line: without the sentence on a merchant-visible surface, the row fails.
                  It sits under the balance because that is the number the promise is about, and
                  it renders in both states — a merchant whose balance failed to load has MORE
                  reason to wonder whether the credits are still there, not less. */}
              <p>Credits don&apos;t expire — what you buy stays yours until you spend it.</p>
            </CardFooter>
          </Card>

          <div className="flex min-w-0 flex-col gap-4">
            <div>
              <div>
                <h2 className="text-lg font-semibold">Top up credits</h2>
                <p className="text-sm text-muted-foreground">One-time purchases. Choose only what this workspace needs.</p>
              </div>
            </div>

            {"unreadable" in shelf ? (
              // #786 — we did not read the shelf, so we may not say it is empty, and we may not
              // hand out a human exit either: a catalogue read that failed is a retryable state.
              <Alert role="alert" variant="warning">
                <AlertTitle>Credit packs unavailable</AlertTitle>
                <AlertDescription>{CREDIT_PACKS_UNREADABLE_MESSAGE}</AlertDescription>
              </Alert>
            ) : shelf.packs.length === 0 ? (
              // #687 — one sentence for one state (Settings renders the same constant), and an
              // exit for a merchant who has already decided to pay.
              <Empty className="border">
                <EmptyHeader>
                  <EmptyMedia variant="icon"><WalletCards aria-hidden /></EmptyMedia>
                  <EmptyTitle>No packs to buy</EmptyTitle>
                  <EmptyDescription>{NO_CREDIT_PACKS_MESSAGE}</EmptyDescription>
                </EmptyHeader>
                <EmptyContent><SupportExit subject="I want to buy credits" /></EmptyContent>
              </Empty>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                {shelf.packs.map((pack) => (
                  <Card key={pack.priceId} size="sm">
                    <CardHeader>
                      <Badge variant="outline">{pack.label}</Badge>
                      <CardTitle>{formatCredits(pack.credits)} credits</CardTitle>
                      <CardDescription>{fmtPrice(pack.amountCents, pack.currency)} one time</CardDescription>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">
                      Added to this workspace after checkout is confirmed.
                    </CardContent>
                    <CardFooter className="mt-auto">
                      <BuyPackButton
                        priceId={pack.priceId}
                        label={`Buy for ${fmtPrice(pack.amountCents, pack.currency)}`}
                      />
                    </CardFooter>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* MONEY-A9 §7.3 — the price list for the one charge a merchant never asked for:
            every image and video they upload is read automatically. The upload entries carry
            the same numbers as a one-line hint (components/otto/UnderstandingCostHint.tsx);
            this section is the fuller version, on the page where prices belong. */}
        <section className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Auto-understanding</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Every image and video you upload is read automatically so Otto knows what is in it:{" "}
            {understandingPrice("image-caption")} an image and {understandingPrice("video-qa")} a
            video. An image that turns out to be a menu or a price list is also read as a
            document, for {understandingPrice("doc-extract")} more. You are charged the price in
            effect when the file is queued for understanding — usually right after you upload it,
            but later than that if there is a backlog. The reading itself can finish later still.
            Files added before automatic understanding was priced stay free.
          </p>
        </section>

        {/* MONEY-A10 §7.4 — the chat turn's second money leg. Founder 2026-09-02 (变更登记
            「A10 聊天搜索的商家侧披露」): a price that lives only inside Otto's system prompt is
            not disclosed to anyone who can read it. The composer carries the one-line version
            (components/otto/SearchCostHint.tsx); this is the fuller one, and it is where the
            spend-cap exemption that ruling ACCEPTED gets written down — an accepted gap in a
            control the merchant themselves set has to be visible to the merchant, not only to
            us. Every number is the same constant the turn reserves and settles against. */}
        <section className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Web search in chat</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            When a question needs current information, Otto searches the web: {SEARCH_UNIT_LABEL}{" "}
            per search, and one message can make at most{" "}
            {String(OTTO_CHAT_MAX_SEARCHES_PER_TURN)}{" "}searches. You are charged only for searches
            that complete — including one that comes back empty-handed — and never for a search
            that fails, or for reading a page whose address you gave Otto. These searches ride
            inside that message&apos;s own charge, so your per-action spend cap does not stop
            them; at most {SEARCH_TURN_MAX_LABEL} of search can be added to one message.
          </p>
        </section>

        {/* #555: where the credits went. Conversation turns (Chat / Review) are listed
            here like any other charge — before this, the page showed only a balance. */}
        {spend ? (
          <SpendHistory entries={spend.entries} window={spend.window} />
        ) : (
          <Alert role="alert" variant="warning">
            <AlertTitle>Spend history unavailable</AlertTitle>
            <AlertDescription>Refresh to try reading it again.</AlertDescription>
          </Alert>
        )}
      </div>
    </SettingsShell>
  );
}
