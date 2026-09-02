import Link from "next/link";
import { ArrowRight, CalendarDays, CircleAlert, Megaphone, Plus, Target } from "lucide-react";
import type { listCampaigns } from "@/lib/campaign-view-data";
import { CAMPAIGN_STATUS_BADGE, isCampaignStatus } from "@fikirtive/core/campaign-lifecycle";
import { MY_DATE_FORMAT } from "@/lib/my-date-format";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { CampaignNav } from "./campaign-nav";

type ListResult = Awaited<ReturnType<typeof listCampaigns>>;

function dateLabel(value: string) {
  return MY_DATE_FORMAT.format(new Date(value));
}

function statusVariant(status: string): "outline" | "success" | "warning" | "destructive" {
  return isCampaignStatus(status) ? CAMPAIGN_STATUS_BADGE[status] : "warning";
}

export default function CampaignListPage({ initialState }: { initialState: ListResult }) {
  return (
    <main className="min-h-dvh bg-background px-4 py-7 text-foreground sm:px-6 lg:px-8 lg:py-9">
      <div className="mx-auto max-w-7xl">
        <CampaignNav current="list" />
        <header className="mt-7 flex flex-col gap-5 border-b border-border pb-7 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Planning workspace</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-[-0.035em]">Campaigns</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Keep goals, dates, plan entries, and existing work together without generating or publishing anything.
            </p>
          </div>
          <Button asChild>
            <Link href="/campaign/workbench">
              <Plus data-icon />
              New campaign
            </Link>
          </Button>
        </header>

        {"error" in initialState ? (
          <Alert variant="destructive" className="mt-6">
            <CircleAlert />
            <AlertTitle>Campaigns could not load</AlertTitle>
            <AlertDescription>{initialState.error}</AlertDescription>
          </Alert>
        ) : initialState.campaigns.length === 0 ? (
          <Empty className="mt-6 min-h-80 border border-dashed border-border bg-card shadow-[var(--shadow-sm)]">
            <EmptyHeader>
              <EmptyMedia variant="icon"><Megaphone /></EmptyMedia>
              <EmptyTitle>No campaigns yet</EmptyTitle>
              <EmptyDescription>
                Start with a goal and period. You can add draft plan entries and group existing work afterwards.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button asChild>
                <Link href="/campaign/workbench">Create your first campaign</Link>
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <Card className="mt-6 gap-0 overflow-hidden p-0">
            <CardHeader className="flex-row items-center justify-between gap-4 px-5 py-4">
              <div>
                <CardTitle className="text-base">All campaigns</CardTitle>
                <CardDescription>Open a campaign to manage its plan and grouped work.</CardDescription>
              </div>
              <Badge variant="outline">{initialState.campaigns.length}</Badge>
            </CardHeader>
            <Separator />
            <CardContent className="p-0">
              {initialState.campaigns.map((campaign, index) => {
                const entryCount = campaign.plan?.entries.length ?? 0;
                return (
                  <div key={campaign.id}>
                    <Link
                      href={`/campaign/${campaign.id}`}
                      className="group grid min-w-0 gap-4 px-5 py-4 transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 lg:grid-cols-[minmax(0,1.4fr)_minmax(240px,0.8fr)_auto_auto] lg:items-center"
                    >
                      <div className="min-w-0">
                        <h2 className="truncate text-sm font-semibold tracking-[-0.01em] text-foreground">{campaign.name}</h2>
                        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{campaign.goal}</p>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <CalendarDays className="size-4 shrink-0" />
                        <span>{dateLabel(campaign.startAt)} – {dateLabel(campaign.endAt)}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Target className="size-4 shrink-0" />
                        <span>{entryCount} plan {entryCount === 1 ? "entry" : "entries"}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3 lg:justify-end">
                        <Badge variant={statusVariant(campaign.status)}>{campaign.status.toLowerCase()}</Badge>
                        <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                      </div>
                    </Link>
                    {index < initialState.campaigns.length - 1 ? <Separator /> : null}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
