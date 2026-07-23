import Link from "next/link";
import { ArrowRight, CalendarDays, Megaphone, Plus, Target } from "lucide-react";
import type { listCampaigns } from "@/lib/campaign-view-data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CampaignNav } from "./campaign-nav";

type ListResult = Awaited<ReturnType<typeof listCampaigns>>;

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(new Date(value));
}

function statusVariant(status: string): "outline" | "success" | "warning" | "destructive" {
  if (status === "ACTIVE") return "success";
  if (status === "DONE") return "outline";
  if (status === "CANCELLED") return "destructive";
  return "warning";
}

export default function CampaignListPage({ initialState }: { initialState: ListResult }) {
  return (
    <main className="min-h-dvh bg-background px-4 py-7 text-foreground sm:px-6 lg:px-8 lg:py-9">
      <div className="mx-auto max-w-7xl">
        <CampaignNav current="list" />
        <header className="mt-7 flex flex-col gap-5 border-b border-border pb-7 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-strong">Campaign planning</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">Campaigns</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
              Keep goals, dates, plan entries, and existing work together without generating or publishing anything.
            </p>
          </div>
          <Button asChild>
            <Link href="/campaign/workbench">
              <Plus />
              New campaign
            </Link>
          </Button>
        </header>

        {"error" in initialState ? (
          <section className="mt-6 rounded-[var(--radius-card)] border border-error-soft bg-card p-6 shadow-sm">
            <h2 className="text-lg font-semibold">Campaigns could not load</h2>
            <p className="mt-2 text-sm text-muted-foreground">{initialState.error}</p>
          </section>
        ) : initialState.campaigns.length === 0 ? (
          <section className="mt-6 rounded-[var(--radius-card)] border border-dashed border-border bg-card px-6 py-14 text-center shadow-sm">
            <Megaphone className="mx-auto size-8 text-muted-foreground" />
            <h2 className="mt-4 text-lg font-semibold">No campaigns yet</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
              Start with a goal and period. You can add draft plan entries and group existing work afterwards.
            </p>
            <Button asChild className="mt-6">
              <Link href="/campaign/workbench">Create your first campaign</Link>
            </Button>
          </section>
        ) : (
          <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {initialState.campaigns.map((campaign) => (
              <Card key={campaign.id} className="min-w-0 transition-transform hover:-translate-y-0.5">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="truncate">{campaign.name}</CardTitle>
                      <CardDescription className="mt-1 line-clamp-2">{campaign.goal}</CardDescription>
                    </div>
                    <Badge variant={statusVariant(campaign.status)}>{campaign.status.toLowerCase()}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="mt-auto">
                  <div className="grid gap-3 rounded-xl bg-muted/55 p-4 text-sm">
                    <div className="flex items-center gap-2">
                      <CalendarDays className="size-4 text-muted-foreground" />
                      <span>{dateLabel(campaign.startAt)} – {dateLabel(campaign.endAt)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Target className="size-4 text-muted-foreground" />
                      <span>
                        {campaign.plan?.entries.length ?? 0} plan {(campaign.plan?.entries.length ?? 0) === 1 ? "entry" : "entries"}
                      </span>
                    </div>
                  </div>
                  <Button asChild className="mt-4 w-full" variant="secondary">
                    <Link href={`/campaign/${campaign.id}`}>
                      Open campaign
                      <ArrowRight />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}
