"use client";

/**
 * 沉浸式 · 市政厅 /admin(内部运维台 —— 设计降级)
 *
 * 市政厅是「盖房子的人」看的内部台,不是对客产品面 —— 所以这一页刻意设计降级:
 * 纯 token 排版、密度优先、mono 元数据,不引 Otto、不用 coral(§O4 coral 预算只属于 Otto,
 * 内部台没有 Otto)。状态色只用系统语义色(success / warning / muted),不碰 brand。
 *
 * gallery 里 cityhall/admin 还是 stub,没有可复用内容组件 —— 内容照 account-ops 先例现建,
 * 数据来自本组局部 mock(下方 ADMIN_ENV / FLAGS / SERVICES / RELEASES)。这不是品牌事实,
 * 是运维台的演示口径。环境标识固定为 `fikirtive-prod`(旧品牌前缀一律不出现)。
 *
 * 铁律沿用外壳:纯 client、零后台 import。
 */

import * as React from "react";
import { cn } from "@/lib/utils";

/* ── 局部 mock(运维台演示口径,非品牌事实) ─────────────────────────────── */

const ADMIN_ENV = {
  environment: "fikirtive-prod",
  region: "ap-southeast-1 · Singapore",
  release: "2026.07.08-1",
  commit: "a7965c2",
} as const;

type FlagState = "on" | "off";
interface Flag {
  key: string;
  label: string;
  state: FlagState;
  note: string;
}
const FLAGS: Flag[] = [
  { key: "northstar_preview", label: "Northstar preview", state: "on", note: "Staging + founder only" },
  { key: "ads_multi_platform", label: "Ads · multi-platform", state: "off", note: "Behind rollout gate" },
  { key: "otto_autopilot", label: "Otto autopilot", state: "off", note: "Requires per-brand opt-in" },
  { key: "weekly_report_email", label: "Weekly report email", state: "on", note: "GM-04 cadence" },
];

type Health = "healthy" | "degraded";
interface Service {
  name: string;
  health: Health;
  detail: string;
}
const SERVICES: Service[] = [
  { name: "web", health: "healthy", detail: "p95 180ms · 0 errors / 5m" },
  { name: "worker", health: "healthy", detail: "queue depth 3 · 0 stuck jobs" },
  { name: "postgres", health: "healthy", detail: "12% connections · replica in sync" },
  { name: "generation service", health: "degraded", detail: "elevated latency · retries holding" },
];

interface Release {
  version: string;
  at: string;
  by: string;
  note: string;
}
const RELEASES: Release[] = [
  { version: "2026.07.08-1", at: "8 Jul · 09:14", by: "ci", note: "canvas node toolbar clicks" },
  { version: "2026.07.07-3", at: "7 Jul · 18:02", by: "ci", note: "generation status sweep scope" },
  { version: "2026.07.07-1", at: "7 Jul · 11:40", by: "ci", note: "Meta connection fallback" },
];

/* ── 设计降级基元(密度优先,无 brand) ─────────────────────────────────── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="font-mono text-[11px] leading-[14px] font-medium tracking-[0.1em] text-muted-foreground uppercase">
        {title}
      </h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function HealthDot({ health }: { health: Health }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-2 shrink-0 rounded-full",
        health === "healthy" ? "bg-success" : "bg-warning",
      )}
    />
  );
}

export function CityhallAdmin() {
  const [flags, setFlags] = React.useState<Flag[]>(FLAGS);

  const toggle = (key: string) =>
    setFlags((fs) => fs.map((f) => (f.key === key ? { ...f, state: f.state === "on" ? "off" : "on" } : f)));

  const anyDegraded = SERVICES.some((s) => s.health === "degraded");

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 pt-6 pb-16">
      {/* 页头:内部台,不带 Otto */}
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-xl leading-[26px] font-semibold tracking-[-0.017em] text-foreground">
          Admin console
        </h1>
        <span className="font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground">
          internal · builders only
        </span>
      </header>

      {/* 环境条:token 边框卡,mono 元数据。环境标识 = fikirtive-prod */}
      <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-[12px] border border-border bg-border sm:grid-cols-4">
        {[
          { k: "environment", v: ADMIN_ENV.environment },
          { k: "region", v: ADMIN_ENV.region },
          { k: "release", v: ADMIN_ENV.release },
          { k: "commit", v: ADMIN_ENV.commit },
        ].map((cell) => (
          <div key={cell.k} className="bg-card px-4 py-3">
            <div className="font-mono text-[10px] leading-[14px] tracking-[0.08em] text-muted-foreground uppercase">
              {cell.k}
            </div>
            <div className="mt-0.5 truncate font-mono text-[13px] leading-[18px] font-medium text-foreground">
              {cell.v}
            </div>
          </div>
        ))}
      </div>

      {/* 服务健康 */}
      <Section title={`Service health${anyDegraded ? " · 1 degraded" : ""}`}>
        <div className="overflow-hidden rounded-[12px] border border-border bg-card">
          {SERVICES.map((s, i) => (
            <div
              key={s.name}
              className={cn("flex items-center gap-3 px-4 py-3", i > 0 && "border-t border-border")}
            >
              <HealthDot health={s.health} />
              <span className="w-28 shrink-0 font-mono text-[13px] font-medium text-foreground">{s.name}</span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">{s.detail}</span>
              <span
                className={cn(
                  "shrink-0 font-mono text-[11px] tracking-[0.06em] uppercase",
                  s.health === "healthy" ? "text-success" : "text-warning",
                )}
              >
                {s.health}
              </span>
            </div>
          ))}
        </div>
      </Section>

      {/* 功能开关:切换即时(演示 state),无 coral */}
      <Section title="Feature flags">
        <div className="overflow-hidden rounded-[12px] border border-border bg-card">
          {flags.map((f, i) => (
            <div
              key={f.key}
              className={cn("flex items-center gap-4 px-4 py-3", i > 0 && "border-t border-border")}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-foreground">{f.label}</div>
                <div className="truncate font-mono text-[11px] text-muted-foreground">
                  {f.key} · {f.note}
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={f.state === "on"}
                aria-label={`${f.label} ${f.state === "on" ? "on" : "off"}`}
                onClick={() => toggle(f.key)}
                className={cn(
                  "relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-[120ms]",
                  f.state === "on" ? "border-foreground bg-foreground" : "border-border bg-secondary",
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 size-4 rounded-full bg-background transition-[left] duration-[120ms]",
                    f.state === "on" ? "left-[22px]" : "left-0.5",
                  )}
                />
              </button>
            </div>
          ))}
        </div>
      </Section>

      {/* 发布历史 */}
      <Section title="Recent releases">
        <div className="overflow-hidden rounded-[12px] border border-border bg-card">
          {RELEASES.map((r, i) => (
            <div
              key={r.version}
              className={cn("flex items-baseline gap-3 px-4 py-3", i > 0 && "border-t border-border")}
            >
              <span className="w-32 shrink-0 font-mono text-[12px] font-medium text-foreground">{r.version}</span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">{r.note}</span>
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                {r.at} · {r.by}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <p className="mt-10 font-mono text-[11px] leading-[16px] tracking-[0.02em] text-muted-foreground">
        internal ops surface · design-degraded on purpose · no Otto, no brand coral · environment {ADMIN_ENV.environment}
      </p>
    </div>
  );
}
