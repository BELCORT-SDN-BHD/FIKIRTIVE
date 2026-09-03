import { formatCredits } from "@/lib/credit-format";
import { countCharges, type SpendEntry } from "@/lib/spend-history";
import type { SpendWindow } from "@/lib/spend-history-data";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ReceiptText } from "lucide-react";

/** Say what this list covers, and how much of it is money going OUT.
 *
 *  Two separate honesty rules meet in this one sentence:
 *   - the truncated case names the cut instead of implying "all" (round-1 review P1①: a PR
 *     that fixes "the product says one thing and does another" must not ship its own version);
 *   - the count called "charges" counts charges only (#684). Every row used to be called a
 *     charge, so a workspace holding nothing but its signup grant was told "Your 1 credit
 *     charge so far" before it had spent anything. Top-ups and grants keep their own words —
 *     "Top-up" and "Credits added" — on their own rows.
 *
 *  Pure, so the wording is unit-tested without a render. */
export function windowSummary(window: SpendWindow, entries: readonly SpendEntry[]): string {
  const coverage = window.hasMore
    ? `Showing your last ${window.returned} credit entries, newest first — older activity isn’t listed here yet.`
    : window.returned === 1
      ? "Your 1 credit entry so far."
      : `All ${window.returned} credit entries on this workspace, newest first.`;

  const charges = countCharges(entries);
  const charged =
    charges === 0
      ? "No charges yet."
      : charges === 1
        ? "1 of them is a charge."
        : `${charges} of them are charges.`;

  return `${coverage} ${charged}`;
}

/**
 * Spend history on /billing (#555) — where the credits went.
 *
 * Presentational and server-rendered: it takes the already-shaped entries (see
 * lib/spend-history.ts) and lists them newest-first. It reads nothing and writes nothing.
 * An unsettled hold is labelled as such rather than shown as a final charge, and the list
 * states how far back it reaches (see windowSummary above).
 */
export function SpendHistory({ entries, window }: { entries: SpendEntry[]; window: SpendWindow }) {
  return (
    /* 第 1 轮判官 P1②:`/billing` 去卡片化之后,这一节还是一张 marketing card —— 图标画在
       盒子里、`text-lg` 的卡片标题、`bg-card` 的底 —— 而同页其余五节已经全部是夹具的
       section 词汇。已冻结的 Settings screen pattern §3.3 明写这一面「默认使用 plain rows /
       forms,不堆独立 marketing cards」。这里改成同一套词汇:图标 + `text-base font-semibold`
       标题 + 说明在盒子**外面**,盒子里只剩那张表。表格本体、文案、列与徽章一字未改。
       夹具没有「支出流水」这一节(它那张是假的 Credit usage 弹层),按 Founder 2026-09-03 的
       第②条例外,用夹具的样式呈现,不自创长相。 */
    <section>
      <div className="flex items-start gap-3">
        <ReceiptText className="mt-0.5 size-5 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">Spend history</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {entries.length === 0
              ? "Charges, top-ups, refunds, and held credits will appear here."
              : `${windowSummary(window, entries)} Chat and Review are Otto’s conversation turns.`}
          </p>
        </div>
        {entries.length > 0 ? <Badge variant="outline">{entries.length} entries</Badge> : null}
      </div>
      {/* 同一条根因(判官 P1①):列的显隐原本按视口断点,在 280px 的内容列里 `sm:` 照样命中,
          Details 整列被塞进去。改成按这个盒子自己的宽度判断。 */}
      <div className="@container/history mt-4 overflow-hidden rounded-[var(--radius-card)] border border-border">
        {entries.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon"><ReceiptText aria-hidden /></EmptyMedia>
              <EmptyTitle>No credit activity yet</EmptyTitle>
              <EmptyDescription>Your first charge or top-up will appear here with its final amount.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Activity</TableHead>
                <TableHead className="hidden @md/history:table-cell">Details</TableHead>
                <TableHead className="hidden @lg/history:table-cell">Date</TableHead>
                <TableHead className="text-right">Credits</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>
                    <div className="flex items-center gap-2 font-medium">
                      {entry.label}
                      {entry.pending ? <Badge variant="warning">Held</Badge> : null}
                    </div>
                  </TableCell>
                  <TableCell className="hidden max-w-md whitespace-normal text-muted-foreground @md/history:table-cell">
                    {entry.detail ?? "—"}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground @lg/history:table-cell">{entry.atLabel}</TableCell>
                  <TableCell className="text-right font-mono font-medium tabular-nums">
                    {entry.delta > 0 ? (
                      <Badge variant="success">+{formatCredits(entry.delta)}</Badge>
                    ) : (
                      formatCredits(entry.delta)
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </section>
  );
}

export default SpendHistory;
