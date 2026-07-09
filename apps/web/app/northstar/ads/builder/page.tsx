/* @nsPage district="广告区" page="builder" status="draft"
   sources="区划图·广告区;G7 v2 spec(2026-06-29);宪法 7 双模" approvedAt="" pr="" */
"use client";

/**
 * 广告构建工作台 — 人工建整 campaign 草稿(build=$0,PAUSED)与 ad-write。
 *
 * 依据:PAGE-INVENTORY 五·广告区行 2 + G7 v2 spec + 宪法 7 双模(Otto 卡片流已建,
 * 这里是人工对等面)。元素:campaign/adset/ad 结构树、预算与目标、PAUSED 草稿状态、
 * 发布过审批闸(§FB5 dialog + 影响清单;不是钱路 — 建草稿 $0,预算只在批准后起跑)。
 * 全人工面:INK 按钮、零 coral(Otto 不在场,§O3)。
 */

import * as React from "react";
import Image from "next/image";
import { Folder, Image as ImageIcon, Megaphone, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { EmptyState, MockNote, PageHeader } from "@/components/northstar/_shared";
import { NS_ASSETS } from "@/components/northstar/_mock";
import {
  DemoStateBar,
  NsSkeleton,
  Panel,
  type NsDemoState,
} from "@/components/northstar/analytics/zone-kit";
import { AdsTabs } from "@/components/northstar/ads/ads-tabs";
import {
  NS_AD_CTAS,
  NS_AD_DRAFT,
  NS_AD_OBJECTIVES,
  NS_AD_PLACEMENTS,
  type NsDraftAdset,
  type NsDraftCampaign,
} from "@/components/northstar/ads/mock-ads";
import { submitAd } from "@/components/northstar/immersive/_store";

type Selection =
  | { kind: "campaign" }
  | { kind: "adset"; id: string }
  | { kind: "ad"; adsetId: string; id: string };

function cloneDraft(): NsDraftCampaign {
  return JSON.parse(JSON.stringify(NS_AD_DRAFT)) as NsDraftCampaign;
}

function Field({
  label,
  htmlFor,
  help,
  children,
}: {
  label: string;
  htmlFor?: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={htmlFor} className="text-[13px] leading-[18px] font-semibold text-foreground">
        {label}
      </label>
      {children}
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}

function TreeRow({
  depth,
  icon: Icon,
  label,
  active,
  onClick,
}: {
  depth: 0 | 1 | 2;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex min-h-9 w-full items-center gap-2 rounded-[10px] px-3 py-1.5 text-left text-[13px] transition-colors duration-[120ms]",
        depth === 1 && "ml-4 w-[calc(100%-16px)]",
        depth === 2 && "ml-8 w-[calc(100%-32px)]",
        active
          ? "bg-secondary font-semibold text-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <Icon className="size-[18px] shrink-0" strokeWidth={2} />
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

export default function Page() {
  const [demo, setDemo] = React.useState<NsDemoState>("ready");
  const [draft, setDraft] = React.useState<NsDraftCampaign | null>(cloneDraft);
  const [sel, setSel] = React.useState<Selection>({ kind: "campaign" });
  const [submitted, setSubmitted] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const nextId = React.useRef(1);

  // demo 空态 = 没有草稿
  const effectiveDraft = demo === "empty" ? null : draft;

  const adCount = effectiveDraft?.adsets.reduce((n, s) => n + s.ads.length, 0) ?? 0;

  function update(patch: Partial<NsDraftCampaign>) {
    setDraft((d) => (d ? { ...d, ...patch } : d));
  }

  function updateAdset(id: string, patch: Partial<NsDraftAdset>) {
    setDraft((d) =>
      d ? { ...d, adsets: d.adsets.map((s) => (s.id === id ? { ...s, ...patch } : s)) } : d,
    );
  }

  function updateAd(adsetId: string, id: string, patch: Record<string, string>) {
    setDraft((d) =>
      d
        ? {
            ...d,
            adsets: d.adsets.map((s) =>
              s.id === adsetId
                ? { ...s, ads: s.ads.map((a) => (a.id === id ? { ...a, ...patch } : a)) }
                : s,
            ),
          }
        : d,
    );
  }

  function addAdset() {
    const id = `as-new-${nextId.current++}`;
    setDraft((d) =>
      d
        ? {
            ...d,
            adsets: [
              ...d.adsets,
              {
                id,
                name: `Ad set ${d.adsets.length + 1}`,
                location: "Kuala Lumpur + 25 km",
                ageRange: "25-45",
                placement: "advantage",
                ads: [],
              },
            ],
          }
        : d,
    );
    setSel({ kind: "adset", id });
  }

  function addAd(adsetId: string) {
    const id = `ad-new-${nextId.current++}`;
    setDraft((d) =>
      d
        ? {
            ...d,
            adsets: d.adsets.map((s) =>
              s.id === adsetId
                ? {
                    ...s,
                    ads: [
                      ...s.ads,
                      {
                        id,
                        name: `Ad ${s.ads.length + 1}`,
                        assetId: "as-01",
                        primaryText: "",
                        headline: "",
                        cta: "shop_now",
                      },
                    ],
                  }
                : s,
            ),
          }
        : d,
    );
    setSel({ kind: "ad", adsetId, id });
  }

  function startDraft() {
    setDraft(cloneDraft());
    setSel({ kind: "campaign" });
    setSubmitted(false);
    setDemo("ready");
  }

  const selAdset =
    effectiveDraft && sel.kind !== "campaign"
      ? effectiveDraft.adsets.find((s) => s.id === (sel.kind === "adset" ? sel.id : sel.adsetId))
      : undefined;
  const selAd =
    effectiveDraft && sel.kind === "ad" && selAdset
      ? selAdset.ads.find((a) => a.id === sel.id)
      : undefined;

  return (
    <div className="mx-auto w-full max-w-[1280px] px-6 pt-6 pb-24">
      <PageHeader
        title="Ad builder"
        subtitle="Build the whole campaign for free. Nothing runs until it's approved and unpaused."
        meta={effectiveDraft ? [submitted ? "Pending approval" : "Draft · PAUSED"] : undefined}
        actions={
          effectiveDraft && (
            <Button size="sm" disabled={submitted || adCount === 0} onClick={() => setConfirmOpen(true)}>
              {submitted ? "Submitted" : "Submit for approval"}
            </Button>
          )
        }
      />
      <div className="mt-2">
        <AdsTabs />
      </div>

      {demo === "error" && (
        <div className="mt-6 flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-border bg-card px-6 py-14 text-center">
          <div className="text-lg font-semibold text-foreground">Couldn&apos;t load your draft</div>
          <p className="max-w-[380px] text-[13px] leading-[18px] text-muted-foreground">
            Nothing was lost. Try again.
          </p>
          <Button variant="ghost" size="sm" onClick={() => setDemo("ready")}>
            Retry
          </Button>
        </div>
      )}

      {demo === "loading" && (
        <div className="mt-4 grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <NsSkeleton className="h-72 rounded-[var(--radius-card)]" />
          <div>
            <NsSkeleton className="h-11 w-1/2 rounded-[14px]" shimmer={false} />
            <NsSkeleton className="mt-4 h-64 rounded-[var(--radius-card)]" shimmer={false} />
          </div>
        </div>
      )}

      {demo === "empty" && (
        <div className="mt-6 rounded-[var(--radius-card)] border border-border bg-card">
          <EmptyState
            icon={Megaphone}
            title="No campaign draft yet"
            body="Start one. Building is free and the draft stays paused."
            action={
              <Button size="sm" onClick={startDraft}>
                Start a draft
              </Button>
            }
          />
        </div>
      )}

      {demo === "ready" && effectiveDraft && (
        <>
          {submitted && (
            <p className="mt-3 rounded-[14px] bg-info-soft px-4 py-3 text-[13px] leading-[18px] text-info-soft-foreground">
              Submitted for approval. The draft stays paused until it&apos;s approved. You can still
              edit it, edits reset the approval.
            </p>
          )}

          <div className="mt-4 grid items-start gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
            {/* ── 结构树 ── */}
            <Panel title="Structure" basis={`1 campaign · ${effectiveDraft.adsets.length} ad sets · ${adCount} ads`}>
              <div className="mt-2 flex flex-col gap-0.5">
                <TreeRow
                  depth={0}
                  icon={Megaphone}
                  label={effectiveDraft.name || "Untitled campaign"}
                  active={sel.kind === "campaign"}
                  onClick={() => setSel({ kind: "campaign" })}
                />
                {effectiveDraft.adsets.map((s) => (
                  <React.Fragment key={s.id}>
                    <TreeRow
                      depth={1}
                      icon={Users}
                      label={s.name || "Untitled ad set"}
                      active={sel.kind === "adset" && sel.id === s.id}
                      onClick={() => setSel({ kind: "adset", id: s.id })}
                    />
                    {s.ads.map((a) => (
                      <TreeRow
                        key={a.id}
                        depth={2}
                        icon={ImageIcon}
                        label={a.name || "Untitled ad"}
                        active={sel.kind === "ad" && sel.id === a.id}
                        onClick={() => setSel({ kind: "ad", adsetId: s.id, id: a.id })}
                      />
                    ))}
                    <button
                      type="button"
                      onClick={() => addAd(s.id)}
                      className="ml-8 flex min-h-8 w-[calc(100%-32px)] items-center gap-2 rounded-[10px] px-3 py-1 text-left text-[13px] text-muted-foreground transition-colors duration-[120ms] hover:bg-accent hover:text-foreground"
                    >
                      <Plus className="size-4 shrink-0" strokeWidth={2} />
                      Add ad
                    </button>
                  </React.Fragment>
                ))}
                <button
                  type="button"
                  onClick={addAdset}
                  className="ml-4 flex min-h-8 w-[calc(100%-16px)] items-center gap-2 rounded-[10px] px-3 py-1 text-left text-[13px] text-muted-foreground transition-colors duration-[120ms] hover:bg-accent hover:text-foreground"
                >
                  <Plus className="size-4 shrink-0" strokeWidth={2} />
                  Add ad set
                </button>
              </div>
              <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
                Build is free. Everything is created paused in your Meta ad account.
              </p>
            </Panel>

            {/* ── 编辑面 ── */}
            <div className="min-w-0">
              {sel.kind === "campaign" && (
                <Panel title="Campaign" basis="Objective, budget and schedule">
                  <div className="mt-4 flex max-w-[480px] flex-col gap-5">
                    <Field label="Campaign name" htmlFor="c-name">
                      <Input
                        id="c-name"
                        value={effectiveDraft.name}
                        onChange={(e) => update({ name: e.target.value })}
                        placeholder="Merdeka gift box pre-orders"
                      />
                    </Field>
                    <Field label="Objective" htmlFor="c-objective">
                      <Select value={effectiveDraft.objective} onValueChange={(v) => update({ objective: v })}>
                        <SelectTrigger id="c-objective" className="w-full rounded-[14px] bg-card">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {NS_AD_OBJECTIVES.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field
                        label="Daily budget (RM)"
                        htmlFor="c-budget"
                        help="Only starts spending after approval and unpause."
                      >
                        <Input
                          id="c-budget"
                          inputMode="numeric"
                          value={String(effectiveDraft.dailyBudgetMyr)}
                          onChange={(e) => update({ dailyBudgetMyr: Number(e.target.value) || 0 })}
                        />
                      </Field>
                      <Field label="Start date" htmlFor="c-start">
                        <Input
                          id="c-start"
                          value={effectiveDraft.startDate}
                          onChange={(e) => update({ startDate: e.target.value })}
                        />
                      </Field>
                    </div>
                    <div className="flex items-center gap-2 rounded-[14px] bg-secondary/70 px-4 py-3">
                      <Badge variant="warning">PAUSED</Badge>
                      <span className="text-[13px] leading-[18px] text-muted-foreground">
                        The whole draft is created paused. Publishing goes through an approval.
                      </span>
                    </div>
                  </div>
                </Panel>
              )}

              {sel.kind === "adset" && selAdset && (
                <Panel title="Ad set" basis="Audience and placement">
                  <div className="mt-4 flex max-w-[480px] flex-col gap-5">
                    <Field label="Ad set name" htmlFor="s-name">
                      <Input
                        id="s-name"
                        value={selAdset.name}
                        onChange={(e) => updateAdset(selAdset.id, { name: e.target.value })}
                      />
                    </Field>
                    <Field label="Location" htmlFor="s-location">
                      <Input
                        id="s-location"
                        value={selAdset.location}
                        onChange={(e) => updateAdset(selAdset.id, { location: e.target.value })}
                        placeholder="Kuala Lumpur + 25 km"
                      />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Age range" htmlFor="s-age">
                        <Input
                          id="s-age"
                          value={selAdset.ageRange}
                          onChange={(e) => updateAdset(selAdset.id, { ageRange: e.target.value })}
                        />
                      </Field>
                      <Field label="Placement" htmlFor="s-placement">
                        <Select
                          value={selAdset.placement}
                          onValueChange={(v) => updateAdset(selAdset.id, { placement: v })}
                        >
                          <SelectTrigger id="s-placement" className="w-full rounded-[14px] bg-card">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {NS_AD_PLACEMENTS.map((p) => (
                              <SelectItem key={p.value} value={p.value}>
                                {p.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                    </div>
                  </div>
                </Panel>
              )}

              {sel.kind === "ad" && selAdset && selAd && (
                <Panel title="Ad" basis="Creative and copy (ad-write)">
                  <div className="mt-4 flex max-w-[480px] flex-col gap-5">
                    <Field label="Ad name" htmlFor="a-name">
                      <Input
                        id="a-name"
                        value={selAd.name}
                        onChange={(e) => updateAd(selAdset.id, selAd.id, { name: e.target.value })}
                      />
                    </Field>
                    <Field label="Creative" help="Pick from what you already made. New creative comes from the canvas.">
                      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                        {NS_ASSETS.filter((a) => a.status === "ready").map((asset) => {
                          const selected = selAd.assetId === asset.id;
                          return (
                            <button
                              key={asset.id}
                              type="button"
                              aria-pressed={selected}
                              aria-label={asset.title}
                              title={asset.title}
                              onClick={() => updateAd(selAdset.id, selAd.id, { assetId: asset.id })}
                              className={cn(
                                "overflow-hidden rounded-[10px] border transition-colors duration-[120ms]",
                                selected
                                  ? "border-foreground"
                                  : "border-border hover:border-muted-foreground",
                              )}
                            >
                              <Image
                                src={asset.thumb}
                                alt=""
                                width={72}
                                height={72}
                                unoptimized
                                className="aspect-square w-full object-cover"
                              />
                            </button>
                          );
                        })}
                      </div>
                    </Field>
                    <Field label="Primary text" htmlFor="a-primary">
                      <Textarea
                        id="a-primary"
                        value={selAd.primaryText}
                        onChange={(e) => updateAd(selAdset.id, selAd.id, { primaryText: e.target.value })}
                        placeholder="The gift box that sells out every Merdeka."
                        className="min-h-16"
                      />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Headline" htmlFor="a-headline">
                        <Input
                          id="a-headline"
                          value={selAd.headline}
                          onChange={(e) => updateAd(selAdset.id, selAd.id, { headline: e.target.value })}
                          placeholder="Merdeka gift box · RM 68"
                        />
                      </Field>
                      <Field label="Call to action" htmlFor="a-cta">
                        <Select
                          value={selAd.cta}
                          onValueChange={(v) => updateAd(selAdset.id, selAd.id, { cta: v })}
                        >
                          <SelectTrigger id="a-cta" className="w-full rounded-[14px] bg-card">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {NS_AD_CTAS.map((c) => (
                              <SelectItem key={c.value} value={c.value}>
                                {c.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                    </div>
                  </div>
                </Panel>
              )}
            </div>
          </div>
        </>
      )}

      {/* 审批闸(§FB5:影响清单 + 明确动词;$0 — 不是花钱确认) */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-[min(440px,100vw-32px)]">
          <DialogHeader>
            <DialogTitle>Submit this campaign for approval?</DialogTitle>
            <DialogDescription>Nothing runs and nothing spends yet.</DialogDescription>
          </DialogHeader>
          <div className="rounded-[14px] bg-secondary/70 p-4">
            <div className="text-[13px] leading-[18px] font-semibold text-foreground">What happens</div>
            <ul className="mt-2 flex flex-col gap-1.5 text-[13px] leading-[18px] text-muted-foreground">
              <li>
                · Creates 1 campaign, {effectiveDraft?.adsets.length ?? 0}{" "}
                {(effectiveDraft?.adsets.length ?? 0) === 1 ? "ad set" : "ad sets"} and {adCount}{" "}
                {adCount === 1 ? "ad" : "ads"} in your Meta ad account, all paused.
              </li>
              <li>
                · No spend starts. The RM {effectiveDraft?.dailyBudgetMyr ?? 0} daily budget only
                runs after you approve and unpause.
              </li>
              <li>· You can edit or withdraw the draft any time before it&apos;s approved.</li>
            </ul>
          </div>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setSubmitted(true);
                setConfirmOpen(false);
                // 提交落进共享事件流:performance 顶部出「待审」chip + 行,multi-platform Meta 卡亮「审核中」
                submitAd({
                  id: "ns-builder-campaign",
                  label: effectiveDraft?.name || "Untitled campaign",
                  platform: "meta",
                });
              }}
            >
              Submit for approval
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MockNote path="/northstar/ads/builder" />
      <DemoStateBar value={demo} onChange={setDemo} />
    </div>
  );
}
