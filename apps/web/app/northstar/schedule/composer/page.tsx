/* @nsPage district="排期区" page="composer" status="draft"
   sources="区划图·排期区;harmony-01 #4;X 定价判决(第四批)" approvedAt="" pr="" */
"use client";

/**
 * Composer — 撰写与定时一条帖。
 * 清单元素:账号选择(X + IG 等多目标)· 媒体选现有成片(My Stuff 选择器)· 时区
 * · first comment · 逐平台定制(PostVariant tab)· X 分档报价提示(不含链接 1 credit /
 * 含链接 4 credits,第四批判决)。花钱按钮带准确成本(§V5);校验 punish-late(§F4);
 * 确认走 dialog(§FB5),金额在按钮前原文出现(宪法 2 的文案面)。
 */

import * as React from "react";
import Link from "next/link";
import { BellOff, CalendarCheck, Check, Image as ImageIcon, Info, Users, X as XIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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
import { EmptyState, MockNote, PageHeader } from "@/components/northstar/_shared";
import { NS_ASSETS, NS_SCHEDULED_POSTS, nsPlaceholder, type NsAsset } from "@/components/northstar/_mock";
import {
  DemoStateBar,
  ErrorPanel,
  PLATFORMS,
  PlatformTag,
  Skeleton,
  ViewSwitch,
  fmtDateLong,
  fmtTime,
  type DemoState,
  type NsPlatform,
} from "@/components/northstar/schedule/kit";
import { saveDraft, schedulePost, useStore, contactsView, customSegments } from "@/components/northstar/immersive/_store";
import { useQueryParam } from "@/components/northstar/immersive/_kit";
import { SEGMENTS, contactMatchesRules } from "@/components/northstar/immersive/crm-inbox/data";
import { Initials } from "@/components/northstar/immersive/_kit";
import type { NsContact } from "@/components/northstar/_mock";

const ALL_TARGETS: NsPlatform[] = ["instagram", "facebook", "tiktok", "x"];
const TIMES = ["07:00", "08:00", "09:00", "10:00", "12:00", "17:00", "19:00", "21:00"];
const X_LIMIT = 280;

const LINK_RE = /(https?:\/\/|www\.)/i;

function Field({
  label,
  help,
  error,
  optional,
  children,
}: {
  label: string;
  help?: string;
  error?: string | null;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] leading-[18px] font-semibold text-foreground">
        {label}
        {optional && <span className="font-normal text-muted-foreground"> (optional)</span>}
      </span>
      {children}
      {error ? (
        <span role="alert" className="text-[13px] leading-[18px] font-medium text-error-soft-foreground">
          {error}
        </span>
      ) : (
        help && <span className="text-xs leading-4 font-medium text-muted-foreground">{help}</span>
      )}
    </div>
  );
}

