"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  FolderKanban,
  Image as ImageIcon,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Video as VideoIcon,
  XCircle,
} from "lucide-react";
import { displayCredits } from "@fikirtive/core/spend";
// The shared money words (#699's single format): thousands grouping and the 1-decimal rule that
// every other credit figure in the product already obeys. This page hand-wrote the singular/
// plural nine times instead, so a fractional balance printed here with every digit it had while
// the same balance read "1,234.6 credits" one screen over.
import { creditsLabel } from "@/lib/credit-format";
import {
  confirmCampaignGeneration,
  quoteCampaignGeneration,
  type CampaignGenQuote,
  type CampaignGenQuoteLine,
  type CampaignGenQuoteResult,
  type CampaignVideoMenu,
  type CampaignVideoSpec,
  type ConfirmCampaignGenerationResult,
} from "@/lib/campaign-generation-confirm";
import type { BatchInterruption } from "@/lib/factory-batch";
import { notifyBalanceRefresh } from "@/lib/balance-refresh";
import { getCampaign } from "@/lib/campaign-view-data";
import { CAMPAIGN_DISPATCH_IN_FLIGHT } from "@/lib/campaign-approval-lock";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CampaignNav } from "./campaign-nav";

type DetailResult = Awaited<ReturnType<typeof getCampaign>>;
type QuoteResult = CampaignGenQuoteResult;
type QuoteSnapshot = {
  quote: CampaignGenQuote | null;
  balanceDisplayCredits: number;
  videoMenu: CampaignVideoMenu | null;
};
type BatchResult = Extract<ConfirmCampaignGenerationResult, { ok: true }>["result"];

export function campaignGenerationResultTitle(
  result: Pick<BatchResult, "dispatched" | "failed" | "reused">,
  interruption: Pick<BatchInterruption, "current"> | null,
  /** #708 修复轮 P2-1：复用的那些条目是**真做完了**，还是还在跑。默认按「做完了」处理，
   *  调用方拿得到状态时必须传真值——一单还在跑的片子不许被写成已完成。 */
  reusedAllDone = true,
):
  | "Generation did not start"
  | "Generation partly started"
  | "Generation started"
  | "Everything was already generated"
  | "Everything is already being made" {
  const currentUnknown = interruption?.current === "unknown";
  if (result.dispatched === 0 && !currentUnknown) {
    // #708 同源症状 ①：对一份**已经做完**的工作说「没开始」，读起来像失败。什么都没派发
    // 有两种完全不同的原因，标题必须分开说：一件也没做成 vs 早就在做/做完了。
    if (result.failed === 0 && result.reused > 0 && !interruption) {
      return reusedAllDone ? "Everything was already generated" : "Everything is already being made";
    }
    return "Generation did not start";
  }
  if (interruption || result.failed > 0) return "Generation partly started";
  return "Generation started";
}

export default function CampaignConfirmPage({
  campaignId,
  detail,
  quote,
}: {
  campaignId: string;
  detail: DetailResult;
  quote: QuoteResult;
}) {
  if ("error" in detail) {
    return (
      <Shell>
        <section className="mt-7 rounded-[var(--radius-card)] border border-error-soft bg-card p-6 shadow-sm">
          <AlertCircle className="size-6 text-destructive" />
          <h1 className="mt-4 text-2xl font-semibold">This campaign is not available</h1>
          <p className="mt-2 text-sm text-muted-foreground">{detail.error}</p>
          <Button asChild variant="secondary" className="mt-5">
            <Link href="/campaign"><ArrowLeft />Back to campaigns</Link>
          </Button>
        </section>
      </Shell>
    );
  }
  return <ConfirmWorkspace campaignId={campaignId} initial={detail} initialQuote={quote} />;
}

