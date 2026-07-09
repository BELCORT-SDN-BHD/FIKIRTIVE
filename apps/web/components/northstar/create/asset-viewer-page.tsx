"use client";

/**
 * 全屏资产查看器(生成详情)— GOAL G1;g2a detail panel spec
 * 三栏:左 = 版本 / 帧轨;中 = 大播放器;右 = Download / Share(经审批闸)。
 * 底部:Type to imagine 续写框 + 芯片(6s/10s、480p/720p、再生成)。
 */

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowUp,
  Download,
  Lock,
  Pause,
  Play,
  Repeat,
  Volume2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSearchParams } from "next/navigation";
import { useInsideImmersive } from "../immersive/_context";
import { FolderPlus } from "lucide-react";
import {
  brandPreferences,
  canvasObjectById,
  ottoWorking as setOttoWorking,
  promoteToCampaign,
  promotedCampaignsOf,
  setBrandPreference,
  spendCredits,
  useStore,
} from "../immersive/_store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MockNote, OttoNarrationBar } from "../_shared";
import { NS_ASSETS, NS_CAMPAIGNS } from "../_mock";
import { cvImage, CV_ALL_SEED_OBJECTS, NS_VIEWER_ASSET, NS_VIEWER_FRAMES, NS_VIEWER_VERSIONS, type NsViewerVersion } from "./_fixtures";
import {
  DemoStateBar,
  ErrorPanel,
  FeedbackControls,
  LAND_STYLE,
  SectionLabel,
  Skeleton,
  SWEEP_STYLE,
  useCreateKeyframes,
  type DemoState,
  type FeedbackValue,
} from "./_create-ui";

/** [wave-b] Add to campaign — D1 升格目标(ACTIVE / DRAFT)。 */
const VIEWER_PROMOTE_TARGETS = NS_CAMPAIGNS.filter((c) => c.status !== "DONE");

