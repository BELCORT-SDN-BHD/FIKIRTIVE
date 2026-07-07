"use client";

/**
 * 账户设置 —— 品牌资料 + 通知 + 语言/时区偏好。
 * 交叉链接:额度卡 → credits;连接 → connections;团队 → team/members。
 * §F7 开关即时生效(无 Save);§N6 页头 + §D4 hairline 行。
 */

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Plug, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { PageHeader, StatCard } from "@/components/northstar/_shared";
import { NS_BRAND } from "@/components/northstar/_mock";
import {
  ACCOUNT_OPS_BASE as BASE,
  AccountNav,
  Card,
  CardHeader,
  SettingRow,
} from "./kit";
import { creditSummary } from "./data";

export function AccountSettings() {
  const [notify, setNotify] = React.useState({ approvals: true, publishFails: true, weekly: false });
  const credits = creditSummary();

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Account"
        subtitle="Your brand, your team, and how Otto reaches you."
        actions={<AccountNav />}
      />

      {/* 概览三卡:额度 → credits;连接 → connections;团队 → members */}
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Link href={`${BASE}/account/credits`} className="rounded-[14px] focus-visible:outline-2 focus-visible:outline-ring">
          <StatCard
            label="Credit balance"
            value={credits.balance.toLocaleString("en-MY")}
            delta={{ dir: "flat", text: "Manage credits" }}
          />
        </Link>
        <Link href={`${BASE}/account/connections`} className="group rounded-[14px] border border-border bg-card p-4 transition-colors duration-[120ms] hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Plug className="size-4" strokeWidth={2} />
            Connections
          </div>
          <div className="mt-1 text-[26px] leading-8 font-bold tracking-[-0.02em] text-foreground tabular-nums">3 / 5</div>
          <div className="mt-1 text-xs font-semibold text-warning-soft-foreground">1 needs attention</div>
        </Link>
        <Link href={`${BASE}/team/members`} className="group rounded-[14px] border border-border bg-card p-4 transition-colors duration-[120ms] hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Users className="size-4" strokeWidth={2} />
            Team
          </div>
          <div className="mt-1 text-[26px] leading-8 font-bold tracking-[-0.02em] text-foreground tabular-nums">3</div>
          <div className="mt-1 text-xs font-semibold text-muted-foreground">Manage members</div>
        </Link>
      </div>

      {/* 品牌资料 */}
      <div className="mt-8 flex flex-col gap-6">
        <Card>
          <CardHeader title="Brand profile" desc="How you show up across every channel." />
          <SettingRow title="Business name" desc={NS_BRAND.name} control={<Button variant="secondary" size="sm">Edit</Button>} />
          <SettingRow title="Owner" desc={`${NS_BRAND.owner} · ${NS_BRAND.email}`} control={<Button variant="secondary" size="sm">Edit</Button>} />
          <SettingRow title="City" desc={NS_BRAND.city} control={<Button variant="secondary" size="sm">Edit</Button>} />
          <SettingRow
            title="Brand voice"
            desc={NS_BRAND.voice}
            control={
              <Button variant="ghost" size="sm" asChild>
                <Link href={`${BASE}/assets/brand-memory`}>
                  Brand memory
                  <ArrowRight strokeWidth={2} />
                </Link>
              </Button>
            }
          />
        </Card>

        {/* 通知(§F7 即时开关) */}
        <Card>
          <CardHeader title="Notifications" desc="Otto only pings you for things that need a person." />
          <SettingRow
            title="Approvals waiting"
            desc="When Otto has drafts or spend for you to approve"
            control={
              <Switch
                checked={notify.approvals}
                onCheckedChange={(v) => setNotify((n) => ({ ...n, approvals: v }))}
                aria-label="Notify me about approvals"
              />
            }
          />
          <SettingRow
            title="Publish failures"
            desc="If a scheduled post can't go out"
            control={
              <Switch
                checked={notify.publishFails}
                onCheckedChange={(v) => setNotify((n) => ({ ...n, publishFails: v }))}
                aria-label="Notify me about publish failures"
              />
            }
          />
          <SettingRow
            title="Weekly recap"
            desc="A Monday summary of last week's numbers"
            control={
              <Switch
                checked={notify.weekly}
                onCheckedChange={(v) => setNotify((n) => ({ ...n, weekly: v }))}
                aria-label="Send me a weekly recap"
              />
            }
          />
        </Card>

        {/* 偏好 */}
        <Card>
          <CardHeader title="Preferences" />
          <SettingRow title="Languages" desc={NS_BRAND.languages.join(" · ")} control={<Button variant="secondary" size="sm">Change</Button>} />
          <SettingRow title="Time zone" desc="Asia/Kuala_Lumpur · UTC+8" control={<Button variant="secondary" size="sm">Change</Button>} />
          <SettingRow title="Currency" desc={`${NS_BRAND.currency} · Malaysian ringgit`} control={<Button variant="secondary" size="sm">Change</Button>} />
        </Card>
      </div>
    </div>
  );
}
