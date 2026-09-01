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
import { formatCredits } from "@/lib/credit-format";
import { CREDIT_PACKS_UNREADABLE_MESSAGE, NO_CREDIT_PACKS_MESSAGE } from "@/lib/exits";
import { SupportExit } from "@/components/exits/Exits";
import { SettingsShell } from "@/components/settings/SettingsShell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Billing & credits · Fikirtive" };

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
            <CardFooter className="items-start border-t pt-4 text-sm text-muted-foreground">
              Held credits belong to work in progress. Unused credits return automatically when that work settles.
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
