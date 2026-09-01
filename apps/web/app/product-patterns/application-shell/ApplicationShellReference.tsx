"use client";

import Link from "next/link";
import { ArrowRight, CalendarClock, CheckCircle2, FileClock, Sparkles } from "lucide-react";

import { SHELL_ROUTES } from "@fikirtive/core/navigation";
import { MerchantShellFrame } from "@/components/global-navigation";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { OttoPanelShell } from "@/components/otto/panel/OttoPanelShell";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { toast } from "@/components/ui/toast";

const PREVIEW_ACCOUNT = {
  email: "founder@fikirtive.com",
  displayName: "Aisyah",
  balance: 1240,
} as const;

const SUMMARY = [
  {
    label: "Waiting for approval",
    value: "0",
    detail: "Nothing needs your review",
    icon: CheckCircle2,
  },
  {
    label: "Publishing next",
    value: "0",
    detail: "Nothing is scheduled",
    icon: CalendarClock,
  },
  {
    label: "Available credits",
    value: "1,240",
    detail: "Ready when you are",
    icon: Sparkles,
  },
] as const;

function ShellDashboardFixture() {
  return (
    <main className="mx-auto w-full max-w-[1120px] px-8 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Badge>Application shell checkpoint</Badge>
          <h1 className="mt-4 text-2xl font-semibold tracking-[-0.02em]">Good afternoon, Aisyah</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            This fixture is only here to review the shared rail, utility bar, content frame, and Otto panel.
          </p>
        </div>
        <Link href={SHELL_ROUTES.create} className={buttonVariants()}>
          Create something
          <ArrowRight />
        </Link>
      </div>

      <section aria-labelledby="overview-heading" className="mt-8">
        <h2 id="overview-heading" className="text-sm font-semibold">Overview</h2>
        <div className="mt-3 grid gap-4 md:grid-cols-3">
          {SUMMARY.map((item) => {
            const Icon = item.icon;
            return (
              <Card key={item.label}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-3">
                    <CardDescription>{item.label}</CardDescription>
                    <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                  </div>
                  <CardTitle className="text-2xl tabular-nums">{item.value}</CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">{item.detail}</CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="recent-heading" className="mt-8">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 id="recent-heading" className="text-sm font-semibold">Recent work</h2>
            <p className="mt-1 text-xs text-muted-foreground">Your latest Fikirtive activity will appear here.</p>
          </div>
          <Link href={SHELL_ROUTES.library} className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Open library
          </Link>
        </div>
        <Card className="mt-3">
          <CardContent className="p-0">
            <Empty className="min-h-64 border-0">
              <EmptyHeader>
                <EmptyMedia variant="icon"><FileClock /></EmptyMedia>
                <EmptyTitle>No recent work</EmptyTitle>
                <EmptyDescription>Start with a brief, or ask Otto to help plan the outcome.</EmptyDescription>
              </EmptyHeader>
              <Link href={SHELL_ROUTES.create} className={buttonVariants({ variant: "secondary", size: "sm" })}>
                Start creating
              </Link>
            </Empty>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

function OttoShellFixture() {
  return (
    <Empty className="min-h-full justify-start px-5 py-12 text-left">
      <EmptyHeader className="items-start text-left">
        <EmptyMedia><OttoAvatar size={38} mood="idle" /></EmptyMedia>
        <EmptyTitle className="text-xl">What should we work on?</EmptyTitle>
        <EmptyDescription className="max-w-sm leading-6">
          This checkpoint reviews Otto&apos;s place in the shell. Conversation history, composer, and task flows are the next review.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function ApplicationShellReference() {
  return (
    <div className="gb min-h-dvh bg-background text-foreground">
      <OttoPanelShell
        forceOpenSignal="application-shell-reference"
        contextChip={{ label: "Home" }}
        contextAttached
        panelBody={<OttoShellFixture />}
      >
        <MerchantShellFrame
          pathname={SHELL_ROUTES.home}
          account={PREVIEW_ACCOUNT}
          signOutAction={async () => {
            toast.info("Preview only. No session was changed.");
          }}
        >
          <ShellDashboardFixture />
        </MerchantShellFrame>
      </OttoPanelShell>
    </div>
  );
}
