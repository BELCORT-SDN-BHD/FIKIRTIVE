import { getMyAccount } from "@/lib/account-actions";
import { getOwnerSettings } from "@/lib/owner-settings-actions";
import { getSpendOverview } from "@/lib/spend-history-data";
import { listCreditPacks } from "@/lib/billing-actions";
import { BuyPackButton } from "@/components/billing/BuyPackButton";
import { SpendHistory } from "@/components/billing/SpendHistory";
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
import { Coins, Gauge, Globe, ScanEye, ShieldCheck, WalletCards } from "lucide-react";
import { creditsLabel, formatCredits } from "@/lib/credit-format";
import { displayCredits, pricedUnderstandingCredits } from "@fikirtive/core/spend";
import { OTTO_CHAT_MAX_SEARCHES_PER_TURN } from "@fikirtive/core/pricing-config";
import { SEARCH_TURN_MAX_LABEL, SEARCH_UNIT_LABEL } from "@/components/otto/SearchCostHint";
import { CREDIT_PACKS_UNREADABLE_MESSAGE, NO_CREDIT_PACKS_MESSAGE } from "@/lib/exits";
import { SupportExit } from "@/components/exits/Exits";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { SpendCapCard } from "./SpendCapCard";

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
  const [accountResult, shelf, spendResult, settingsResult] = await Promise.all([
    getMyAccount(),
    listCreditPacks(),
    getSpendOverview(),
    getOwnerSettings(),
  ]);
  const account = "error" in accountResult ? null : accountResult;
  const spend = "error" in spendResult ? null : spendResult;
  // 读不到就说读不到。渲染一个 0 会变成「No cap set」——那是一句我们没有证据的话,
  // 而商家的动作可能正被一个我们此刻读不出来的上限拦着。
  const settings = settingsResult && !("error" in settingsResult) ? settingsResult : null;

  return (
    <SettingsShell
      active="billing"
      title="Billing & credits"
      description="Review your credit balances, spend cap, top-ups and every credit movement."
      scopeNote="Changes affect everyone in this workspace."
    >
      {/* 已冻结的 Settings pattern(夹具 `BillingContent`):一列 `max-w-3xl`,每个 section
          是「图标 + 一行标题 + 一句说明」,内容落进一个带边框的 divide-y 列表,不是一堆
          并排的 marketing card。Founder 2026-09-03 裁决:排版按设计,主干的三条花钱披露
          (花费上限 / 自动理解 / 网页搜索)口径一字不改,只换外观。 */}
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 py-8">
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

        <section>
          <div className="flex items-start gap-3">
            <Coins className="mt-0.5 size-5 shrink-0" aria-hidden />
            <div>
              <h2 className="text-base font-semibold">Credits</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                What this workspace can spend, and what is currently held for work in progress.
              </p>
            </div>
          </div>
          <div className="mt-4 divide-y divide-border rounded-[var(--radius-card)] border border-border">
            {account ? (
              <div className="grid gap-6 px-4 py-5 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Available balance</p>
                  <p className="mt-2 font-mono text-xl font-semibold tabular-nums">
                    {formatCredits(account.balance)}{" "}
                    <span className="font-sans text-sm font-medium text-muted-foreground">credits</span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">Shared across creation, research, and Otto.</p>
                </div>
                <div className="sm:border-l sm:border-border sm:pl-6">
                  <p className="text-xs font-medium text-muted-foreground">On hold</p>
                  <div className="mt-2">
                    {account.reserved > 0 ? (
                      <Badge variant="warning">{formatCredits(account.reserved)} credits held</Badge>
                    ) : (
                      <Badge variant="success">Nothing on hold</Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Held credits belong to work in progress. Unused credits return automatically when that work settles.
                  </p>
                </div>
              </div>
            ) : (
              <div className="px-4 py-5">
                <Alert role="alert" variant="warning">
                  <AlertTitle>Balance unavailable</AlertTitle>
                  <AlertDescription>Refresh to try reading it again.</AlertDescription>
                </Alert>
              </div>
            )}
            {/* MONEY-A5 §2 验收表 — the one term a merchant can only learn by being told.
                九问 1 lists "credits 永不过期" among the things a merchant never sees, and the
                acceptance row is explicit that the ABSENCE of an expiry code path does not pass
                this line: without the sentence on a merchant-visible surface, the row fails.
                It sits under the balance because that is the number the promise is about, and
                it renders in both states — a merchant whose balance failed to load has MORE
                reason to wonder whether the credits are still there, not less. */}
            <p className="px-4 py-4 text-sm text-muted-foreground">
              Credits don&apos;t expire — what you buy stays yours until you spend it.
            </p>
          </div>
        </section>

        <section>
          <div className="flex items-start gap-3">
            <WalletCards className="mt-0.5 size-5 shrink-0" aria-hidden />
            <div>
              <h2 className="text-base font-semibold">Top up credits</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                One-time purchases. Choose only what this workspace needs.
              </p>
            </div>
          </div>

          {"unreadable" in shelf ? (
            // #786 — we did not read the shelf, so we may not say it is empty, and we may not
            // hand out a human exit either: a catalogue read that failed is a retryable state.
            <Alert role="alert" variant="warning" className="mt-4">
              <AlertTitle>Credit packs unavailable</AlertTitle>
              <AlertDescription>{CREDIT_PACKS_UNREADABLE_MESSAGE}</AlertDescription>
            </Alert>
          ) : shelf.packs.length === 0 ? (
            // #687 — one sentence for one state (Settings renders the same constant), and an
            // exit for a merchant who has already decided to pay.
            <Empty className="mt-4 border">
              <EmptyHeader>
                <EmptyMedia variant="icon"><WalletCards aria-hidden /></EmptyMedia>
                <EmptyTitle>No packs to buy</EmptyTitle>
                <EmptyDescription>{NO_CREDIT_PACKS_MESSAGE}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent><SupportExit subject="I want to buy credits" /></EmptyContent>
            </Empty>
          ) : (
            <div className="mt-4 divide-y divide-border rounded-[var(--radius-card)] border border-border">
              {shelf.packs.map((pack) => (
                <div key={pack.priceId} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{formatCredits(pack.credits)} credits</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {pack.label} · {fmtPrice(pack.amountCents, pack.currency)} one time · added to this
                      workspace after checkout is confirmed
                    </p>
                  </div>
                  <div className="sm:w-48 sm:shrink-0">
                    <BuyPackButton
                      priceId={pack.priceId}
                      label={`Buy for ${fmtPrice(pack.amountCents, pack.currency)}`}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 花费上限(前端基线合并 FRONT-A1)。换壳之后它没有任何路由渲染过 —— 服务端照旧
            按它拒绝动作,商家却看不见也改不了。它属于余额这一页:被限制的数字就在上面。
            第⑦段只换外观:控件本体、写入路径、四条围栏行为一字未动。 */}
        <section>
          <div className="flex items-start gap-3">
            <Gauge className="mt-0.5 size-5 shrink-0" aria-hidden />
            <div>
              <h2 className="text-base font-semibold">Spend cap</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Your own ceiling on a single action. It never spends anything — it only refuses.
              </p>
            </div>
          </div>
          <div className="mt-4 rounded-[var(--radius-card)] border border-border px-4 py-4">
            {settings ? (
              <SpendCapCard spendCapCredits={settings.spendCapCredits} />
            ) : (
              <Alert role="alert" variant="warning">
                <AlertTitle>Spend cap unavailable</AlertTitle>
                <AlertDescription>
                  We couldn&apos;t read your spend cap, so it isn&apos;t shown here. Refresh to try again — the
                  cap itself is unchanged and still applies.
                </AlertDescription>
              </Alert>
            )}
          </div>
        </section>

        {/* MONEY-A9 §7.3 — the price list for the one charge a merchant never asked for:
            every image and video they upload is read automatically. The upload entries carry
            the same numbers as a one-line hint (components/otto/UnderstandingCostHint.tsx);
            this section is the fuller version, on the page where prices belong. */}
        <section>
          <div className="flex items-start gap-3">
            <ScanEye className="mt-0.5 size-5 shrink-0" aria-hidden />
            <div>
              <h2 className="text-base font-semibold">Auto-understanding</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Every image and video you upload is read automatically so Otto knows what is in it:{" "}
                {understandingPrice("image-caption")} an image and {understandingPrice("video-qa")} a
                video. An image that turns out to be a menu or a price list is also read as a
                document, for {understandingPrice("doc-extract")} more. You are charged the price in
                effect when the file is queued for understanding — usually right after you upload it,
                but later than that if there is a backlog. The reading itself can finish later still.
                Files added before automatic understanding was priced stay free.
              </p>
            </div>
          </div>
        </section>

        {/* MONEY-A10 §7.4 — the chat turn's second money leg. Founder 2026-09-02 (变更登记
            「A10 聊天搜索的商家侧披露」): a price that lives only inside Otto's system prompt is
            not disclosed to anyone who can read it. The composer carries the one-line version
            (components/otto/SearchCostHint.tsx); this is the fuller one, and it is where the
            spend-cap exemption that ruling ACCEPTED gets written down — an accepted gap in a
            control the merchant themselves set has to be visible to the merchant, not only to
            us. Every number is the same constant the turn reserves and settles against. */}
        <section>
          <div className="flex items-start gap-3">
            <Globe className="mt-0.5 size-5 shrink-0" aria-hidden />
            <div>
              <h2 className="text-base font-semibold">Web search in chat</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                When a question needs current information, Otto searches the web: {SEARCH_UNIT_LABEL}{" "}
                per search, and one message can make at most{" "}
                {String(OTTO_CHAT_MAX_SEARCHES_PER_TURN)}{" "}searches. You are charged only for searches
                that complete — including one that comes back empty-handed — and never for a search
                that fails, or for reading a page whose address you gave Otto. These searches ride
                inside that message&apos;s own charge, so your per-action spend cap does not stop
                them; at most {SEARCH_TURN_MAX_LABEL} of search can be added to one message.
              </p>
            </div>
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
