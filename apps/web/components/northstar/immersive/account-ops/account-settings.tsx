"use client";

/**
 * 账户设置 —— 品牌资料 + Otto 行为设置 + 通知 + 偏好。
 * Otto 行为(自主级别 / 花费确认阈值 / 勿扰时段)全接共享 store,dock 立刻反映(§F7 无 Save)。
 * 交叉链接:额度卡 → credits;连接 → connections;团队 → team/members;例程授权 → automation/routines。
 */

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Moon, Plug, Repeat, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { PageHeader, StatCard } from "@/components/northstar/_shared";
import { NS_BRAND } from "@/components/northstar/_mock";
import { balance, connections, ottoBehavior, setOttoBehavior, useStore } from "../_store";
import {
  ACCOUNT_OPS_BASE as BASE,
  AccountNav,
  Card,
  CardHeader,
  SettingRow,
} from "./kit";

/** 单选药丸组(自主级别 / 花费阈值共用;人话选项 + 无术语)。 */
function PillGroup<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={
              "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-ring " +
              (active
                ? "border-primary bg-secondary text-foreground ring-[2px] ring-ring/40"
                : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground")
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function AccountSettings() {
  useStore();
  const [notify, setNotify] = React.useState({ approvals: true, publishFails: true, weekly: false });
  const conns = connections();
  const creditBalance = balance();
  const behavior = ottoBehavior();
  const connectedCount = conns.filter((c) => c.status === "connected").length;
  const attentionCount = conns.filter((c) => c.status === "action").length;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Account"
        subtitle="Your brand, your team, and how Otto works for you."
        actions={<AccountNav />}
      />

      {/* 概览三卡:额度 → credits;连接 → connections;团队 → members */}
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Link href={`${BASE}/account/credits`} className="rounded-[14px] focus-visible:outline-2 focus-visible:outline-ring">
          <StatCard
            label="Credit balance"
            value={creditBalance.toLocaleString("en-MY")}
            delta={{ dir: "flat", text: "Manage credits" }}
          />
        </Link>
        <Link href={`${BASE}/account/connections`} className="group rounded-[14px] border border-border bg-card p-4 transition-colors duration-[120ms] hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Plug className="size-4" strokeWidth={2} />
            Connections
          </div>
          <div className="mt-1 text-[26px] leading-8 font-bold tracking-[-0.02em] text-foreground tabular-nums">{connectedCount} / {conns.length}</div>
          <div className="mt-1 text-xs font-semibold text-warning-soft-foreground">{attentionCount} needs attention</div>
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

      <div className="mt-8 flex flex-col gap-6">
        {/* Otto 行为设置(founder 最在意:自主 / 花钱 / 勿扰;全接 store,dock 立刻变) */}
        <Card>
          <CardHeader
            title="Otto behavior"
            desc="How much Otto does on its own, and when it should hold off. Changes take effect right away."
          />
          <SettingRow
            title="How Otto works"
            desc={
              behavior.autonomy === "review-each"
                ? "Otto drafts everything and waits for your tap. Safest — nothing goes out without you."
                : "Otto runs the routines you set up on its own. Everything else still waits for you."
            }
            control={
              <PillGroup
                ariaLabel="How Otto works"
                value={behavior.autonomy}
                onChange={(v) => setOttoBehavior({ autonomy: v })}
                options={[
                  { value: "review-each", label: "Ask me each time" },
                  { value: "auto-in-routines", label: "Auto in routines" },
                ]}
              />
            }
          />
          <SettingRow
            title="Ask before spending"
            desc={
              behavior.spendConfirmThreshold === 0
                ? "Otto checks with you before spending any credits."
                : `Otto checks with you before any single job that costs ${behavior.spendConfirmThreshold} credits or more.`
            }
            control={
              <PillGroup
                ariaLabel="Ask before spending"
                value={behavior.spendConfirmThreshold}
                onChange={(v) => setOttoBehavior({ spendConfirmThreshold: v })}
                options={[
                  { value: 0, label: "Always" },
                  { value: 50, label: "50+" },
                  { value: 100, label: "100+" },
                  { value: 200, label: "200+" },
                ]}
              />
            }
          />
          <SettingRow
            title="Quiet hours"
            desc={
              behavior.quietHours.enabled
                ? `Otto won't ping you between ${behavior.quietHours.from} and ${behavior.quietHours.to}. It still works — it just holds the updates.`
                : "Otto can ping you any time. Turn on to mute it overnight."
            }
            control={
              <div className="flex items-center gap-2">
                {behavior.quietHours.enabled && (
                  <>
                    <input
                      type="time"
                      value={behavior.quietHours.from}
                      onChange={(e) =>
                        setOttoBehavior({ quietHours: { ...behavior.quietHours, from: e.target.value } })
                      }
                      aria-label="Quiet hours start"
                      className="h-8 rounded-[10px] border border-border bg-background px-2 text-xs font-medium text-foreground tabular-nums outline-none focus-visible:border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <span className="text-xs text-muted-foreground">to</span>
                    <input
                      type="time"
                      value={behavior.quietHours.to}
                      onChange={(e) =>
                        setOttoBehavior({ quietHours: { ...behavior.quietHours, to: e.target.value } })
                      }
                      aria-label="Quiet hours end"
                      className="h-8 rounded-[10px] border border-border bg-background px-2 text-xs font-medium text-foreground tabular-nums outline-none focus-visible:border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </>
                )}
                <Switch
                  checked={behavior.quietHours.enabled}
                  onCheckedChange={(v) =>
                    setOttoBehavior({ quietHours: { ...behavior.quietHours, enabled: v } })
                  }
                  aria-label="Quiet hours"
                />
              </div>
            }
          />
          <div className="flex items-center gap-2 border-t border-border px-4 py-3">
            <Moon className="size-3.5 text-muted-foreground" strokeWidth={2} />
            <p className="text-xs text-muted-foreground">
              These settings show up on Otto&apos;s dock — watch the label change when you switch them.
            </p>
          </div>
        </Card>

        {/* 例程授权入口(account 侧;实体管理面在 automation/routines,四件套安全闸建在那) */}
        <Link
          href={`${BASE}/automation/routines`}
          className="group flex items-center gap-3 rounded-[18px] border border-border bg-card px-4 py-4 transition-colors duration-[120ms] hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary">
            <Repeat className="size-5 text-foreground" strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">Otto&apos;s routines</p>
            <p className="mt-0.5 text-[13px] leading-[18px] text-muted-foreground">
              The standing jobs you&apos;ve let Otto run on a schedule — each with its own budget cap and off switch.
            </p>
          </div>
          <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform duration-[120ms] group-hover:translate-x-0.5" strokeWidth={2} />
        </Link>

        {/* 品牌资料 */}
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
