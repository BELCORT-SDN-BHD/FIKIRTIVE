"use client";

/**
 * 排期区 · Composer（§L2 List/Detail;页壳 880 / 表单列 560）— 原生重建。
 * 一稿多发 + 逐平台定制（PostVariant tab）· X 分档报价（不含链接 1 / 含链接 4 credits）·
 * media 选现有成片（不生成）· first comment · 逐平台预览。花钱按钮带准确成本,确认走 Dialog。
 * Wave B:Channel Groups(#3)· Hashtag 组(#4)· 最佳时间建议(#6)· IG 九宫格 + Alt text(#7)·
 * 内容标签 + UTM(#11)· 媒体裁剪/换尺寸 + 相邻连续性(#13)· 提醒式发布(#5)· 断链检查。
 */

import * as React from "react";
import Link from "next/link";
import {
  BellOff,
  CalendarCheck,
  Check,
  Grid3x3,
  Hash,
  Image as ImageIcon,
  Info,
  Link2,
  Sparkles,
  Users,
  X as XIcon,
} from "lucide-react";
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
import { EmptyState, PageHeader } from "@/components/northstar/_shared";
import { NS_ASSETS, NS_SCHEDULED_POSTS, nsImage, type NsAsset, type NsContact, type NsScheduledPost } from "@/components/northstar/_mock";
import {
  BASE,
  DOW_MON,
  NS_TODAY,
  PLATFORMS,
  PlatformTag,
  ViewSwitch,
  addDaysIso,
  dowMon,
  fmtDateLong,
  fmtTime,
  livePosts,
  type NsPlatform,
} from "./kit";
import { POST_TYPES, bestTimesForType, buildUtm, checkLinks, type PostType } from "./data";
import { OttoAssist } from "../otto-assist";
import { useSweep } from "../_kit";
import type { NsAssistApply, NsAssistIntent } from "../_store";
import {
  saveDraft,
  schedulePost,
  scheduledPosts,
  setPostMeta,
  channelGroups,
  addChannelGroup,
  hashtagGroups,
  addHashtagGroup,
  contactsView,
  customSegments,
  useStore,
} from "../_store";
import { useQueryParam, Initials } from "../_kit";
import { contactMatchesRules } from "../crm-inbox/data";
// [wave-c-integration] 受众解析改用 ALL_SEGMENTS(价值分离 + lifecycle + 通用内建):
// crm/segments 的「Post to this group」深链会带 seg-ltv/seg-recent/seg-seasonal/seg-winback/seg-hot
// 这些价值/生命周期分群 id;旧解析只查基础 SEGMENTS,命不中即静默无受众。改超集即解析得到。
import { ALL_SEGMENTS } from "../crm-inbox/crm-data";

const ALL_TARGETS: NsPlatform[] = ["instagram", "facebook", "tiktok", "x"];
const TIMES = ["07:00", "08:00", "09:00", "10:00", "12:00", "12:30", "17:00", "18:00", "19:00", "20:00", "21:00"];
const RATIOS = [
  { key: "1:1", label: "Square 1:1", cls: "aspect-square" },
  { key: "4:5", label: "Portrait 4:5", cls: "aspect-[4/5]" },
  { key: "9:16", label: "Story 9:16", cls: "aspect-[9/16]" },
] as const;
const X_LIMIT = 280;

/* ── [wave-c] caption Otto 意图随 postType 走 ──────────────────────────────────
 * 修:老板在 best-time 选了内容类型(Promo/Behind/Weekend),Caption 的「零打字起草」chip
 * 却恒定 fresh——formState 传了 postType 却没人读。现在同一 postType 同时驱动 best-time 窗口
 * 与 caption 草稿,一个真相源。每型一句能站住的起草模板(占位符待老板填真事实,不编品牌数字)。*/