function ConfirmWorkspace({
  campaignId,
  initial,
  initialQuote,
}: {
  campaignId: string;
  initial: Extract<DetailResult, { ok: true }>;
  initialQuote: QuoteResult;
}) {
  const campaign = initial.campaign;
  const projects = campaign.grouped.projects;
  const entriesById = useMemo(
    () => Object.fromEntries((campaign.plan?.entries ?? []).map((entry) => [entry.id, entry])),
    [campaign.plan],
  );
  const [quoteSnapshot, setQuoteSnapshot] = useState<QuoteSnapshot>(
    "ok" in initialQuote
      ? {
          quote: initialQuote.quote,
          balanceDisplayCredits: initialQuote.balanceDisplayCredits,
          videoMenu: initialQuote.videoMenu,
        }
      : { quote: null, balanceDisplayCredits: 0, videoMenu: null },
  );

  // Quote lines are the server-authoritative review snapshot. Do not filter them through the
  // separately loaded detail snapshot: those reads happen in parallel and could observe
  // different plan versions. Optional hook/platform labels may come from detail; paid content
  // always renders from line.brief and is bound by the quote fingerprint.
  const approvedLines = quoteSnapshot.quote?.lines ?? [];
  // #708：这是「真会离开余额的数」—— 已经生成过的条目服务端已计 0。总额、余额判断与
  // 按钮禁用全部读它，所以商家再也不会被一个他不用付的差额挡在门外。
  const totalDisplayCredits = quoteSnapshot.quote?.totalDisplayCredits ?? 0;
  const contentFingerprint = quoteSnapshot.quote?.contentFingerprint ?? "";
  const deliveryFingerprint = quoteSnapshot.quote?.deliveryFingerprint ?? "";
  const reusedCount = quoteSnapshot.quote?.reusedCount ?? 0;
  const blockedCount = quoteSnapshot.quote?.blockedCount ?? 0;
  const balanceDisplayCredits = quoteSnapshot.balanceDisplayCredits;
  const videoMenu = quoteSnapshot.videoMenu;
  const insufficientCredits = balanceDisplayCredits < totalDisplayCredits;
  const hasVideoLines = approvedLines.some((line) => line.kind === "video");
  const nothingLeftToGenerate = approvedLines.length > 0 && reusedCount === approvedLines.length;

  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [quoting, setQuoting] = useState(false);
  // 报价与当前选择已经对不上(上一次重报价失败)。此时确认按钮必须锁住 —— 否则就是
  // 「当前项目配旧项目的报价」(#708 修复轮 P2-2)。
  const [quoteStale, setQuoteStale] = useState(false);
  const [error, setError] = useState<string | null>("error" in initialQuote ? initialQuote.error : null);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [interruption, setInterruption] = useState<BatchInterruption | null>(null);
  // 请求序号栅栏（与 crm/segments-page 的 previewSequence 同一形状）：并发重报价的响应
  // 可以乱序返回，只有**最后一次发出**的那一次有资格写快照、清错、解禁按钮。
  const quoteSequence = useRef(0);

  // Every choice that can move the price re-asks the SERVER for the price. The browser never
  // computes or adjusts a credit number — it only renders the one the server just sent, and
  // confirmation is blocked while a re-quote is in flight so a stale number can never be signed.
  async function requote(nextProjectId: string, nextVideoSpec: CampaignVideoSpec | null) {
    const sequence = ++quoteSequence.current;
    setQuoting(true);
    try {
      const response = await quoteCampaignGeneration(campaignId, {
        projectId: nextProjectId || null,
        videoSpec: nextVideoSpec,
      });
      if (sequence !== quoteSequence.current) return; // 过期响应：更晚的一次已经在路上
      if ("error" in response) {
        setError(response.error);
        setQuoteStale(true);
        return;
      }
      setQuoteSnapshot({
        quote: response.quote,
        balanceDisplayCredits: response.balanceDisplayCredits,
        videoMenu: response.videoMenu,
      });
      setQuoteStale(false);
      setError(null);
    } catch {
      if (sequence !== quoteSequence.current) return;
      setError("We couldn't refresh the price. Try again before confirming.");
      setQuoteStale(true);
    } finally {
      // 只有最新那一次才解禁 —— 一个先返回的旧请求不得让按钮在新价到达之前变亮。
      if (sequence === quoteSequence.current) setQuoting(false);
    }
  }

  function chooseProject(nextProjectId: string) {
    setProjectId(nextProjectId);
    // 「已经生成过」是**这个项目里**的事实：换项目就是换一套历史，价必须重新问一遍。
    void requote(nextProjectId, videoMenu?.selected ?? null);
  }

  function chooseVideoSpec(next: Partial<CampaignVideoSpec>) {
    if (!videoMenu) return;
    void requote(projectId, { ...videoMenu.selected, ...next });
  }

  // The server derives the stable batch id, stable per-entry identities, and a fresh attempt id.
  // The browser returns only the server-rendered total + opaque content fingerprint; it never
  // supplies generation content, model, price, or an idempotency key.
  async function confirm() {
    if (!projectId) {
      setError("Choose a destination project first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await confirmCampaignGeneration({
        campaignId,
        projectId,
        expectedTotalCredits: totalDisplayCredits,
        expectedContentFingerprint: contentFingerprint,
        // #708 修复轮 P1-1：他复核过的**交付面**也一起签。少收放行，少交付要重新问。
        expectedDeliveryFingerprint: deliveryFingerprint,
        videoSpec: videoMenu?.selected ?? null,
      });
      if (!("ok" in response)) {
        if (response.quote) setQuoteSnapshot((prev) => ({ ...prev, quote: response.quote ?? prev.quote }));
        if (response.partial) {
          setResult(response.partial.partial);
          setInterruption(response.partial);
        }
        setError(response.error);
        return;
      }
      setQuoteSnapshot((prev) => ({ ...prev, quote: response.quote }));
      setResult(response.result);
      setInterruption(null);
    } catch {
      // A transport failure cannot prove zero dispatch. The stable server-derived keys make a
      // retry safe, but the UI must say the outcome is unknown rather than inventing $0.
      setError("We couldn't confirm the result. Some items may have started; retry to reconcile them safely.");
    } finally {
      setBusy(false);
      // In a finally on purpose: every exit here can have moved money. A partial batch
      // dispatched some cells before stopping, and a transport failure cannot prove zero
      // dispatch (see the catch above) — so the balance must be re-read either way (#550).
      notifyBalanceRefresh();
    }
  }

  // ── empty / degraded states ────────────────────────────────────────────────
  if (approvedLines.length === 0) {
    return (
      <Shell>
        <ConfirmHeader campaign={campaign} />
        <EmptyState
          icon={<Sparkles className="mx-auto size-6 text-muted-foreground" />}
          title="No approved entries to generate yet"
          body="Approve the plan entries you want to create on the campaign detail page, then come back here to generate them."
          campaignId={campaignId}
        />
      </Shell>
    );
  }

  if (projects.length === 0) {
    return (
      <Shell>
        <ConfirmHeader campaign={campaign} />
        <EmptyState
          icon={<FolderKanban className="mx-auto size-6 text-muted-foreground" />}
          title="Group a project into this campaign first"
          body="Generations need a home. On the campaign detail page, group a project into this campaign — then its generations land inside it."
          campaignId={campaignId}
        />
      </Shell>
    );
  }

  // ── results view (honest server-confirmed outcomes) ───────────────────────
  if (result) {
    const reservedThisRun = displayCredits(result.totalCredits);
    const currentUnknown = interruption?.current === "unknown";
    const zeroDispatchConfirmed = result.dispatched === 0 && !currentUnknown;
    // #749 判官 r2 P2:完成判定读**派发结果**,不读派发前的报价 —— 报价说「新做」而结果说
    // 「复用」时,那一单多半还在跑,状态不明一律按「还在做」说。
    // #749 判官 r4:这一批是不是在半路上被另一次确认接管了。是的话,已完成几件、未开始
    // 几件、有没有扣费,必须写在脸上,并且给一个「回去重看」的入口 —— 不许沉默。
    const handover = campaignLeaseHandoverSummary(result.cells);
    const reusedLines = reusedResultLines(result.cells, approvedLines);
    const reusedAllDone = reusedLines.every((line) => line.reuseState === "done");
    const resultTitle = campaignGenerationResultTitle(result, interruption, reusedAllDone);

    return (
      <Shell>
        <ConfirmHeader campaign={campaign} />
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>{resultTitle}</CardTitle>
            <CardDescription>
              {result.dispatched} dispatched · {result.reused} reused · {result.failed} could not start
              {interruption ? ` · ${interruption.notStarted} not started` : ""}.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {handover ? (
              <div className="rounded-xl border border-warning/25 bg-warning-soft px-4 py-3 text-sm text-warning-soft-foreground">
                <strong>
                  Another confirmation took over this campaign, so this run stopped partway.
                </strong>{" "}
                {handover.started} {handover.started === 1 ? "item" : "items"}{" "}
                {handover.started === 1 ? "was" : "were"} already started and charged.{" "}
                {handover.notStarted} {handover.notStarted === 1 ? "item" : "items"}{" "}
                {handover.notStarted === 1 ? "was" : "were"} not started and{" "}
                {handover.notStarted === 1 ? "was" : "were"} not charged. Review the updated plan
                and confirm the rest again.
              </div>
            ) : null}
            {zeroDispatchConfirmed ? (
              <div className="rounded-xl border border-info/25 bg-info-soft px-4 py-3 text-sm text-info-soft-foreground">
                {/* #708 同源症状 ①：什么都没派发，可能是「一件也没做成」，也可能是
                    「早就做完了」。两句话必须分开说，否则一份完成的工作会被读成失败。 */}
                {result.failed === 0 && result.reused > 0 ? (
                  <>
                    <strong>Nothing new was charged.</strong> Every item here is {reusedSummaryPhrase(reusedLines)},
                    so this run reserved nothing.
                  </>
                ) : (
                  <>
                    <strong>Nothing was charged.</strong> The server confirmed that no new generation job was dispatched.
                  </>
                )}
              </div>
            ) : interruption ? (
              <div className="rounded-xl border border-warning/25 bg-warning-soft px-4 py-3 text-sm text-warning-soft-foreground">
                Confirmed reserved before the interruption: <strong>{creditsLabel(reservedThisRun)}</strong>.
                {currentUnknown
                  ? " One item's start status could not be confirmed and may also have reserved credits. A retry will reuse it if it exists."
                  : " The remaining items did not start."}
              </div>
            ) : (
              <div className="rounded-xl border border-info/25 bg-info-soft px-4 py-3 text-sm text-info-soft-foreground">
                Reserved this run: <strong>{creditsLabel(reservedThisRun)}</strong>. Reused and failed items charged nothing.
                Any item that fails is refunded automatically.
              </div>
            )}
            {result.cells.map((cell) => {
              const line = approvedLines[cell.index];
              const entry = line ? entriesById[line.entryId] : undefined;
              return (
                <div key={cell.index} className="flex items-start justify-between gap-3 rounded-xl border border-border p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{entry?.hook || `Entry ${cell.index + 1}`}</p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{line?.brief}</p>
                    {cell.error ? <p className="mt-1 text-xs text-destructive">{friendlyCellError(cell.error)}</p> : null}
                  </div>
                  <CellStatus
                    status={cell.status}
                    credits={displayCredits(cell.credits)}
                    reuseState={line?.reuseState ?? null}
                  />
                </div>
              );
            })}
            <div className="flex flex-wrap gap-3">
              {handover ? (
                <Button
                  type="button"
                  onClick={() => {
                    // 回到复核卡,并向服务端**重新要一次价** —— 别人刚动过这个战役,
                    // 旧的那份报价已经不是真话了。
                    setResult(null);
                    setInterruption(null);
                    setError(null);
                    void requote(projectId, videoMenu?.selected ?? null);
                  }}
                  disabled={busy || quoting}
                >
                  {quoting ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
                  Review the updated plan
                </Button>
              ) : null}
              {!handover && (result.failed > 0 || interruption) ? (
                <Button type="button" onClick={() => confirm()} disabled={busy}>
                  {busy ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
                  {interruption ? "Retry remaining items" : "Retry failed items"}
                </Button>
              ) : null}
              <Button asChild variant="secondary">
                <Link href={`/campaign/${campaignId}`}><ArrowLeft />Back to campaign</Link>
              </Button>
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </CardContent>
        </Card>
      </Shell>
    );
  }

  // ── review + confirm ───────────────────────────────────────────────────────
  return (
    <Shell>
      <ConfirmHeader campaign={campaign} />

      <div className="mt-6 rounded-xl border border-info/25 bg-info-soft px-4 py-3 text-sm leading-6 text-info-soft-foreground">
        <ShieldCheck className="mb-1 inline size-4" /> The server checks the approved content, models, and prices again
        when you confirm. If anything changed, nothing starts until you review the updated plan. You only pay when a
        generation finishes, never on errors, and each item generates at most once.
      </div>
      {error ? <div className="mt-4 rounded-xl border border-error-soft bg-error-soft p-4 text-sm text-destructive">{error}</div> : null}

      <div className="mt-6 grid gap-5 xl:grid-cols-[1.4fr_0.6fr]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Approved entries to generate</CardTitle>
            <CardDescription>{approvedLines.length} item{approvedLines.length === 1 ? "" : "s"}, each priced from the live model config.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {approvedLines.map((line) => {
              const entry = entriesById[line.entryId];
              return (
                <div key={line.entryId} className="rounded-xl border border-border bg-muted/25 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <Badge variant="outline">{line.kind === "video" ? <VideoIcon className="size-3" /> : <ImageIcon className="size-3" />}{line.kind}</Badge>
                      {/* #643 T2: the format the merchant planned and the shape it will actually
                          be delivered in, side by side — one server-derived value, shown before
                          anything is charged. Video lines carry the full spec in their chips
                          below (#709), so the shape is not printed twice. */}
                      <span className="text-xs text-muted-foreground">
                        {entry?.platform} · {entry?.format}
                        {line.kind === "image" && line.aspectRatio ? ` · ${line.aspectRatio}` : ""}
                      </span>
                    </span>
                    <LinePrice line={line} />
                  </div>
                  <p className="mt-3 text-sm font-semibold">{entry?.hook || "Untitled entry"}</p>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{line.brief}</p>
                  {/* #709: what this item will actually be — length, resolution, shape, sound.
                      Server-derived from the very same resolved spec that is priced, frozen into
                      the job, and sent to the engine. */}
                  {line.specChips.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {line.specChips.map((chip) => (
                        <span
                          key={chip}
                          className="rounded-[7px] border border-border bg-card px-[7px] py-[2px] font-mono text-[11px] text-muted-foreground"
                        >
                          {chip}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <p className="mt-2 text-xs text-muted-foreground">
                    Capability: {line.kind === "video" ? "Video" : "Image"}
                  </p>
                  {line.charge === "blocked" ? (
                    <p className="mt-2 text-xs text-destructive">
                      This entry changed since it was last generated, so it will not start. Undo the edit, or generate
                      it into a different project.
                    </p>
                  ) : null}
                </div>
              );
            })}
          </CardContent>
        </Card>

        <aside className="grid content-start gap-5">
          <Card>
            <CardHeader>
              <CardTitle>Confirm generation</CardTitle>
              <CardDescription>Charged to your credit balance. Finished generations land in the chosen project.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <label className="grid gap-2 text-xs font-semibold text-muted-foreground">
                Destination project
                <Select value={projectId} disabled={busy || quoting} onValueChange={chooseProject}>
                  <SelectTrigger><SelectValue placeholder="Choose a project" /></SelectTrigger>
                  <SelectContent>
                    <SelectGroup>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectGroup>
                  </SelectContent>
                </Select>
              </label>
              {/* #709: the video tier is a choice again, not a hidden default. Both menus come
                  from the live model config, and picking one re-asks the server for the price. */}
              {hasVideoLines && videoMenu && videoMenu.resolutions.length > 0 ? (
                <label className="grid gap-2 text-xs font-semibold text-muted-foreground">
                  Video resolution
                  <Select
                    value={videoMenu.selected.resolution}
                    disabled={busy || quoting}
                    onValueChange={(resolution) => chooseVideoSpec({ resolution })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectGroup>{videoMenu.resolutions.map((resolution) => (
                        <SelectItem key={resolution} value={resolution}>{resolution}</SelectItem>
                      ))}</SelectGroup>
                    </SelectContent>
                  </Select>
                </label>
              ) : null}
              {hasVideoLines && videoMenu && videoMenu.durations.length > 0 ? (
                <label className="grid gap-2 text-xs font-semibold text-muted-foreground">
                  Video length
                  <Select
                    value={String(videoMenu.selected.durationSeconds)}
                    disabled={busy || quoting}
                    onValueChange={(seconds) => chooseVideoSpec({ durationSeconds: Number(seconds) })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectGroup>{videoMenu.durations.map((seconds) => (
                        <SelectItem key={seconds} value={String(seconds)}>{seconds}s</SelectItem>
                      ))}</SelectGroup>
                    </SelectContent>
                  </Select>
                </label>
              ) : null}
              <div className="flex items-baseline justify-between border-t border-border pt-3">
                <span className="text-sm text-muted-foreground">Total</span>
                <span className="text-2xl font-semibold tracking-tight">
                  {creditsLabel(totalDisplayCredits)}
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-muted-foreground">Current balance</span>
                <span className="text-sm font-semibold">
                  {creditsLabel(balanceDisplayCredits)}
                </span>
              </div>
              {/* #708: say where the difference went. A total that is smaller than the sum of the
                  lines is only honest if the merchant can see why. */}
              {nothingLeftToGenerate ? (
                <div className="rounded-xl border border-info/25 bg-info-soft px-4 py-3 text-sm text-info-soft-foreground">
                  Everything in this plan is {reusedSummaryPhrase(approvedLines)}. Confirming again will not charge you.
                </div>
              ) : reusedCount > 0 ? (
                <p className="text-xs text-muted-foreground">
                  {reusedCount} {reusedCount === 1 ? "item is" : "items are"} {reusedSummaryPhrase(approvedLines)}, so
                  this run only charges for the rest.
                </p>
              ) : null}
              {blockedCount > 0 ? (
                <p className="text-xs text-muted-foreground">
                  {blockedCount} {blockedCount === 1 ? "item" : "items"} changed since it was generated and will not
                  start, so nothing is charged for {blockedCount === 1 ? "it" : "them"}.
                </p>
              ) : null}
              {insufficientCredits ? (
                <div className="rounded-xl border border-warning/25 bg-warning-soft px-4 py-3 text-sm text-warning-soft-foreground">
                  <p>
                    <strong>Not enough credits</strong> — you have {creditsLabel(balanceDisplayCredits)}, this needs {creditsLabel(totalDisplayCredits)}.
                  </p>
                  <Link href="/billing" className="mt-2 inline-flex font-semibold underline underline-offset-4">
                    Top up credits
                  </Link>
                </div>
              ) : null}
              <Button
                type="button"
                className="w-full"
                disabled={busy || quoting || quoteStale || !projectId || insufficientCredits}
                onClick={() => confirm()}
              >
                {busy || quoting ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
                {totalDisplayCredits === 0
                  ? "Confirm · no charge"
                  : `Confirm · ${creditsLabel(totalDisplayCredits)}`}
              </Button>
              <Button asChild variant="ghost" className="w-full">
                <Link href={`/campaign/${campaignId}`}><ArrowLeft />Back without generating</Link>
              </Button>
            </CardContent>
          </Card>
        </aside>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-dvh bg-background px-4 py-7 text-foreground sm:px-6 lg:px-8 lg:py-9">
      <div className="mx-auto max-w-7xl">
        <CampaignNav current="detail" />
        {children}
      </div>
    </main>
  );
}

function ConfirmHeader({ campaign }: { campaign: Extract<DetailResult, { ok: true }>["campaign"] }) {
  return (
    <header className="mt-7 border-b border-border pb-6">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-strong">Confirm generation</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">{campaign.name}</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
        Turn this campaign&apos;s approved plan entries into real generations.
      </p>
    </header>
  );
}

function EmptyState({ icon, title, body, campaignId }: { icon: React.ReactNode; title: string; body: string; campaignId: string }) {
  return (
    <Card className="mt-6">
      <CardContent className="px-5 py-10 text-center">
        {icon}
        <h2 className="mt-3 text-sm font-semibold">{title}</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{body}</p>
        <Button asChild variant="secondary" className="mt-5">
          <Link href={`/campaign/${campaignId}`}><ArrowLeft />Back to campaign detail</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * 复用条目的对客说法(#708 修复轮 P2-1)。**复用不等于做完** —— 判据把 QUEUED / GENERATING /
 * DONE 都算复用(都不再收钱),但只有 DONE 才是做好了。文案照服务端给的真实状态分档,
 * 与收费判据同源;状态不明时只说「已经在做了」,不宣称完成。
 */
export function reusedLabel(reuseState: CampaignGenQuoteLine["reuseState"]): string {
  return reuseState === "done" ? "Already generated" : "Already being made";
}

/** 汇总说法,同一条判据:只要还有一单在跑,就不许把整批说成「已生成」。 */
export function reusedSummaryPhrase(lines: Pick<CampaignGenQuoteLine, "charge" | "reuseState">[]): string {
  const reused = lines.filter((line) => line.charge === "reused");
  return reused.some((line) => line.reuseState !== "done")
    ? "already generated or still being made"
    : "already generated";
}

/**
 * 这一批是不是**在半路上丢了租约**(#749 判官 r4)。
 *
 * 丢租约意味着另一次确认接管了这个战役:已经派发出去的格是真开始、真扣了钱的,后面的格
 * 一格没开始、一分钱没收。这两句必须一起说出口 —— 只报一个「部分开始」的标题,商家既不
 * 知道自己付了多少,也不知道还差几件,那就是沉默。
 *
 * 返回 null = 这一批不是因为丢租约停的(别的失败原因有它们自己的逐格说明)。
 *
 * M 数的是**所有零扣费没开始的格**,不只是接管那一种(#749 判官 r5 P2)。接管只是没开始的
 * 原因之一:同一批里积分不足、被挡下的格同样一件没开始、一分钱没收(`error` 格按定义就是
 * 零扣费)。只数接管那一种,商家读到的「还差几件」就比实际少 —— 而他正要照这个数决定重新
 * 确认什么。触发这套说法的仍然是「有格丢了租约」,数的却必须是整批。
 */
export function campaignLeaseHandoverSummary(
  cells: Pick<BatchResult["cells"][number], "status" | "error">[],
): { started: number; notStarted: number } | null {
  if (!cells.some((cell) => cell.error === CAMPAIGN_DISPATCH_IN_FLIGHT)) return null;
  return {
    started: cells.filter((cell) => cell.status === "queued" || cell.status === "reused").length,
    notStarted: cells.filter((cell) => cell.status === "error").length,
  };
}

/**
 * 结果页说「做完没有」时读的那一份(#749 判官 r2 P2)。
 *
 * 判据必须是**派发结果**这一格,不是派发前的报价:同规格并发确认下,报价说「这一格新做」
 * 而结果说「复用」是真会发生的 —— 赢的那一单是别人刚起的,多半还在跑。旧写法用报价行过滤
 * (`charge === "reused"`),这一格根本不进过滤器,`every(...)` 于是空手通过,标题写成
 * 「已经全部生成好了」,而那一单还在 QUEUED。
 *
 * 所以这里从**结果**出发:每一个「复用」的结果格去报价里认领它的状态;认领不到(报价当时
 * 说的是新做)就是**状态不明** —— 一律按「还在做」说,绝不宣称完成。
 */
export function reusedResultLines(
  cells: Pick<BatchResult["cells"][number], "index" | "status">[],
  lines: Pick<CampaignGenQuoteLine, "charge" | "reuseState">[],
): Pick<CampaignGenQuoteLine, "charge" | "reuseState">[] {
  return cells
    .filter((cell) => cell.status === "reused")
    .map((cell) => {
      const line = lines[cell.index];
      return {
        charge: "reused" as const,
        reuseState: line?.charge === "reused" ? line.reuseState : null,
      };
    });
}

/**
 * 一行条目的价钱(#708)。写的必须是**这一趟真会收的钱**:已经生成过或还在做的条目收 0,
 * 内容改过、这一趟不会被受理的条目也收 0。全价照旧说出来 —— 商家有权知道差额从哪来,
 * 而不是看见一个没解释的 0。
 */
function LinePrice({
  line,
}: {
  line: Pick<CampaignGenQuoteLine, "charge" | "displayCredits" | "fullDisplayCredits" | "reuseState">;
}) {
  if (line.charge === "new") {
    return (
      <span className="text-sm font-semibold">
        {creditsLabel(line.displayCredits)}
      </span>
    );
  }
  return (
    <span className="flex shrink-0 flex-col items-end">
      <span className="text-sm font-semibold">0 credits</span>
      <span className="text-xs text-muted-foreground">
        {line.charge === "reused" ? reusedLabel(line.reuseState) : "Will not start"} · normally{" "}
        {creditsLabel(line.fullDisplayCredits)}
      </span>
    </span>
  );
}

/** Map the shared spend-gate errors to copy that is accurate for THIS flow. */
function friendlyCellError(raw: string): string {
  if (/different content/i.test(raw)) {
    return "This entry's plan changed since it was last generated. Undo the edit, or generate it into a different project.";
  }
  return raw;
}

function CellStatus({
  status,
  credits,
  reuseState,
}: {
  status: "queued" | "reused" | "text" | "error";
  credits: number;
  reuseState: CampaignGenQuoteLine["reuseState"];
}) {
  if (status === "queued") {
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-info-soft-foreground">
        <LoaderCircle className="size-4 animate-spin" /> Generating · {credits} cr
      </span>
    );
  }
  if (status === "reused") {
    // #708 修复轮 P2-1：一单还在跑的片子不许被写成「已完成」。状态来自服务端的复用判据。
    if (reuseState !== "done") {
      return (
        <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-info-soft-foreground">
          <LoaderCircle className="size-4 animate-spin" /> {reusedLabel(reuseState)} · 0 cr
        </span>
      );
    }
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-success-soft-foreground">
        <CheckCircle2 className="size-4" /> {reusedLabel(reuseState)} · 0 cr
      </span>
    );
  }
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-destructive">
      <XCircle className="size-4" /> Not started · 0 cr
    </span>
  );
}