export function AssetViewerPage() {
  useCreateKeyframes();
  useStore();
  const insideImmersive = useInsideImmersive();
  // 深链 ?asset=<id> → 展示那个画布对象;缺省回到示意资产(GOAL §4)
  // [cx-canvas-runtime] 断层 3/5:?asset= 必须走 useSearchParams(reactive)而非 window.location
  // 快照 —— App Router 客户端跳转在 URL commit 前就渲染目标页,窗口快照读到的是上一页(null),
  // 深链的 id 永远丢。useSearchParams 反映当前路由的 query,贴附工具条 client-nav 过来才拿得到 id。
  const assetId = useSearchParams().get("asset");
  // [cx-canvas-runtime] 断层 3/5 ①:深链解析顺序 = store 运行时注册表 → 画布种子 → 世界圣经资产
  // (Library / My stuff 真图)→ 兜底示意资产。运行时对象(画布刚生成/复制的)只活在 store 注册表,
  // 必须第一顺位命中,否则 Full screen 打开的是 fallback 样例而不是用户刚点的那张。
  const runtime = canvasObjectById(assetId);
  const linked = React.useMemo(
    () => (runtime ? null : CV_ALL_SEED_OBJECTS.find((o) => o.id === assetId) ?? null),
    [runtime, assetId],
  );
  const linkedAsset = React.useMemo(
    () => (runtime || linked ? null : NS_ASSETS.find((a) => a.id === assetId) ?? null),
    [runtime, linked, assetId],
  );
  const view = {
    id: runtime?.id ?? linked?.id ?? linkedAsset?.id ?? NS_VIEWER_ASSET.id,
    title: runtime?.title ?? linked?.title ?? linkedAsset?.title ?? NS_VIEWER_ASSET.title,
    poster: runtime?.posterUrl ?? runtime?.imageUrl ?? linked?.src ?? linkedAsset?.thumb ?? NS_VIEWER_ASSET.poster,
    prompt: runtime?.prompt ?? linked?.prompt ?? linkedAsset?.prompt ?? NS_VIEWER_ASSET.prompt,
    kind: (runtime?.kind ?? linked?.kind ?? (linkedAsset?.kind === "video" ? "video" : linkedAsset ? "image" : NS_VIEWER_ASSET.kind)) as "image" | "video",
    duration: runtime?.duration ?? linked?.duration ?? NS_VIEWER_ASSET.duration,
    credits: runtime?.credits ?? linked?.credits ?? linkedAsset?.credits ?? NS_VIEWER_ASSET.credits,
    resolution: NS_VIEWER_ASSET.resolution,
  };
  const [versions, setVersions] = React.useState<NsViewerVersion[]>(NS_VIEWER_VERSIONS);
  const [activeVersion, setActiveVersion] = React.useState<string>(NS_VIEWER_VERSIONS[0].id);
  const [playing, setPlaying] = React.useState(false);
  const [duration, setDuration] = React.useState<"6s" | "10s">("6s");
  const [res, setRes] = React.useState<"480p" | "720p">("720p");
  const [text, setText] = React.useState("");
  const [working, setWorking] = React.useState(false);
  const [sweepId, setSweepId] = React.useState<string | null>(null);
  const [demo, setDemo] = React.useState<DemoState>("live");
  const [promoteOpen, setPromoteOpen] = React.useState(false); // [wave-b] Add to campaign

  const timersRef = React.useRef<number[]>([]);
  React.useEffect(() => () => timersRef.current.forEach((t) => window.clearTimeout(t)), []);

  const active = versions.find((v) => v.id === activeVersion) ?? versions[0];

  // 连接器 O-04:赞/踩状态从共享 store 派生(回来仍记得),onChange 回灌 brand-memory。
  const pref = brandPreferences().find((p) => p.assetTitle === view.title && p.source === "Asset viewer");
  const feedback: FeedbackValue = pref ? (pref.feedback === "like" ? "up" : "down") : null;
  const rate = (v: FeedbackValue) =>
    setBrandPreference({
      assetId: view.id,
      assetTitle: view.title,
      source: "Asset viewer",
      feedback: v === "up" ? "like" : v === "down" ? "dislike" : null,
    });

  const continueWrite = (note: string) => {
    if (working) return;
    setWorking(true);
    setOttoWorking(true, "Generating the next version…"); // dock 徽点脉冲
    const t = window.setTimeout(() => {
      const n = versions.length + 1;
      const nv: NsViewerVersion = {
        id: `vv-${n}`,
        label: `v${n} · current`,
        thumb: cvImage(view.kind, n + 2),
        note: note.slice(0, 42) || "Continued take",
        current: true,
      };
      setVersions((prev) => [nv, ...prev.map((v) => ({ ...v, current: false, label: v.label.replace(" · current", "") }))]);
      setActiveVersion(nv.id);
      setSweepId(nv.id);
      window.setTimeout(() => setSweepId(null), 650);
      // 新版本出炉即入账(共享 store;余额即时刷新 = live reflection)
      spendCredits(view.credits, `New version · ${view.title}`, view.kind === "video" ? "Video" : "Image");
      setWorking(false);
      setOttoWorking(false);
    }, 4200);
    timersRef.current.push(t);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 顶条:返回 + 资产名 + 状态(§N5 单层返回) */}
      <div className="flex h-[52px] shrink-0 items-center gap-3 border-b border-border px-4">
        <Link
          href="/northstar/create/canvas"
          className="flex h-8 items-center gap-1.5 rounded-[10px] px-2 text-[13px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="size-4" strokeWidth={2} />
          Canvas
        </Link>
        <span className="truncate text-sm font-semibold text-foreground">{view.title}</span>
        {!insideImmersive && (
          <Badge variant="outline" className="hidden text-muted-foreground sm:inline-flex">
            ?asset={view.id}
          </Badge>
        )}
        <div className="flex-1" />
        <DemoStateBar state={demo} onChange={setDemo} />
      </div>

      {demo === "error" ? (
        <div className="mx-auto w-full max-w-[560px] px-6 pt-10">
          <ErrorPanel
            what="Couldn't load this asset."
            money="You weren't charged."
            onRetry={() => setDemo("live")}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* 左:版本 / 帧轨 */}
          <aside className="flex w-56 shrink-0 flex-col gap-4 overflow-y-auto border-r border-border p-4">
            <div>
              <SectionLabel>Versions</SectionLabel>
              <div className="mt-2 flex flex-col gap-2">
                {demo === "loading"
                  ? [0, 1, 2].map((i) => <Skeleton key={i} shimmer={i === 0} className="h-24 w-full rounded-[14px]" />)
                  : versions.map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => setActiveVersion(v.id)}
                        className={cn(
                          "overflow-hidden rounded-[14px] border text-left transition-colors duration-[120ms]",
                          activeVersion === v.id ? "border-foreground" : "border-border hover:bg-accent",
                        )}
                        style={sweepId === v.id ? SWEEP_STYLE : undefined}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={v.thumb} alt={v.label} className="aspect-video w-full object-cover" />
                        <div className="p-2">
                          <p className="text-xs font-semibold text-foreground">{v.label}</p>
                          <p className="truncate text-[11px] text-muted-foreground">{v.note}</p>
                        </div>
                      </button>
                    ))}
              </div>
            </div>
            <div>
              <SectionLabel>Frames</SectionLabel>
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                {demo === "loading"
                  ? [0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} shimmer={false} className="aspect-video w-full rounded-md" />)
                  : NS_VIEWER_FRAMES.map((f) => (
                      <button key={f.id} type="button" className="group relative overflow-hidden rounded-md border border-border">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={f.thumb} alt={`Frame at ${f.at}`} className="w-full object-cover" />
                        <span className="absolute right-0.5 bottom-0.5 rounded-sm bg-primary/75 px-1 font-mono text-[9px] leading-3 text-primary-foreground tabular-nums">
                          {f.at}
                        </span>
                      </button>
                    ))}
              </div>
            </div>
          </aside>

          {/* 中:大播放器 + 底部续写 */}
          <section className="flex min-w-0 flex-1 flex-col">
            <div className="relative flex min-h-0 flex-1 items-center justify-center p-6">
              {demo === "loading" ? (
                <Skeleton className="aspect-video w-full max-w-[840px] rounded-[18px]" />
              ) : (
                <div className="relative w-full max-w-[840px] overflow-hidden rounded-[18px] border border-border bg-card" style={LAND_STYLE}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={view.poster} alt={view.title} className="aspect-video w-full object-cover" />
                  <span className="absolute top-3 left-3 rounded-full bg-primary/75 px-2 py-0.5 font-mono text-[10px] leading-4 font-medium text-primary-foreground">
                    {active.label}
                  </span>
                  <div className="absolute inset-x-4 bottom-4 flex items-center gap-3 rounded-[14px] bg-primary/75 px-4 py-2.5">
                    <button type="button" aria-label={playing ? "Pause" : "Play"} onClick={() => setPlaying((p) => !p)} className="text-primary-foreground">
                      {playing ? <Pause className="size-5" strokeWidth={2} /> : <Play className="size-5" strokeWidth={2} />}
                    </button>
                    <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-primary-foreground/30">
                      <span className={cn("block h-full rounded-full bg-primary-foreground transition-all duration-[200ms]", playing ? "w-3/4" : "w-1/4")} />
                    </span>
                    <span className="font-mono text-[11px] leading-[14px] text-primary-foreground tabular-nums">
                      {playing ? "4.5s" : "1.5s"} / {view.duration}s
                    </span>
                    <Volume2 className="size-4 text-primary-foreground" strokeWidth={2} />
                    <Repeat className="size-4 text-primary-foreground/70" strokeWidth={2} />
                    <span className="rounded-sm border border-primary-foreground/50 px-1 font-mono text-[10px] leading-4 text-primary-foreground">HD</span>
                  </div>
                </div>
              )}
              {working && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2">
                  <OttoNarrationBar steps={["Reading the current take…", "Generating the next version…"]} stepMs={2000} />
                </div>
              )}
            </div>

            {/* 底部:Type to imagine + 芯片(G1) */}
            <div className="shrink-0 border-t border-border p-4">
              <form
                className="mx-auto flex max-w-[840px] items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  continueWrite(text);
                  setText("");
                }}
              >
                <div className="flex min-w-0 flex-1 items-center gap-2 rounded-[14px] border border-input bg-card px-2 py-1.5 shadow-[var(--shadow-xs)] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/40">
                  <input
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Type to imagine what happens next…"
                    className="h-9 min-w-0 flex-1 bg-transparent px-2 text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
                  />
                  {(["6s", "10s"] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={duration === d}
                      onClick={() => setDuration(d)}
                      className={cn(
                        "h-7 rounded-full border px-2.5 text-xs font-semibold",
                        duration === d ? "border-transparent bg-secondary text-foreground" : "border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {d}
                    </button>
                  ))}
                  {(["480p", "720p"] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      aria-pressed={res === r}
                      onClick={() => setRes(r)}
                      className={cn(
                        "h-7 rounded-full border px-2.5 text-xs font-semibold",
                        res === r ? "border-transparent bg-secondary text-foreground" : "border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {r}
                    </button>
                  ))}
                  <Button type="submit" size="icon" className="size-9 rounded-[10px]" aria-label="Continue this video" disabled={working}>
                    <ArrowUp className="size-4" strokeWidth={2.2} />
                  </Button>
                </div>
                <Button type="button" variant="secondary" size="sm" className="h-9" disabled={working} onClick={() => continueWrite("Regenerated take")}>
                  {working ? "Regenerating…" : `Regenerate · ${view.credits} credits`}
                </Button>
              </form>
              <p className="mx-auto mt-1.5 max-w-[840px] text-[11px] text-muted-foreground">
                Continue writes a new version from this take · {duration} · {res}. Video generation asks before it spends.
              </p>
            </div>
          </section>

          {/* 右:Download / Share(审批闸)+ 资产信息 */}
          <aside className="flex w-64 shrink-0 flex-col gap-4 overflow-y-auto border-l border-border p-4">
            <div className="flex flex-col gap-2">
              <Button className="w-full">
                <Download className="size-4" strokeWidth={2} />
                Download
              </Button>
              <Button variant="secondary" className="w-full" disabled>
                <Lock className="size-4" strokeWidth={2} />
                Share
              </Button>
              <p className="text-[11px] leading-4 text-muted-foreground">
                Share goes through the approval gate and posts to your connected channels. This phase is download only.
              </p>
            </div>
            <div className="rounded-[14px] border border-border bg-card p-4">
              <SectionLabel>Details</SectionLabel>
              <dl className="mt-2 space-y-2">
                {[
                  ["Kind", view.kind === "image" ? "Image" : "Video"],
                  ["Duration", `${view.duration}s`],
                  ["Resolution", view.resolution],
                  ["Cost", `${view.credits} credits`],
                  ["Versions", String(versions.length)],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-2">
                    <dt className="text-xs text-muted-foreground">{k}</dt>
                    <dd className="font-mono text-[11px] leading-[14px] font-medium text-foreground tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="rounded-[14px] border border-border bg-card p-4">
              <SectionLabel>Prompt</SectionLabel>
              <p className="mt-2 text-[13px] leading-[18px] text-foreground">{view.prompt}</p>
            </div>
            {/* [wave-b] Add to campaign — D1 升格:把这个 take 挂进某 campaign($0,仍留在 Studio) */}
            <div className="rounded-[14px] border border-border bg-card p-4">
              <SectionLabel>Add to campaign</SectionLabel>
              {promotedCampaignsOf(view.id).length > 0 && (
                <p className="mt-2 flex items-center gap-1.5 text-[12px] font-medium text-foreground">
                  <FolderPlus className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
                  In {promotedCampaignsOf(view.id).join(", ")}
                </p>
              )}
              {promoteOpen ? (
                <div className="mt-2 flex flex-col gap-1">
                  {VIEWER_PROMOTE_TARGETS.map((c) => {
                    const already = promotedCampaignsOf(view.id).includes(c.name);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        disabled={already}
                        onClick={() => {
                          promoteToCampaign({
                            assetId: view.id,
                            title: view.title,
                            kind: view.kind,
                            thumb: view.poster,
                            campaignId: c.id,
                            campaignName: c.name,
                          });
                          setPromoteOpen(false);
                        }}
                        className="flex items-center gap-2 rounded-[10px] border border-border px-2 py-2 text-left hover:bg-accent disabled:opacity-60 disabled:hover:bg-transparent"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={c.hero} alt="" className="size-8 shrink-0 rounded-md object-cover" />
                        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">{c.name}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">{c.status === "ACTIVE" ? "In progress" : "Draft"}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <Button variant="secondary" size="sm" className="mt-2 w-full" onClick={() => setPromoteOpen(true)}>
                  <FolderPlus className="size-4" strokeWidth={2} />
                  Add to a campaign
                </Button>
              )}
              <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
                It still lives in your Studio — this just files it under that campaign too. No credits.
              </p>
            </div>
            {/* 连接器 O-04:赞/踩 → Otto 学一条偏好,回灌 Brand memory */}
            <div className="rounded-[14px] border border-border bg-card p-4">
              <SectionLabel>Rate this take</SectionLabel>
              <FeedbackControls className="mt-2" value={feedback} onChange={rate} />
              <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
                Otto remembers this in Brand memory and leans your way next time.
              </p>
            </div>
          </aside>
        </div>
      )}

      <MockNote path="/northstar/create/asset-viewer" />
    </div>
  );
}