type CaptionDraft = { label: string; prompt: string; reply: string; summary: string; caption: string };
const CAPTION_DRAFTS: Record<PostType, CaptionDraft> = {
  fresh: {
    label: "Draft today's fresh bake",
    prompt: "Write a caption for what's fresh out of the oven today.",
    reply: "Here's a starter — swap in today's actual bake and cut-off time before you post:",
    summary: "Fill the caption with a fresh-bake draft",
    caption: "Fresh out of the oven: [today's bake] till 11am. Walk in or pre-order — link in bio.",
  },
  promo: {
    label: "Write a promo",
    prompt: "Write a short promo caption with a clear offer and cut-off.",
    reply: "A promo needs one offer and one deadline. Here's a draft — set the real discount and date:",
    summary: "Fill the caption with a promo draft",
    caption: "[X]% off [product] till [day] 6pm. Order on WhatsApp or link in bio — while stock lasts.",
  },
  behind: {
    label: "Draft a behind-the-scenes",
    prompt: "Write a behind-the-scenes caption about how today's bake is made.",
    reply: "Behind-the-scenes lands on story and process. Here's a draft — put your own detail in:",
    summary: "Fill the caption with a behind-the-scenes draft",
    caption: "Since 5am: [what you're making], shaped by hand, no shortcuts. This is what goes into every [product].",
  },
  weekend: {
    label: "Draft a weekend special",
    prompt: "Write a caption for this weekend's special with a pre-order cut-off.",
    reply: "A weekend special needs the item and a pre-order deadline. Here's a draft — set both:",
    summary: "Fill the caption with a weekend-special draft",
    caption: "This weekend only: [weekend bake]. Pre-order by Friday 6pm — we bake to order, link in bio.",
  },
};

