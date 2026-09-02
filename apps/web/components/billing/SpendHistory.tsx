import { formatCredits } from "@/lib/credit-format";
import { countCharges, type SpendEntry } from "@/lib/spend-history";
import type { SpendWindow } from "@/lib/spend-history-data";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <ReceiptText className="size-4 text-muted-foreground" aria-hidden />
            <CardTitle>Spend history</CardTitle>
          </div>
          {entries.length > 0 ? <Badge variant="outline">{entries.length} entries</Badge> : null}
        </div>
        <CardDescription>
          {entries.length === 0
            ? "Charges, top-ups, refunds, and held credits will appear here."
            : `${windowSummary(window, entries)} Chat and Review are Otto’s conversation turns.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
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
                <TableHead className="hidden sm:table-cell">Details</TableHead>
                <TableHead className="hidden md:table-cell">Date</TableHead>
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
                  <TableCell className="hidden max-w-md whitespace-normal text-muted-foreground sm:table-cell">
                    {entry.detail ?? "—"}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">{entry.atLabel}</TableCell>
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
      </CardContent>
    </Card>
  );
}

export default SpendHistory;