export default function Page() {
  const [demo, setDemo] = React.useState<DemoState>("data");

  const [targets, setTargets] = React.useState<NsPlatform[]>(["instagram", "x"]);
  const [caption, setCaption] = React.useState("");
  const [captionError, setCaptionError] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [media, setMedia] = React.useState<NsAsset | null>(null);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [date, setDate] = React.useState("2026-07-08");
  const [time, setTime] = React.useState("09:00");
  const [firstComment, setFirstComment] = React.useState("");
  const [overrides, setOverrides] = React.useState<Partial<Record<NsPlatform, string>>>({});
  const [activeTab, setActiveTab] = React.useState<NsPlatform>("instagram");
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [scheduled, setScheduled] = React.useState(false);

  // 受众:CRM「Post to this group」带 ?segment= 进来 → 预选受众 chip;勿扰者禁用不群发
  useStore(); // 订阅共享 store:受众按当前联系人 / 勿扰状态实时算
  const querySegment = useQueryParam("segment");
  const [segmentId, setSegmentId] = React.useState<string | null>(null);
  const [audienceDismissed, setAudienceDismissed] = React.useState(false);
  // 挂载后再应用(与 ?post prefill 同法,避免 SSR/client 首帧不一致)
  React.useEffect(() => setSegmentId(querySegment), [querySegment]);

  const captionRef = React.useRef<HTMLTextAreaElement>(null);
  const tabRefs = React.useRef<(HTMLButtonElement | null)[]>([]);

  // 深链 ?post → 从排期里带出这条帖的内容预填(挂载后应用,避免 hydration 抖动)
  const prefillPostId = useQueryParam("post");
  React.useEffect(() => {
    if (!prefillPostId) return;
    const p = NS_SCHEDULED_POSTS.find((x) => x.id === prefillPostId);
    if (!p) return;
    setCaption(p.caption);
    if (p.firstComment) setFirstComment(p.firstComment);
    const [d, t] = p.scheduledAt.split("T");
    setDate(d);
    const hhmm = t?.slice(0, 5);
    if (hhmm && TIMES.includes(hhmm)) setTime(hhmm);
    setTargets([p.platform]);
    setActiveTab(p.platform);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleTarget = (p: NsPlatform) => {
    setFormError(null);
    setTargets((prev) => {
      const next = prev.includes(p) ? prev.filter((t) => t !== p) : [...prev, p];
      if (!next.includes(activeTab) && next.length > 0) setActiveTab(next[0]);
      return next;
    });
  };

  // X 分档报价:不含链接 1 credit / 含链接 4 credits
  const xText = (overrides.x?.trim() || caption).trim();
  const xHasLink = LINK_RE.test(xText);
  const xCost = targets.includes("x") ? (xHasLink ? 4 : 1) : 0;
  const costLabel = xCost === 1 ? "1 credit" : `${xCost} credits`;

  const validate = (): boolean => {
    let ok = true;
    if (targets.length === 0) {
      setFormError("Pick at least one channel to post to.");
      ok = false;
    }
    if (!caption.trim()) {
      setCaptionError("Write a caption before scheduling.");
      captionRef.current?.focus();
      ok = false;
    }
    return ok;
  };

  const onSchedule = () => {
    if (!validate()) return;
    setConfirmOpen(true);
  };

  const confirmSchedule = () => {
    setPending(true);
    window.setTimeout(() => {
      setPending(false);
      setConfirmOpen(false);
      setScheduled(true);
      // 排期落进共享 store → home「Up next」立刻反映(闭环,不再是死按钮)
      const existing = prefillPostId && NS_SCHEDULED_POSTS.some((p) => p.id === prefillPostId);
      schedulePost({
        id: existing ? prefillPostId! : `post-live-${Date.now()}`,
        scheduledAt: `${date}T${time}:00+08:00`,
        platform: targets[0],
        caption: caption.trim(),
        media: media?.thumb ?? nsPlaceholder("New post", 640, 640, "neutral"),
        status: "scheduled",
        firstComment: firstComment.trim() || undefined,
      });
    }, 800);
  };

  // Save draft:真写共享 store(status draft),queue「Drafts」分组与 home「Up next」立刻反映。
  const onSaveDraft = () => {
    if (targets.length === 0) {
      setFormError("Pick at least one channel to save this draft for.");
      return;
    }
    const existing = prefillPostId && NS_SCHEDULED_POSTS.some((p) => p.id === prefillPostId);
    saveDraft({
      id: existing ? prefillPostId! : `post-draft-${Date.now()}`,
      scheduledAt: `${date}T${time}:00+08:00`,
      platform: targets[0],
      caption: caption.trim(),
      media: media?.thumb ?? nsPlaceholder("Draft", 640, 640, "neutral"),
      status: "draft",
      firstComment: firstComment.trim() || undefined,
    });
    toast("Draft saved", { description: "Find it in the queue under Drafts." });
  };

  const resetForm = () => {
    setScheduled(false);
    setCaption("");
    setCaptionError(null);
    setFormError(null);
    setMedia(null);
    setFirstComment("");
    setOverrides({});
    setTargets(["instagram", "x"]);
    setActiveTab("instagram");
  };

  const onTabKey = (e: React.KeyboardEvent, idx: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const dir = e.key === "ArrowRight" ? 1 : -1;
    const next = (idx + dir + targets.length) % targets.length;
    setActiveTab(targets[next]);
    tabRefs.current[next]?.focus();
  };

  const previewCaption = (overrides[activeTab]?.trim() || caption).trim();
  const xLen = xText.length;

  // 受众解析:自建分群优先(store),否则内建分群(SEGMENTS);勿扰者拆出禁用态
  const segmentAudience = ((): { name: string; members: NsContact[] } | null => {
    if (!segmentId || audienceDismissed) return null;
    const all = contactsView();
    const custom = customSegments().find((s) => s.id === segmentId);
    if (custom) return { name: custom.name, members: all.filter((c) => contactMatchesRules(c, custom.rules)) };
    const builtIn = SEGMENTS.find((s) => s.id === segmentId);
    if (builtIn) return { name: builtIn.name, members: all.filter(builtIn.match) };
    return null;
  })();
  const audienceReach = segmentAudience ? segmentAudience.members.filter((c) => !c.doNotDisturb) : [];
  const audienceDnd = segmentAudience ? segmentAudience.members.filter((c) => c.doNotDisturb) : [];

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="New post"
        subtitle="Write once, tune per platform, pick a time."
        actions={<ViewSwitch />}
      />

      {demo === "loading" && (
        <div className="mt-6 flex max-w-[560px] flex-col gap-5">
          <Skeleton className="h-4 w-24" />
          <div className="flex gap-2">
            <Skeleton className="h-11 w-36 rounded-[14px]" shimmer />
            <Skeleton className="h-11 w-36 rounded-[14px]" />
            <Skeleton className="h-11 w-36 rounded-[14px]" />
          </div>
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-24 w-full rounded-[14px]" shimmer />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-11 w-full rounded-[14px]" shimmer />
        </div>
      )}

      {demo === "empty" && (
        <EmptyState
          icon={ImageIcon}
          title="No channels connected"
          body="Connect Instagram or X in Connections to start posting."
          action={
            <Button variant="secondary" size="sm" asChild>
              <Link href="/northstar/account/connections">Open Connections</Link>
            </Button>
          }
          className="mt-6"
        />
      )}

      {demo === "error" && (
        <ErrorPanel text="Couldn't load your channels." onRetry={() => setDemo("data")} className="mt-6" />
      )}

      {demo === "data" && scheduled && (
        <div className="mt-8 flex flex-col items-center gap-3 rounded-[18px] border border-border bg-card p-8 text-center">
          <span className="flex size-12 items-center justify-center rounded-[14px] bg-secondary">
            <CalendarCheck className="size-5 text-foreground" strokeWidth={2} />
          </span>
          <p className="text-lg font-semibold text-foreground">
            Scheduled for {fmtDateLong(date)}, {fmtTime(time)}
          </p>
          <p className="max-w-[420px] text-sm text-muted-foreground">
            Going to {targets.map((t) => PLATFORMS[t].label).join(", ")}.
            {xCost > 0 && <> You approved this. X will use {costLabel} when it publishes.</>}
          </p>
          <div className="mt-2 flex items-center gap-3">
            <Button variant="secondary" size="sm" asChild>
              <Link href="/northstar/schedule/queue">View queue</Link>
            </Button>
            <Button variant="ghost" size="sm" onClick={resetForm}>
              New post
            </Button>
          </div>
        </div>
      )}

      {demo === "data" && !scheduled && (
        <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex min-w-0 flex-col gap-5">
            {/* 受众(CRM 分群带过来的预选 chip;勿扰者禁用不群发) */}
            {segmentAudience && (
              <div className="flex flex-col gap-3 rounded-[14px] border border-border bg-secondary/40 p-4">
                <div className="flex items-center gap-2">
                  <Users className="size-4 text-muted-foreground" strokeWidth={2} />
                  <span className="text-[13px] font-semibold text-foreground">Audience</span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-card px-2.5 py-1 text-xs font-semibold text-foreground ring-1 ring-border">
                    {segmentAudience.name}
                    <button
                      type="button"
                      onClick={() => setAudienceDismissed(true)}
                      aria-label="Clear audience"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <XIcon className="size-3" strokeWidth={2.5} />
                    </button>
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {audienceReach.length} will get this
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {segmentAudience.members.map((c) => (
                    <span
                      key={c.id}
                      title={c.doNotDisturb ? `${c.name} is on do not disturb — left out` : c.name}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium",
                        c.doNotDisturb
                          ? "border-dashed border-border text-muted-foreground line-through opacity-60"
                          : "border-border bg-card text-foreground",
                      )}
                    >
                      <Initials name={c.name} className="size-4 text-[8px]" />
                      {c.name}
                      {c.doNotDisturb && <BellOff className="size-3" strokeWidth={2} />}
                    </span>
                  ))}
                  {segmentAudience.members.length === 0 && (
                    <span className="text-xs text-muted-foreground">No contacts match this segment right now.</span>
                  )}
                </div>
                {audienceDnd.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {audienceDnd.length} contact{audienceDnd.length > 1 ? "s" : ""} on do not disturb{" "}
                    {audienceDnd.length > 1 ? "are" : "is"} left out — change that on their profile.
                  </p>
                )}
              </div>
            )}

            {/* 账号选择(多目标;X + IG 判决核心) */}
            <Field
              label="Channels"
              help="Pick every account this post goes to."
              error={formError}
            >
              <div className="flex flex-wrap gap-2">
                {ALL_TARGETS.map((p) => {
                  const on = targets.includes(p);
                  return (
                    <button
                      key={p}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleTarget(p)}
                      className={cn(
                        "flex h-11 items-center gap-2 rounded-[14px] border px-3.5 text-sm font-medium",
                        on
                          ? "border-foreground bg-secondary text-foreground"
                          : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      <PlatformTag platform={p} />
                      <span>{PLATFORMS[p].label}</span>
                      <span className="hidden text-xs text-muted-foreground sm:inline">{PLATFORMS[p].handle}</span>
                      {on && <Check className="size-4" strokeWidth={2} />}
                    </button>
                  );
                })}
              </div>
            </Field>

            {/* 主文案 */}
            <Field label="Caption" error={captionError}>
              <Textarea
                ref={captionRef}
                value={caption}
                onChange={(e) => {
                  setCaption(e.target.value);
                  if (captionError && e.target.value.trim()) setCaptionError(null);
                }}
                aria-invalid={captionError ? true : undefined}
                placeholder="Fresh out of the oven: kaya butter croissants till 11am."
                className="min-h-24 rounded-[14px] bg-card text-[15px] leading-[22px]"
              />
            </Field>

            {/* 媒体:选现有成片 */}
            <Field label="Media" help="Pick a finished visual from My Stuff." optional>
              {media ? (
                <div className="flex items-center gap-3 rounded-[14px] border border-border bg-card p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={media.thumb} alt="" className="size-16 shrink-0 rounded-[10px] border border-border object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">{media.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {media.kind} · made {media.createdAt}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setPickerOpen(true)}>
                    Replace
                  </Button>
                  <Button variant="ghost" size="sm" aria-label="Remove media" onClick={() => setMedia(null)}>
                    <XIcon strokeWidth={2} />
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="flex h-20 w-full items-center justify-center gap-2 rounded-[14px] border border-dashed border-border text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <ImageIcon className="size-4" strokeWidth={2} />
                  Choose from My Stuff
                </button>
              )}
            </Field>

            {/* 定时 + 时区 */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date">
                <Input type="date" value={date} min="2026-07-07" max="2026-08-31" onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field label="Time" help="Times are in Asia/Kuala_Lumpur (UTC+8).">
                <Select value={time} onValueChange={setTime}>
                  <SelectTrigger className="h-11 w-full rounded-[14px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {fmtTime(t)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            {/* first comment */}
            <Field label="First comment" help="Instagram only. Posts right after the main post." optional>
              <Input
                value={firstComment}
                onChange={(e) => setFirstComment(e.target.value)}
                placeholder="Pre-order closes Friday 6pm!"
              />
            </Field>

            {/* 逐平台定制(PostVariant) */}
            {targets.length > 0 && (
              <div className="flex flex-col gap-3">
                <span className="text-[13px] leading-[18px] font-semibold text-foreground">
                  Customize per platform
                </span>
                <div role="tablist" aria-label="Platform variants" className="inline-flex w-fit gap-1 rounded-[14px] bg-muted p-1">
                  {targets.map((p, i) => {
                    const active = activeTab === p;
                    return (
                      <button
                        key={p}
                        ref={(el) => {
                          tabRefs.current[i] = el;
                        }}
                        role="tab"
                        aria-selected={active}
                        tabIndex={active ? 0 : -1}
                        onKeyDown={(e) => onTabKey(e, i)}
                        onClick={() => setActiveTab(p)}
                        className={cn(
                          "rounded-[10px] px-4 py-2 text-[13px]",
                          active
                            ? "bg-card font-semibold text-foreground shadow-[var(--shadow-sm)]"
                            : "font-medium text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {PLATFORMS[p].label}
                      </button>
                    );
                  })}
                </div>
                <div className="flex flex-col gap-2 rounded-[14px] border border-border bg-card p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      {PLATFORMS[activeTab].label} caption override
                    </span>
                    {activeTab === "x" && xLen > X_LIMIT * 0.8 && (
                      <span
                        className={cn(
                          "font-mono text-[11px] leading-[14px] font-medium tabular-nums",
                          xLen > X_LIMIT ? "text-error-soft-foreground" : "text-muted-foreground",
                        )}
                      >
                        {xLen}/{X_LIMIT}
                      </span>
                    )}
                  </div>
                  <Textarea
                    value={overrides[activeTab] ?? ""}
                    onChange={(e) => setOverrides((prev) => ({ ...prev, [activeTab]: e.target.value }))}
                    placeholder="Same as main caption"
                    className="min-h-16 rounded-[10px] bg-background text-sm"
                  />
                  {activeTab === "x" && (
                    <div className="flex items-start gap-2 rounded-[10px] bg-secondary/70 p-3">
                      <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
                      <p className="text-xs leading-4 text-muted-foreground">
                        X pricing: 1 credit without a link, 4 credits with one.{" "}
                        {xHasLink ? (
                          <>Link detected · this post costs <span className="font-semibold text-foreground">4 credits</span>.</>
                        ) : (
                          <>No link detected · this post costs <span className="font-semibold text-foreground">1 credit</span>.</>
                        )}
                      </p>
                    </div>
                  )}
                  {activeTab === "instagram" && firstComment.trim() !== "" && (
                    <p className="text-xs leading-4 text-muted-foreground">
                      First comment posts here: “{firstComment}”
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* 动作行 */}
            <div className="mt-2 flex items-center gap-3 border-t border-border pt-5">
              {xCost > 0 && (
                <span className="font-mono text-[11px] leading-[14px] font-medium tracking-[0.02em] text-muted-foreground tabular-nums">
                  Cost: {costLabel} · charged when it posts
                </span>
              )}
              <div className="flex-1" />
              <Button variant="secondary" size="sm" onClick={onSaveDraft}>
                Save draft
              </Button>
              <Button size="sm" onClick={onSchedule}>
                {xCost > 0 ? `Schedule post · ${costLabel}` : "Schedule post"}
              </Button>
            </div>
          </div>

          {/* 预览(右栏,当前 tab 平台) */}
          <aside className="hidden lg:block">
            <div className="sticky top-6 flex flex-col gap-2 rounded-[18px] border border-border bg-card p-4">
              <div className="flex items-center gap-2">
                <PlatformTag platform={activeTab} />
                <span className="text-[13px] font-semibold text-foreground">{PLATFORMS[activeTab].handle}</span>
              </div>
              {media ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={media.thumb} alt="" className="aspect-square w-full rounded-[10px] border border-border object-cover" />
              ) : (
                <div className="flex aspect-square w-full items-center justify-center rounded-[10px] border border-dashed border-border text-xs text-muted-foreground">
                  No media yet
                </div>
              )}
              <p className={cn("text-[13px] leading-[18px]", previewCaption ? "text-foreground" : "text-muted-foreground")}>
                {previewCaption || "Your caption will appear here."}
              </p>
              {activeTab === "instagram" && firstComment.trim() !== "" && (
                <p className="border-t border-border pt-2 text-xs leading-4 text-muted-foreground">{firstComment}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Scheduled · {fmtDateLong(date)} · {fmtTime(time)}
              </p>
            </div>
          </aside>
        </div>
      )}

      {/* 媒体选择器(§FB5 L 号) */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-[min(720px,calc(100vw-2rem))]">
          <DialogHeader>
            <DialogTitle className="text-xl leading-[26px] font-semibold tracking-[-0.017em]">
              Choose media
            </DialogTitle>
            <DialogDescription>Finished visuals from My Stuff. Generating ones show up when they are ready.</DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[50vh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
            {NS_ASSETS.filter((a) => a.status === "ready").map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => {
                  setMedia(a);
                  setPickerOpen(false);
                }}
                className="flex flex-col gap-1.5 rounded-[14px] border border-border bg-card p-2 text-left hover:bg-accent"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.thumb} alt="" className="aspect-square w-full rounded-[10px] border border-border object-cover" />
                <span className="truncate text-[13px] font-semibold text-foreground">{a.title}</span>
                <span className="text-[11px] leading-[14px] text-muted-foreground">{a.kind}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* 定时确认(花钱面:金额先于按钮,§FB6 / 宪法 2 文案面) */}
      <Dialog open={confirmOpen} onOpenChange={(open) => !open && !pending && setConfirmOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule this post?</DialogTitle>
            <DialogDescription>
              {fmtDateLong(date)} · {fmtTime(time)} · Asia/Kuala_Lumpur
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 rounded-[14px] bg-secondary/70 p-3 text-[13px] leading-[18px] text-foreground">
            <span>Goes to {targets.map((t) => PLATFORMS[t].label).join(", ")}.</span>
            {xCost > 0 ? (
              <span>
                The X post uses <span className="font-semibold">{costLabel}</span> when it publishes. No
                charge until then.
              </span>
            ) : (
              <span>No credits are used for this post.</span>
            )}
          </div>
          <DialogFooter className="flex-row justify-end gap-3">
            <Button variant="secondary" size="sm" disabled={pending} onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={pending} onClick={confirmSchedule}>
              {pending ? "Scheduling…" : xCost > 0 ? `Schedule · ${costLabel}` : "Schedule post"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DemoStateBar value={demo} onChange={(v) => setDemo(v as DemoState)} />
      <MockNote path="/northstar/schedule/composer" />
    </div>
  );
}