function Field({
  label,
  help,
  error,
  optional,
  action,
  children,
}: {
  label: string;
  help?: string;
  error?: string | null;
  optional?: boolean;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-[13px] leading-[18px] font-semibold text-foreground">
          {label}
          {optional && <span className="font-normal text-muted-foreground"> (optional)</span>}
        </span>
        {action && <span className="ml-auto">{action}</span>}
      </div>
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

export function ScheduleComposer() {
  useStore();
  // STALL #66:默认只勾已连且免费的渠道(Instagram);付费的 X 每条扣 credit,不默认替老板
  // 把手伸进钱包 —— 要发 X 得他自己点亮。
  const [targets, setTargets] = React.useState<NsPlatform[]>(["instagram"]);
  const [caption, setCaption] = React.useState("");
  const [captionError, setCaptionError] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [media, setMedia] = React.useState<NsAsset | null>(null);
  const [ratio, setRatio] = React.useState<(typeof RATIOS)[number]["key"]>("1:1");
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [gridOpen, setGridOpen] = React.useState(false);
  const [date, setDate] = React.useState("2026-07-08");
  const [time, setTime] = React.useState("09:00");
  const [postType, setPostType] = React.useState<PostType>("fresh");
  const captionSweep = useSweep();
  const [firstComment, setFirstComment] = React.useState("");
  const [altText, setAltText] = React.useState("");
  const [tags, setTags] = React.useState<string[]>([]);
  const [tagInput, setTagInput] = React.useState("");
  const [linkUrl, setLinkUrl] = React.useState("");
  const [reminder, setReminder] = React.useState(false);
  const [overrides, setOverrides] = React.useState<Partial<Record<NsPlatform, string>>>({});
  const [activeTab, setActiveTab] = React.useState<NsPlatform>("instagram");
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [scheduled, setScheduled] = React.useState(false);

  const querySegment = useQueryParam("segment");
  const [segmentId, setSegmentId] = React.useState<string | null>(null);
  const [audienceDismissed, setAudienceDismissed] = React.useState(false);
  React.useEffect(() => setSegmentId(querySegment), [querySegment]);

  const captionRef = React.useRef<HTMLTextAreaElement>(null);
  const tabRefs = React.useRef<(HTMLButtonElement | null)[]>([]);

  const prefillPostId = useQueryParam("post");
  // 记住整条源帖:保存时把不在表单里的上下文字段(campaignId / 原 media / crossPostIds)
  // 一并带回 —— 否则「整对象替换」会把它们静默丢弃(帖从 campaign 详情消失、图变兜底图)。
  const prefillSource = React.useRef<NsScheduledPost | null>(null);
  React.useEffect(() => {
    if (!prefillPostId) {
      prefillSource.current = null;
      return;
    }
    // store live 优先(运行时新建的 post-live-*/post-draft-*/sched-* 打开满字段),静态种子兜底。
    const p = scheduledPosts().find((x) => x.id === prefillPostId) ?? NS_SCHEDULED_POSTS.find((x) => x.id === prefillPostId);
    if (!p) return;
    prefillSource.current = p;
    setCaption(p.caption);
    if (p.firstComment) setFirstComment(p.firstComment);
    if (p.altText) setAltText(p.altText);
    const [d, t] = p.scheduledAt.split("T");
    setDate(d);
    const hhmm = t?.slice(0, 5);
    if (hhmm && TIMES.includes(hhmm)) setTime(hhmm);
    setTargets([p.platform]);
    setActiveTab(p.platform);
    // 依赖 prefillPostId:同组件内切换 ?post= 时重新回填(依赖数组曾为空 → 不重填)。
  }, [prefillPostId]);

  const toggleTarget = (p: NsPlatform) => {
    setFormError(null);
    setTargets((prev) => {
      const next = prev.includes(p) ? prev.filter((t) => t !== p) : [...prev, p];
      if (!next.includes(activeTab) && next.length > 0) setActiveTab(next[0]);
      return next;
    });
  };
  const applyChannelGroup = (channels: NsPlatform[]) => {
    setTargets(channels);
    if (!channels.includes(activeTab) && channels.length > 0) setActiveTab(channels[0]);
    setFormError(null);
  };

  // X 分档报价
  const xText = (overrides.x?.trim() || caption).trim();
  const linkRe = /(https?:\/\/|www\.)/i;
  const xHasLink = linkRe.test(xText) || (linkUrl.trim() !== "" && targets.includes("x"));
  const xCost = targets.includes("x") ? (xHasLink ? 4 : 1) : 0;
  const costLabel = xCost === 1 ? "1 credit" : `${xCost} credits`;

  // 断链检查(caption + first comment + link 字段)
  const linkReport = checkLinks(caption, overrides.x, overrides.facebook, firstComment, linkUrl);

  const addTag = (raw: string) => {
    const t = raw.trim().replace(/\s+/g, "");
    if (!t) return;
    const tag = t.startsWith("#") ? t : `#${t}`;
    setTags((prev) => (prev.includes(tag) ? prev : [...prev, tag]));
    setTagInput("");
  };
  const insertHashtagGroup = (groupTags: string[]) => {
    setTags((prev) => Array.from(new Set([...prev, ...groupTags])));
  };

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

  const tagLine = tags.length ? `\n\n${tags.join(" ")}` : "";
  const utm = linkUrl.trim() ? buildUtm(linkUrl.trim(), targets[0] ?? "instagram", tags) : "";

  const persistMeta = (id: string) => {
    setPostMeta(id, {
      tags: tags.length ? tags : undefined,
      utm: utm || undefined,
      altText: altText.trim() || undefined,
      reminder: reminder || undefined,
    });
  };

  const confirmSchedule = () => {
    setPending(true);
    window.setTimeout(() => {
      setPending(false);
      setConfirmOpen(false);
      setScheduled(true);
      // 判定「已存在→就地更新」查 store live(含运行时新建帖),不再只认静态种子 —— 否则
      // 打开一条运行时帖再保存会当新帖处理、变重复帖。命中则沿用同 id → schedulePost 就地更新。
      const existing = prefillPostId && scheduledPosts().some((p) => p.id === prefillPostId);
      const id = existing ? prefillPostId! : `post-live-${Date.now()}`;
      // 编辑既有帖:以源帖为底,只覆盖表单里编辑过的字段 —— campaignId / crossPostIds 等
      // 上下文保留;媒体未换则沿用原图,不再回落兜底图。
      const source = existing && prefillSource.current?.id === prefillPostId ? prefillSource.current : null;
      schedulePost({
        ...(source ?? {}),
        id,
        scheduledAt: `${date}T${time}:00+08:00`,
        platform: targets[0],
        caption: caption.trim() + tagLine,
        media: media?.thumb ?? source?.media ?? nsImage("bakery", 3),
        status: "scheduled",
        firstComment: firstComment.trim() || undefined,
        altText: altText.trim() || undefined,
      });
      persistMeta(id);
    }, 800);
  };

  const onSaveDraft = () => {
    if (targets.length === 0) {
      setFormError("Pick at least one channel to save this draft for.");
      return;
    }
    const existing = prefillPostId && scheduledPosts().some((p) => p.id === prefillPostId);
    const id = existing ? prefillPostId! : `post-draft-${Date.now()}`;
    // 同 confirmSchedule:编辑既有帖时以源帖为底,保留 campaignId / 原 media 等上下文。
    const source = existing && prefillSource.current?.id === prefillPostId ? prefillSource.current : null;
    saveDraft({
      ...(source ?? {}),
      id,
      scheduledAt: `${date}T${time}:00+08:00`,
      platform: targets[0],
      caption: caption.trim() + tagLine,
      media: media?.thumb ?? source?.media ?? nsImage("bakery", 3),
      status: "draft",
      firstComment: firstComment.trim() || undefined,
      altText: altText.trim() || undefined,
    });
    persistMeta(id);
    toast(reminder ? "Draft saved · publish by reminder" : "Draft saved", {
      description: "Find it in the queue under Drafts.",
    });
  };

  const resetForm = () => {
    setScheduled(false);
    setCaption("");
    setCaptionError(null);
    setFormError(null);
    setMedia(null);
    setFirstComment("");
    setAltText("");
    setTags([]);
    setLinkUrl("");
    setReminder(false);
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
  const activeRatio = RATIOS.find((r) => r.key === ratio) ?? RATIOS[0];

  // 受众解析
  const segmentAudience = ((): { name: string; members: NsContact[] } | null => {
    if (!segmentId || audienceDismissed) return null;
    const all = contactsView();
    const custom = customSegments().find((s) => s.id === segmentId);
    if (custom) return { name: custom.name, members: all.filter((c) => contactMatchesRules(c, custom.rules)) };
    const builtIn = ALL_SEGMENTS.find((s) => s.id === segmentId);
    if (builtIn) return { name: builtIn.name, members: all.filter(builtIn.match) };
    return null;
  })();
  const audienceReach = segmentAudience ? segmentAudience.members.filter((c) => !c.doNotDisturb) : [];
  const audienceDnd = segmentAudience ? segmentAudience.members.filter((c) => c.doNotDisturb) : [];

  const cGroups = channelGroups();
  const hGroups = hashtagGroups();
  // 按内容类型给窗口(而非平台均值);冷启动行业默认,理由挂 KL bakery 口径。
  const recommended = bestTimesForType(postType);

  // 建议 chip 带「日」一起落——点「Sat 9am」同时 set 日期 + 时间(修 EFFECTIVENESS #176:
  // 旧 chip 只 setTime 丢 day,把对的建议半应用成错的结果)。日期取 ≥ 今天的最近一个该星期几。
  const applyBestTime = (b: { day: number; time: string }) => {
    const cur = dowMon(NS_TODAY);
    const nextDate = addDaysIso(NS_TODAY, (b.day - cur + 7) % 7);
    setDate(nextDate);
    if (TIMES.includes(b.time)) setTime(b.time);
  };

  // §O7 caption Otto-assist:意图产出的草稿回填 caption(只填字段,发/花仍要店主点)。
  const onCaptionApply = (apply: NsAssistApply) => {
    const next = apply.patch.caption;
    if (typeof next === "string") {
      setCaption(next);
      setCaptionError(null);
      captionSweep.fire();
    }
  };

  // [wave-c] caption 意图跟随所选 postType:主起草 chip = 该内容类型的草稿,
  // 再加一颗通用「Caption this photo」(随 media 变辞)。修 postType 只驱动 best-time 的不连贯。
  const draft = CAPTION_DRAFTS[postType];
  const captionIntents: NsAssistIntent[] = [
    {
      id: `cap-${postType}`,
      label: draft.label,
      prompt: draft.prompt,
      reply: draft.reply,
      apply: { summary: draft.summary, patch: { caption: draft.caption } },
    },
    {
      id: "cap-caption-photo",
      label: "Caption this photo",
      prompt: "Write a caption that matches the photo I've attached.",
      reply: media
        ? "Based on the visual you picked, here's a caption you can trim to taste:"
        : "Pick a photo first and I'll match the caption to it. Here's a general one meanwhile:",
      apply: {
        summary: "Fill the caption to match the photo",
        patch: { caption: "Made fresh this morning. Tag someone you'd share this with — pre-orders open, link in bio." },
      },
    },
  ];

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 pt-6 pb-16">
      <PageHeader title="New post" subtitle="Write once, tune per platform, pick a time." actions={<ViewSwitch />} />

      {targets.length === 0 && (
        <EmptyState
          icon={ImageIcon}
          title="No channels connected"
          body="Connect Instagram or X in Connections to start posting."
          action={
            <Button variant="secondary" size="sm" asChild>
              <Link href={`${BASE}/account/connections`}>Open Connections</Link>
            </Button>
          }
          className="mt-6"
        />
      )}

      {scheduled && (
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
              <Link href={`${BASE}/schedule/queue`}>View queue</Link>
            </Button>
            <Button variant="ghost" size="sm" onClick={resetForm}>New post</Button>
          </div>
        </div>
      )}

      {!scheduled && (
        <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex min-w-0 flex-col gap-5">
            {segmentAudience && (
              <div className="flex flex-col gap-3 rounded-[14px] border border-border bg-secondary/40 p-4">
                <div className="flex items-center gap-2">
                  <Users className="size-4 text-muted-foreground" strokeWidth={2} />
                  <span className="text-[13px] font-semibold text-foreground">Audience</span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-card px-2.5 py-1 text-xs font-semibold text-foreground ring-1 ring-border">
                    {segmentAudience.name}
                    <button type="button" onClick={() => setAudienceDismissed(true)} aria-label="Clear audience" className="text-muted-foreground hover:text-foreground">
                      <XIcon className="size-3" strokeWidth={2.5} />
                    </button>
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">{audienceReach.length} will get this</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {segmentAudience.members.map((c) => (
                    <span
                      key={c.id}
                      title={c.doNotDisturb ? `${c.name} is on do not disturb — left out` : c.name}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium",
                        c.doNotDisturb ? "border-dashed border-border text-muted-foreground line-through opacity-60" : "border-border bg-card text-foreground",
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

            {/* 账号选择 + [wave-b] Channel Groups */}
            <Field
              label="Channels"
              help="Pick every account this post goes to."
              error={formError}
              action={<ChannelGroupPicker groups={cGroups} targets={targets} onApply={applyChannelGroup} />}
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
                        on ? "border-foreground bg-secondary text-foreground" : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
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

            {/* 主文案 —— [wave-c] 挂一颗 Otto 帮我(§O7:带 zone+当前表单快照,意图 chip 零打字起草) */}
            <Field
              label="Caption"
              error={captionError}
              action={
                <OttoAssist
                  zone="Schedule"
                  entityLabel="New post"
                  formState={{ hasMedia: !!media, channels: targets, postType }}
                  intents={captionIntents}
                  onApply={onCaptionApply}
                />
              }
            >
              <div style={captionSweep.style} className="rounded-[14px]">
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
              </div>
            </Field>

            {/* [wave-b] Hashtag 组 + 标签 */}
            <Field label="Hashtags & tags" optional help="Insert a saved group, or add your own. Tags help you track this post later.">
              <div className="flex flex-wrap items-center gap-1.5">
                {hGroups.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => insertHashtagGroup(g.tags)}
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-accent"
                    title={g.tags.join(" ")}
                  >
                    <Hash className="size-3" strokeWidth={2} />
                    {g.name}
                  </button>
                ))}
                <SaveHashtagGroup currentTags={tags} />
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {tags.map((t) => (
                  <span key={t} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">
                    {t}
                    <button type="button" onClick={() => setTags((prev) => prev.filter((x) => x !== t))} aria-label={`Remove ${t}`}>
                      <XIcon className="size-2.5" strokeWidth={2.5} />
                    </button>
                  </span>
                ))}
                <input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault();
                      addTag(tagInput);
                    }
                  }}
                  placeholder="Add tag…"
                  className="h-7 min-w-24 flex-1 rounded-full border border-dashed border-border bg-transparent px-2.5 text-[11px] outline-none placeholder:text-muted-foreground"
                />
              </div>
            </Field>

            {/* 媒体:选现有成片 + [wave-b] 换尺寸 + 九宫格连续性 */}
            <Field
              label="Media"
              help="Pick a finished visual from My Stuff."
              optional
              action={
                media ? (
                  <button type="button" onClick={() => setGridOpen(true)} className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
                    <Grid3x3 className="size-3.5" strokeWidth={2} />
                    Check IG grid
                  </button>
                ) : null
              }
            >
              {media ? (
                <div className="flex flex-col gap-3 rounded-[14px] border border-border bg-card p-3">
                  <div className="flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={media.thumb} alt={altText} className={cn("w-16 shrink-0 rounded-[10px] border border-border object-cover", activeRatio.cls)} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">{media.title}</p>
                      <p className="text-xs text-muted-foreground">{media.kind} · made {media.createdAt}</p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setPickerOpen(true)}>Replace</Button>
                    <Button variant="ghost" size="sm" className="size-8 px-0" aria-label="Remove media" onClick={() => setMedia(null)}>
                      <XIcon strokeWidth={2} />
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-medium text-muted-foreground">Crop for</span>
                    {RATIOS.map((r) => (
                      <button
                        key={r.key}
                        type="button"
                        onClick={() => setRatio(r.key)}
                        className={cn(
                          "rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
                          ratio === r.key ? "border-foreground bg-secondary text-foreground" : "border-border text-muted-foreground hover:bg-accent",
                        )}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
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

            {/* [wave-b] Alt text(无障碍图片描述) */}
            {media && (
              <Field label="Alt text" optional help="Describe the image for screen readers and low-bandwidth viewers.">
                <Input value={altText} onChange={(e) => setAltText(e.target.value)} placeholder="Golden kaya butter croissants on a tray" />
              </Field>
            )}

            {/* [wave-b] 内容标签链接 + UTM 追踪 */}
            <Field label="Link" optional help="A link in the post — we auto-add UTM tags so you can see what it drove.">
              <Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="rotibulan.my/order" />
              {utm && (
                <p className="flex items-center gap-1.5 font-mono text-[11px] leading-4 text-muted-foreground">
                  <Link2 className="size-3 shrink-0" strokeWidth={2} />
                  {utm}
                </p>
              )}
            </Field>

            {/* 断链检查 */}
            {linkReport.issues.length > 0 && (
              <div className="flex flex-col gap-1 rounded-[14px] border border-warning-soft-foreground/30 bg-warning-soft/50 p-3">
                <span className="text-[13px] font-semibold text-warning-soft-foreground">Check these links before you post</span>
                {linkReport.issues.map((iss, i) => (
                  <p key={i} className="font-mono text-[11px] leading-4 text-warning-soft-foreground">
                    {iss.url} — {iss.problem}
                  </p>
                ))}
              </div>
            )}

            {/* 定时 + 时区 + [wave-b] 最佳时间建议 */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date">
                <Input type="date" value={date} min="2026-07-07" max="2026-08-31" onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field label="Time" help="Times are in Asia/Kuala_Lumpur (UTC+8).">
                <Select value={time} onValueChange={setTime}>
                  <SelectTrigger className="h-11 w-full rounded-[14px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TIMES.map((t) => (
                      <SelectItem key={t} value={t}>{fmtTime(t)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            {/* [wave-c] 按内容类型分时段 + 冷启动诚实标注(§O7 姊妹:best-time 不装聪明) */}
            <div className="flex flex-col gap-2 rounded-[14px] border border-border bg-card p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-foreground">
                  <Sparkles className="size-3.5" strokeWidth={2} />
                  Best time to post
                </span>
                <span className="text-[11px] text-muted-foreground">What kind of post is this?</span>
              </div>
              {/* 内容类型选择(人手可动 → 选中态走蓝声部 §2) */}
              <div className="flex flex-wrap gap-1.5">
                {POST_TYPES.map((pt) => {
                  const on = postType === pt.id;
                  return (
                    <button
                      key={pt.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setPostType(pt.id)}
                      title={pt.hint}
                      className={cn(
                        "ns-pressable rounded-full px-3 py-1 text-[12px] font-medium",
                        on ? "ns-human-soft" : "bg-card text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {pt.label}
                    </button>
                  );
                })}
              </div>
              {/* 该类型的推荐窗口:chip 带「日」,点一下同时 set 日期 + 时间 */}
              <div className="flex flex-wrap items-center gap-1.5">
                {recommended.map((b) => {
                  const active = dowMon(date) === b.day && time === b.time;
                  return (
                    <button
                      key={`${b.day}-${b.time}`}
                      type="button"
                      onClick={() => applyBestTime(b)}
                      title={b.reason}
                      className={cn(
                        "ns-pressable rounded-full px-2.5 py-1 text-[11px] font-medium tabular-nums",
                        active ? "ns-human-soft" : "bg-card text-foreground",
                      )}
                    >
                      {DOW_MON[b.day]} {fmtTime(b.time)}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] leading-4 text-muted-foreground">
                Industry default for KL bakeries — not tuned to you yet. Otto learns your own best times once your post
                analytics go live.
              </p>
            </div>

            {/* first comment */}
            <Field label="First comment" help="Instagram only. Posts right after the main post." optional>
              <Input value={firstComment} onChange={(e) => setFirstComment(e.target.value)} placeholder="Pre-order closes Friday 6pm!" />
            </Field>

            {/* [wave-b] 提醒式发布降级 */}
            <label className="flex items-start gap-3 rounded-[14px] border border-border bg-card p-4">
              <input type="checkbox" checked={reminder} onChange={(e) => setReminder(e.target.checked)} className="mt-0.5 size-4 accent-[var(--brand)]" />
              <span className="min-w-0">
                <span className="text-[13px] font-semibold text-foreground">Publish by reminder</span>
                <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
                  For IG personal accounts or channels still in review — we ping you at post time with everything ready to copy-paste.
                </span>
              </span>
            </label>

            {/* 逐平台定制(PostVariant) */}
            {targets.length > 0 && (
              <div className="flex flex-col gap-3">
                <span className="text-[13px] leading-[18px] font-semibold text-foreground">Customize per platform</span>
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
                          active ? "bg-card font-semibold text-foreground shadow-[var(--shadow-sm)]" : "font-medium text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {PLATFORMS[p].label}
                      </button>
                    );
                  })}
                </div>
                <div className="flex flex-col gap-2 rounded-[14px] border border-border bg-card p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-muted-foreground">{PLATFORMS[activeTab].label} caption override</span>
                    {activeTab === "x" && xLen > X_LIMIT * 0.8 && (
                      <span className={cn("font-mono text-[11px] leading-[14px] font-medium tabular-nums", xLen > X_LIMIT ? "text-error-soft-foreground" : "text-muted-foreground")}>
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
                    <p className="text-xs leading-4 text-muted-foreground">First comment posts here: “{firstComment}”</p>
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
              <Button variant="secondary" size="sm" onClick={onSaveDraft}>Save draft</Button>
              <Button size="sm" onClick={onSchedule}>{xCost > 0 ? `Schedule post · ${costLabel}` : "Schedule post"}</Button>
            </div>
          </div>

          {/* 逐平台预览(右栏,当前 tab) */}
          <aside className="hidden lg:block">
            <div className="sticky top-6 flex flex-col gap-2 rounded-[18px] border border-border bg-card p-4">
              <div className="flex items-center gap-2">
                <PlatformTag platform={activeTab} />
                <span className="text-[13px] font-semibold text-foreground">{PLATFORMS[activeTab].handle}</span>
              </div>
              {media ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={media.thumb} alt={altText} className={cn("w-full rounded-[10px] border border-border object-cover", activeRatio.cls)} />
              ) : (
                <div className={cn("flex w-full items-center justify-center rounded-[10px] border border-dashed border-border text-xs text-muted-foreground", activeRatio.cls)}>
                  No media yet
                </div>
              )}
              <p className={cn("whitespace-pre-wrap text-[13px] leading-[18px]", previewCaption ? "text-foreground" : "text-muted-foreground")}>
                {previewCaption ? previewCaption + tagLine : "Your caption will appear here."}
              </p>
              {activeTab === "instagram" && firstComment.trim() !== "" && (
                <p className="border-t border-border pt-2 text-xs leading-4 text-muted-foreground">{firstComment}</p>
              )}
              <p className="text-xs text-muted-foreground">Scheduled · {fmtDateLong(date)} · {fmtTime(time)}</p>
            </div>
          </aside>
        </div>
      )}

      {/* 媒体选择器 */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-[min(720px,calc(100vw-2rem))]">
          <DialogHeader>
            <DialogTitle className="text-xl leading-[26px] font-semibold tracking-[-0.017em]">Choose media</DialogTitle>
            <DialogDescription>Finished visuals from My Stuff. Generating ones show up when they are ready.</DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[50vh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
            {NS_ASSETS.filter((a) => a.status === "ready" && (a.kind === "image" || a.kind === "video")).map((a) => (
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

      {/* [wave-b] IG 九宫格预览 + 相邻连续性校验 */}
      <GridPreviewDialog open={gridOpen} onClose={() => setGridOpen(false)} media={media} />

      {/* 定时确认 */}
      <Dialog open={confirmOpen} onOpenChange={(open) => !open && !pending && setConfirmOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule this post?</DialogTitle>
            <DialogDescription>{fmtDateLong(date)} · {fmtTime(time)} · Asia/Kuala_Lumpur</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 rounded-[14px] bg-secondary/70 p-3 text-[13px] leading-[18px] text-foreground">
            <span>Goes to {targets.map((t) => PLATFORMS[t].label).join(", ")}.</span>
            {reminder && <span>You’ll get a reminder to post it manually — nothing publishes automatically.</span>}
            {xCost > 0 ? (
              <span>The X post uses <span className="font-semibold">{costLabel}</span> when it publishes. No charge until then.</span>
            ) : (
              <span>No credits are used for this post.</span>
            )}
          </div>
          <DialogFooter className="flex-row justify-end gap-3">
            <Button variant="secondary" size="sm" disabled={pending} onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button size="sm" disabled={pending} onClick={confirmSchedule}>
              {pending ? "Scheduling…" : xCost > 0 ? `Schedule · ${costLabel}` : "Schedule post"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ── [wave-b] Channel Groups:常用频道组合一键选 + 存组 ─────────────────────── */
function ChannelGroupPicker({
  groups,
  targets,
  onApply,
}: {
  groups: ReturnType<typeof channelGroups>;
  targets: NsPlatform[];
  onApply: (channels: NsPlatform[]) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-xs font-medium text-muted-foreground hover:text-foreground">
        Channel groups
      </button>
      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Channel groups</DialogTitle>
            <DialogDescription>Save the combos you post to often, then pick them in one tap.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1 rounded-[14px] border border-border">
            {groups.length === 0 ? (
              <p className="px-3 py-4 text-center text-[13px] text-muted-foreground">No groups yet.</p>
            ) : (
              groups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => {
                    onApply(g.channels);
                    setOpen(false);
                  }}
                  className="flex items-center gap-2 border-t border-border px-3 py-2.5 text-left first:border-t-0 hover:bg-accent"
                >
                  <span className="text-[13px] font-semibold text-foreground">{g.name}</span>
                  <span className="ml-auto flex items-center gap-1">
                    {g.channels.map((c) => (
                      <PlatformTag key={c} platform={c} className="h-4 w-6 text-[9px]" />
                    ))}
                  </span>
                </button>
              ))
            )}
          </div>
          <div className="flex items-center gap-2">
            <Input placeholder="Name this current selection" value={name} onChange={(e) => setName(e.target.value)} />
            <Button
              size="sm"
              disabled={!name.trim() || targets.length === 0}
              onClick={() => {
                addChannelGroup(name.trim(), targets);
                setName("");
              }}
            >
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ── [wave-b] 存 hashtag 组 ───────────────────────────────────────────────── */
function SaveHashtagGroup({ currentTags }: { currentTags: string[] }) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={currentTags.length === 0}
        className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent disabled:opacity-40"
      >
        <Hash className="size-3" strokeWidth={2} />
        Save group
      </button>
      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save hashtag group</DialogTitle>
            <DialogDescription>{currentTags.join(" ") || "Add some tags first."}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input placeholder="Group name" value={name} onChange={(e) => setName(e.target.value)} />
            <Button
              size="sm"
              disabled={!name.trim() || currentTags.length === 0}
              onClick={() => {
                addHashtagGroup(name.trim(), currentTags);
                setName("");
                setOpen(false);
                toast("Hashtag group saved");
              }}
            >
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ── [wave-b] IG 九宫格预览 + 相邻连续性校验 ──────────────────────────────── */
function GridPreviewDialog({ open, onClose, media }: { open: boolean; onClose: () => void; media: NsAsset | null }) {
  // 拿最近 8 张已发 IG 帖 + 这条待发帖模拟九宫格排列
  const recentIg = livePosts()
    .filter((p) => p.platform === "instagram" && p.status === "published")
    .slice(0, 8)
    .map((p) => p.media);
  const grid = [media?.thumb ?? nsImage("bakery", 3), ...recentIg].slice(0, 9);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Instagram grid preview</DialogTitle>
          <DialogDescription>How your profile looks once this post lands, top-left. Check it sits well with the row.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-0.5 overflow-hidden rounded-[14px] border border-border">
          {grid.map((src, i) => (
            <div key={i} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="aspect-square w-full object-cover" />
              {i === 0 && (
                <span className="absolute left-1 top-1 rounded-full bg-foreground px-1.5 py-0.5 text-[9px] font-semibold text-background">New</span>
              )}
            </div>
          ))}
        </div>
        <DialogFooter className="flex-row justify-end">
          <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
