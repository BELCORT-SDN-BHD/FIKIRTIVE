"use client";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { Film, Pencil, Trash2, Plus, ChevronUp, ChevronDown, Loader2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  parseStoryboardCardPayload,
  shotsNeedingMintedFirstFrame,
  MAX_STORYBOARD_SHOTS,
  type StoryboardCardView,
  type StoryboardShotView,
} from "@/lib/storyboard-card";
import { editShotPrompt, addShot, deleteShot, reorderShots, setStoryboardContinuity } from "@/lib/storyboard-actions";
import {
  prepareStoryboardFirstFrames,
  regenShotFirstFrameCard,
  prepareStoryboardVideos,
  regenShotVideoCard,
  getStoryboardVideoOptions,
  syncStoryboardMedia,
  type ChildFrameCard,
} from "@/lib/storyboard-gate1-actions";
import { coworkGenerate } from "@/lib/cowork-actions";
import { creditsLabel } from "@/lib/credit-format";
import { TopUpNotice } from "@/components/exits/Exits";
import { canAffordPack } from "./pack-credit-math";

export interface StoryboardCardProps {
  cardId: string;
  payload: unknown;
  balanceUsd?: number;
  onBalanceRefresh?: () => void;
}

type ActionResult = { payload: unknown } | { error: string };

// Frames land in ~seconds; videos take minutes. Poll faster/short for a frames-only
// wait, slower/long when any video is pending.
const FRAME_SYNC_INTERVAL_MS = 3000;
const FRAME_SYNC_MAX_TRIES = 40;
const VIDEO_SYNC_INTERVAL_MS = 5000;
const VIDEO_SYNC_MAX_TRIES = 120;

/** A shot's FRAME is "pending" once it points at a child card but has no finished image yet. */
function isFramePending(s: StoryboardShotView): boolean {
  return !!s.firstFrameCardId && !s.firstFrameGenerationId;
}

/** A shot's VIDEO is "pending" once it points at a video child but has no finished clip yet. */
function isVideoPending(s: StoryboardShotView): boolean {
  return !!s.videoCardId && !s.videoGenerationId;
}

/** Otto 的分镜卡(F3:可逐帧编辑,$0)+ 闸①(首帧图)+ 闸②(make all videos)。
 *  本地 state 持 payload;编辑动作成功后用返回 payload 更新。闸②:每镜头选时长(model-driven,
 *  editShotPrompt 级联清视频键)→ prepare($0)→ 确认 → 逐子卡 coworkGenerate(花钱)→ 统一 sync
 *  轮询把 frame/video genId 写回 + 取媒体 URL。花钱调用点恰好 4 处,全在显式确认 handler 内。 */
export function StoryboardCard({ cardId, payload, balanceUsd, onBalanceRefresh }: StoryboardCardProps) {
  const [view, setView] = useState<StoryboardCardView>(() => parseStoryboardCardPayload(payload));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draftFf, setDraftFf] = useState("");
  const [draftV, setDraftV] = useState("");

  // Model-driven video duration options ($0 read, fetched once on mount).
  const [videoDurations, setVideoDurations] = useState<number[]>([]);

  // Gate① (frames) state.
  // `children` is the SERVER-returned set from the prepare call made in THIS confirm
  // interaction. The spend loop derives its work list from THIS array only — never a
  // stale render — and it's CLEARED on any edit or payload change (forcing a re-prepare).
  const [children, setChildren] = useState<ChildFrameCard[] | null>(null);
  const [totalCredits, setTotalCredits] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [regenShotId, setRegenShotId] = useState<string | null>(null); // shotId awaiting per-shot frame-regen confirm
  const [regenChild, setRegenChild] = useState<ChildFrameCard | null>(null); // the freshly-minted frame child for that shot

  // Gate② (videos) state — parallel to the frame state above, same single-source-of-truth rules.
  const [videoChildren, setVideoChildren] = useState<ChildFrameCard[] | null>(null);
  const [videoTotalCredits, setVideoTotalCredits] = useState(0);
  const [videoConfirming, setVideoConfirming] = useState(false);
  const [regenVideoShotId, setRegenVideoShotId] = useState<string | null>(null); // shotId awaiting per-shot video-remake confirm
  const [regenVideoChild, setRegenVideoChild] = useState<ChildFrameCard | null>(null); // the freshly-minted video child for that shot

  const [generating, setGenerating] = useState(false); // spend loop OR sync poll running
  const [frames, setFrames] = useState<Record<string, string>>({});
  const [videos, setVideos] = useState<Record<string, string>>({});
  const [polling, setPolling] = useState(false);
  // Shots whose FRAME regen was CONFIRMED (spent) but whose thumbnail hasn't swapped yet.
  const [replacingShotIds, setReplacingShotIds] = useState<Set<string>>(() => new Set());
  // Shots whose VIDEO remake was CONFIRMED (spent) but whose clip hasn't swapped yet.
  const [replacingVideoShotIds, setReplacingVideoShotIds] = useState<Set<string>>(() => new Set());
  // shotId → the genId shown when its regen was confirmed (the OLD media). A sync result with
  // a genId ≠ this baseline means the replacement landed → drop the shot from the set.
  // Refs so the sync loop reads live values without re-subscribing the interval.
  const replacingBaselineRef = useRef<Record<string, string | undefined>>({});
  const replacingShotIdsRef = useRef<Set<string>>(replacingShotIds);
  const replacingVideoBaselineRef = useRef<Record<string, string | undefined>>({});
  const replacingVideoShotIdsRef = useRef<Set<string>>(replacingVideoShotIds);
  useEffect(() => {
    replacingShotIdsRef.current = replacingShotIds;
  }, [replacingShotIds]);
  useEffect(() => {
    replacingVideoShotIdsRef.current = replacingVideoShotIds;
  }, [replacingVideoShotIds]);

  const pollTriesRef = useRef(0);

  // Any structural edit + the spend flow are mutually exclusive (RMW race window).
  const editLocked = generating;

  async function run(fn: () => Promise<ActionResult>) {
    if (busy || generating) return false;
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      if ("error" in res) { setError(res.error); return false; }
      setView(parseStoryboardCardPayload(res.payload));
      // A structural or prompt/duration edit shifts indices AND may clear a shot's frame/video
      // server-side (staleness cascade). Discard any prepared children so a confirm can't spend
      // a stale set; the user re-prepares against the fresh payload.
      resetPrepared();
      setEditing(null);
      setDraftFf("");
      setDraftV("");
      return true;
    } catch {
      setError("Couldn't save — please try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  /** Clear every prepared-but-unspent staging state (both gates) — the single source of truth
   *  for "a confirm may not spend". Called on any edit success and on a fresh payload injection. */
  function resetPrepared() {
    setChildren(null);
    setConfirming(false);
    setRegenShotId(null);
    setRegenChild(null);
    setVideoChildren(null);
    setVideoConfirming(false);
    setRegenVideoShotId(null);
    setRegenVideoChild(null);
  }

  function startEdit(shot: StoryboardShotView) {
    setEditing(shot.index);
    setDraftFf(shot.firstFramePrompt);
    setDraftV(shot.videoPrompt);
    setError(null);
  }

  async function saveEdit(index: number) {
    const ok = await run(() => editShotPrompt({ cardId, index, firstFramePrompt: draftFf, videoPrompt: draftV }));
    if (ok) setEditing(null);
  }

  // --- Video options: fetch the model-driven duration list once on mount ($0) --------
  const didFetchOptionsRef = useRef(false);
  useEffect(() => {
    if (didFetchOptionsRef.current) return;
    didFetchOptionsRef.current = true;
    void (async () => {
      try {
        const res = await getStoryboardVideoOptions();
        if (!("error" in res)) setVideoDurations(res.durations);
      } catch {
        // Options are a nicety; a failure just leaves duration selects empty (auto). No error UI.
      }
    })();
  }, []);

  // --- Unified sync polling -----------------------------------------------
  // Reconcile finished first-frame AND video jobs into the payload; refresh media URLs.
  // Money guard: if the parent re-injects a fresh payload (identity change), any previously
  // prepared spend set is now stale — discard it so a confirm can't spend an outdated child
  // list. Skips the initial mount (prevPayloadRef seeded once).
  const prevPayloadRef = useRef(payload);
  useEffect(() => {
    if (prevPayloadRef.current === payload) return;
    prevPayloadRef.current = payload;
    resetPrepared();
  }, [payload]);

  const runSyncOnce = useCallback(async (): Promise<boolean> => {
    // returns true if there's still work to poll for: any shot with a pending frame/video OR
    // any confirmed regen whose replacement hasn't overwritten its genId yet.
    try {
      const res = await syncStoryboardMedia({ cardId });
      if ("error" in res) return false; // give up quietly on a sync error
      const nextView = parseStoryboardCardPayload(res.payload);
      setView(nextView);
      setFrames(res.frames);
      setVideos(res.videos);

      // A replacing FRAME shot leaves the set once its genId differs from the recorded baseline.
      const stillReplacingFrame = new Set<string>();
      for (const shotId of replacingShotIdsRef.current) {
        const genId = nextView.shots.find((s) => s.shotId === shotId)?.firstFrameGenerationId;
        if (genId && genId !== replacingBaselineRef.current[shotId]) {
          delete replacingBaselineRef.current[shotId]; // landed → forget the baseline
        } else {
          stillReplacingFrame.add(shotId);
        }
      }
      if (stillReplacingFrame.size !== replacingShotIdsRef.current.size) setReplacingShotIds(stillReplacingFrame);

      // A replacing VIDEO shot leaves the set once its videoGenerationId differs from baseline
      // (a cascade that dropped the video key also clears it — genId becomes undefined ≠ baseline).
      const stillReplacingVideo = new Set<string>();
      for (const shotId of replacingVideoShotIdsRef.current) {
        const genId = nextView.shots.find((s) => s.shotId === shotId)?.videoGenerationId;
        if (genId && genId !== replacingVideoBaselineRef.current[shotId]) {
          delete replacingVideoBaselineRef.current[shotId];
        } else {
          stillReplacingVideo.add(shotId);
        }
      }
      if (stillReplacingVideo.size !== replacingVideoShotIdsRef.current.size) setReplacingVideoShotIds(stillReplacingVideo);

      return (
        nextView.shots.some(isFramePending) ||
        nextView.shots.some(isVideoPending) ||
        stillReplacingFrame.size > 0 ||
        stillReplacingVideo.size > 0
      );
    } catch {
      return false;
    }
  }, [cardId]);

  // Poll cadence: videos take minutes → slow interval + high cap when any video is pending;
  // a frames-only wait keeps the fast/short cadence.
  const anyVideoPending =
    view.shots.some(isVideoPending) || replacingVideoShotIds.size > 0;
  const syncIntervalMs = anyVideoPending ? VIDEO_SYNC_INTERVAL_MS : FRAME_SYNC_INTERVAL_MS;
  const syncMaxTries = anyVideoPending ? VIDEO_SYNC_MAX_TRIES : FRAME_SYNC_MAX_TRIES;

  useEffect(() => {
    if (!polling) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      if (cancelled) return;
      pollTriesRef.current += 1;
      const stillPending = await runSyncOnce();
      if (cancelled) return;
      if (!stillPending || pollTriesRef.current >= syncMaxTries) {
        setPolling(false);
        setGenerating(false);
        // Poll gave up (or finished): clear any lingering "Replacing…" hints so a stuck shot
        // doesn't show the spinner forever (fixes F4's logged M1).
        if (replacingShotIdsRef.current.size > 0) setReplacingShotIds(new Set());
        if (replacingVideoShotIdsRef.current.size > 0) setReplacingVideoShotIds(new Set());
      }
    }, syncIntervalMs);
    return () => { cancelled = true; clearInterval(timer); };
  }, [polling, runSyncOnce, syncIntervalMs, syncMaxTries]);

  // Reload-mid-generation recovery: on mount, if any shot has a frame/video child but no media,
  // sync ONCE and start polling if still pending. Never spends — read-only reconcile.
  const didMountSyncRef = useRef(false);
  useEffect(() => {
    if (didMountSyncRef.current) return;
    didMountSyncRef.current = true;
    if (!view.shots.some(isFramePending) && !view.shots.some(isVideoPending)) return;
    void (async () => {
      const stillPending = await runSyncOnce();
      if (stillPending) { pollTriesRef.current = 0; setGenerating(true); setPolling(true); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startPolling() {
    pollTriesRef.current = 0;
    setPolling(true);
  }

  // --- Gate① spend: "Generate all first frames" --------------------------
  async function prepareAll() {
    if (busy || generating) return;
    setBusy(true);
    setError(null);
    try {
      const res = await prepareStoryboardFirstFrames({ cardId });
      if ("error" in res) { setError(res.error); return; }
      setChildren(res.children);
      setTotalCredits(res.totalCredits);
      setConfirming(true);
    } catch {
      setError("Couldn't prepare — please try again.");
    } finally {
      setBusy(false);
    }
  }

  // Spend EXACTLY the server-returned children from THIS confirm interaction. (SPEND SITE 1/4)
  async function confirmGenerateAll() {
    if (generating || !children) return;
    const toSpend = children.filter((c) => !c.spent);
    setConfirming(false);
    setGenerating(true);
    setError(null);

    let anyStarted = false;
    for (let i = 0; i < toSpend.length; i++) {
      const c = toSpend[i];
      try {
        const res = await coworkGenerate({ cardId: c.childCardId, prompt: c.structuredPrompt, entityIds: c.entityIds, variantSel: {} });
        if (res && "error" in res) { setError(`Frame ${i + 1} of ${toSpend.length}: ${res.error}`); continue; }
        anyStarted = true;
      } catch {
        setError(`Frame ${i + 1} of ${toSpend.length} failed — please try again.`);
      }
    }

    // Consumed: force a re-prepare before any further spend.
    setChildren(null);
    onBalanceRefresh?.();
    if (anyStarted) {
      startPolling();
    } else {
      setGenerating(false); // nothing started → no work to poll for
    }
  }

  // --- Gate① per-shot frame regenerate -----------------------------------
  async function prepareRegen(shotId: string) {
    if (busy || generating) return;
    setBusy(true);
    setError(null);
    try {
      const res = await regenShotFirstFrameCard({ cardId, shotId });
      if ("error" in res) { setError(res.error); return; }
      // Do NOT clear the local view's genId or thumbnail — the OLD frame stays valid until the
      // NEW one lands. Just stage the per-shot confirm; Cancel is a true no-op.
      setRegenShotId(shotId);
      setRegenChild(res.child);
    } catch {
      setError("Couldn't prepare — please try again.");
    } finally {
      setBusy(false);
    }
  }

  // (SPEND SITE 2/4)
  async function confirmRegen() {
    if (generating || !regenChild) return;
    const c = regenChild;
    setRegenShotId(null);
    setRegenChild(null);
    setGenerating(true);
    setError(null);
    let started = false;
    try {
      const res = await coworkGenerate({ cardId: c.childCardId, prompt: c.structuredPrompt, entityIds: c.entityIds, variantSel: {} });
      if (res && "error" in res) setError(res.error);
      else started = true;
    } catch {
      setError("Couldn't regenerate — please try again.");
    }
    onBalanceRefresh?.();
    if (started) {
      // Old frame stays shown + a "Replacing frame…" hint until sync swaps the thumbnail.
      replacingBaselineRef.current[c.shotId] = view.shots.find((s) => s.shotId === c.shotId)?.firstFrameGenerationId;
      setReplacingShotIds((prev) => new Set(prev).add(c.shotId));
      startPolling();
    } else {
      setGenerating(false);
    }
  }

  // --- Gate② spend: "Make all videos" ------------------------------------
  async function prepareVideos() {
    if (busy || generating) return;
    setBusy(true);
    setError(null);
    try {
      const res = await prepareStoryboardVideos({ cardId });
      if ("error" in res) { setError(res.error); return; }
      setVideoChildren(res.children);
      setVideoTotalCredits(res.totalCredits);
      setVideoConfirming(true);
    } catch {
      setError("Couldn't prepare — please try again.");
    } finally {
      setBusy(false);
    }
  }

  // Spend EXACTLY the server-returned video children from THIS confirm interaction. (SPEND SITE 3/4)
  async function confirmGenerateAllVideos() {
    if (generating || !videoChildren) return;
    const toSpend = videoChildren.filter((c) => !c.spent);
    setVideoConfirming(false);
    setGenerating(true);
    setError(null);

    let anyStarted = false;
    for (let i = 0; i < toSpend.length; i++) {
      const c = toSpend[i];
      try {
        const res = await coworkGenerate({ cardId: c.childCardId, prompt: c.structuredPrompt, entityIds: c.entityIds, variantSel: {} });
        if (res && "error" in res) { setError(`Video ${i + 1} of ${toSpend.length}: ${res.error}`); continue; }
        anyStarted = true;
      } catch {
        setError(`Video ${i + 1} of ${toSpend.length} failed — please try again.`);
      }
    }

    setVideoChildren(null);
    onBalanceRefresh?.();
    if (anyStarted) {
      startPolling();
    } else {
      setGenerating(false);
    }
  }

  // --- Gate② per-shot video remake ---------------------------------------
  async function prepareVideoRegen(shotId: string) {
    if (busy || generating) return;
    setBusy(true);
    setError(null);
    try {
      const res = await regenShotVideoCard({ cardId, shotId });
      if ("error" in res) { setError(res.error); return; }
      // Old video stays valid until the new one lands. Stage the per-shot confirm; Cancel = no-op.
      setRegenVideoShotId(shotId);
      setRegenVideoChild(res.child);
    } catch {
      setError("Couldn't prepare — please try again.");
    } finally {
      setBusy(false);
    }
  }

  // (SPEND SITE 4/4)
  async function confirmVideoRegen() {
    if (generating || !regenVideoChild) return;
    const c = regenVideoChild;
    setRegenVideoShotId(null);
    setRegenVideoChild(null);
    setGenerating(true);
    setError(null);
    let started = false;
    try {
      const res = await coworkGenerate({ cardId: c.childCardId, prompt: c.structuredPrompt, entityIds: c.entityIds, variantSel: {} });
      if (res && "error" in res) setError(res.error);
      else started = true;
    } catch {
      setError("Couldn't remake — please try again.");
    }
    onBalanceRefresh?.();
    if (started) {
      // Old video stays shown + a "Replacing video…" hint until sync swaps the player.
      replacingVideoBaselineRef.current[c.shotId] = view.shots.find((s) => s.shotId === c.shotId)?.videoGenerationId;
      setReplacingVideoShotIds((prev) => new Set(prev).add(c.shotId));
      startPolling();
    } else {
      setGenerating(false);
    }
  }

  const shots = view.shots;
  // #782: how many first frames gate① would actually MAKE (and charge for) — the one shared
  // rule, so the button never promises a number the server wouldn't mint. With continuous
  // shots on that is the first shot alone; the rest inherit the frame the previous clip
  // ended on, for free.
  const missingCount = shotsNeedingMintedFirstFrame(shots, view.continuity).length;
  // Shots with no frame that are WAITING for the shot before them (continuous mode) rather
  // than missing something the merchant has to make.
  const inheritingShotIds = new Set(
    view.continuity
      ? shots.filter((s, i) => i > 0 && !s.firstFrameGenerationId).map((s) => s.shotId)
      : [],
  );
  const bal = balanceUsd ?? 0;
  const affordAll = canAffordPack(totalCredits, bal);
  const affordAllVideos = canAffordPack(videoTotalCredits, bal);

  // Gate①: show "Generate all frames" only when idle (not editing, not confirming any regen).
  const idleForAffordance = editing === null && regenShotId === null && regenVideoShotId === null && !generating;
  const showGenerateAll = missingCount > 0 && idleForAffordance;

  // Gate②: "Make all videos" is visible when ≥1 shot has a frame and no video yet.
  const videoEligibleCount = shots.filter((s) => s.firstFrameGenerationId && !s.videoGenerationId).length;
  // Shots with a first frame still missing (would need one before their video can be made).
  const videoBlockedCount = shots.filter((s) => !s.firstFrameGenerationId).length;
  // In continuous mode those shots are not blocked ON THE MERCHANT — they are waiting for the
  // clip before them to finish, which then hands them its closing frame. Say that instead.
  const videoWaitingCount = shots.filter((s) => inheritingShotIds.has(s.shotId)).length;
  const showMakeVideos = videoEligibleCount > 0 && idleForAffordance;

  return (
    <div className="gb leading-[1.65]" style={{ maxWidth: 480 }}>
      <div className="rounded-[18px] border border-border bg-secondary p-6">
        {/* Header */}
        <div className="flex items-center gap-2 mb-2">
          <Film size={20} className="text-foreground" />
          <span className="font-bold text-[1rem] text-foreground">
            {view.storyboardTitle || "Storyboard"}
          </span>
        </div>

        {/* #782 continuous shots — $0, and it changes what gate① will make. `run` clears any
            prepared-but-unspent children on success, so a confirm can never spend a set that
            was staged under the other setting. */}
        <div className="mb-4 flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Switch
              id={`continuity-${cardId}`}
              checked={view.continuity}
              disabled={busy || editLocked}
              onCheckedChange={(on) => void run(() => setStoryboardContinuity({ cardId, continuity: on }))}
            />
            <Label htmlFor={`continuity-${cardId}`} className="text-[0.8125rem] text-foreground">
              Shots continue from each other
            </Label>
          </div>
          {view.continuity && (
            <div className="text-[0.75rem] text-muted-foreground">
              Each shot picks up exactly where the one before it ends, so you only make the first
              frame — and the shots are made one after another.
            </div>
          )}
        </div>

        {/* Shots */}
        {shots.length > 0 && (
          <div className="flex flex-col gap-2">
            {shots.map((shot) => {
              const isEditing = editing === shot.index;
              const frameUrl = frames[shot.shotId];
              const videoUrl = videos[shot.shotId];
              const hasFrame = !!shot.firstFrameGenerationId;
              const framePending = isFramePending(shot);
              const isRegenConfirm = regenShotId === shot.shotId;
              const isReplacing = replacingShotIds.has(shot.shotId);
              const videoPending = isVideoPending(shot);
              const isVideoRegenConfirm = regenVideoShotId === shot.shotId;
              const isReplacingVideo = replacingVideoShotIds.has(shot.shotId);
              // #782: waiting for the previous shot's clip to hand over its closing frame.
              const isInheriting = inheritingShotIds.has(shot.shotId);
              // Any per-shot confirm currently open (either gate) suppresses the OTHER shots'
              // action buttons — clone gate①'s "only one regen at a time" rule, extended to videos.
              const anyRegenOpen = regenShotId !== null || regenVideoShotId !== null;
              return (
                <div key={shot.shotId} className="bg-card rounded-[14px] flex flex-col gap-1" style={{ padding: "10px 12px" }}>
                  {/* Row header: shot number + optional title + controls */}
                  <div className="flex items-center gap-2">
                    <span className="text-[0.75rem] font-semibold px-[7px] py-[2px] rounded-full bg-secondary text-muted-foreground">
                      Shot {shot.index + 1}
                    </span>
                    {shot.title && (
                      <span className="font-semibold text-[0.875rem] text-foreground">{shot.title}</span>
                    )}
                    <div className="ml-auto flex items-center gap-1">
                      <button type="button" aria-label="Move up" disabled={busy || editLocked || shot.index === 0}
                        onClick={() => run(() => reorderShots({ cardId, order: swap(shots.map((s) => s.index), shot.index, shot.index - 1) }))}
                        className="text-muted-foreground disabled:opacity-30 hover:text-foreground">
                        <ChevronUp size={15} />
                      </button>
                      <button type="button" aria-label="Move down" disabled={busy || editLocked || shot.index === shots.length - 1}
                        onClick={() => run(() => reorderShots({ cardId, order: swap(shots.map((s) => s.index), shot.index, shot.index + 1) }))}
                        className="text-muted-foreground disabled:opacity-30 hover:text-foreground">
                        <ChevronDown size={15} />
                      </button>
                      <button type="button" aria-label="Edit shot" disabled={busy || editLocked}
                        onClick={() => (isEditing ? setEditing(null) : startEdit(shot))}
                        className="text-muted-foreground disabled:opacity-30 hover:text-foreground">
                        <Pencil size={14} />
                      </button>
                      <button type="button" aria-label="Delete shot" disabled={busy || editLocked || shots.length <= 1}
                        onClick={() => run(() => deleteShot({ cardId, index: shot.index }))}
                        className="text-muted-foreground disabled:opacity-30 hover:text-foreground">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {isEditing ? (
                    <div className="flex flex-col gap-2 mt-1">
                      <label className="text-[0.75rem] text-muted-foreground">
                        <span className="font-semibold text-foreground">First frame</span>
                        <textarea value={draftFf} onChange={(e) => setDraftFf(e.target.value)} rows={2}
                          className="mt-1 w-full rounded-[10px] border border-border bg-card p-2 text-[0.8125rem] text-foreground" />
                      </label>
                      <label className="text-[0.75rem] text-muted-foreground">
                        <span className="font-semibold text-foreground">Video</span>
                        <textarea value={draftV} onChange={(e) => setDraftV(e.target.value)} rows={2}
                          className="mt-1 w-full rounded-[10px] border border-border bg-card p-2 text-[0.8125rem] text-foreground" />
                      </label>
                      <div className="flex gap-2">
                        <Button variant="default" disabled={busy} onClick={() => saveEdit(shot.index)}>
                          {busy ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : "Save"}
                        </Button>
                        <Button variant="secondary" disabled={busy} onClick={() => setEditing(null)}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="text-[0.75rem] text-muted-foreground">
                        <span className="font-semibold text-foreground">First frame · </span>{shot.firstFramePrompt}
                      </div>
                      <div className="text-[0.75rem] text-muted-foreground">
                        <span className="font-semibold text-foreground">Video · </span>{shot.videoPrompt}
                      </div>

                      {/* First-frame status: thumbnail, generating, or regen confirm */}
                      {frameUrl && (
                        <img
                          src={frames[shot.shotId]}
                          alt={"Shot " + (shot.index + 1) + " first frame"}
                          className="rounded-[10px] border border-border"
                          style={{ maxWidth: 180 }}
                        />
                      )}
                      {framePending && !hasFrame && !frameUrl && (
                        <div className="flex items-center gap-1 text-[0.75rem] text-muted-foreground">
                          <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> Generating first frame…
                        </div>
                      )}
                      {/* #782: this shot has nothing to make — it opens on the closing moment of
                          the shot before it, once that one is done. */}
                      {isInheriting && !framePending && (
                        <div className="text-[0.75rem] text-muted-foreground">
                          Opens where shot {shot.index} ends — nothing to make here.
                        </div>
                      )}
                      {/* Confirmed frame regen in flight: old thumbnail stays; hint while the new frame lands. */}
                      {isReplacing && (
                        <div className="flex items-center gap-1 text-[0.75rem] text-muted-foreground">
                          <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> Replacing frame…
                        </div>
                      )}

                      {/* Per-shot frame regenerate (only when this shot already HAS a frame) */}
                      {hasFrame && frameUrl && !generating && editing === null && (
                        isRegenConfirm && regenChild ? (
                          <div className="mt-1 flex flex-col gap-2">
                            <div className="text-[0.75rem] text-foreground">
                              Replace this frame — {creditsLabel(regenChild.estimatedCredits)}? This will spend real credits.
                            </div>
                            <div className="flex gap-2">
                              <Button variant="default" disabled={generating} onClick={() => void confirmRegen()}>
                                Confirm — replace
                              </Button>
                              <Button variant="secondary" disabled={generating} onClick={() => { setRegenShotId(null); setRegenChild(null); }}>
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          !anyRegenOpen && (
                            <div className="mt-1">
                              <Button variant="secondary" disabled={busy} onClick={() => void prepareRegen(shot.shotId)}>
                                <span className="flex items-center gap-1"><RotateCw size={13} /> Regenerate frame</span>
                              </Button>
                            </div>
                          )
                        )
                      )}

                      {/* --- Video block (only for shots that HAVE a first frame) --- */}
                      {hasFrame && (
                        <div className="mt-1 flex flex-col gap-1 border-t border-border pt-2">
                          {/* Duration select (model-driven options; editing-class → disabled while generating). */}
                          <label className="flex items-center gap-2 text-[0.75rem] text-muted-foreground">
                            <span className="font-semibold text-foreground">Duration</span>
                            <select
                              value={shot.durationSeconds ?? ""}
                              disabled={busy || generating || editing !== null}
                              onChange={(e) => {
                                const v = e.target.value;
                                // "Auto" (empty) is display-only for the unset state — the edit
                                // action has no clear-to-auto path, so picking it is a no-op.
                                if (v === "") return;
                                void run(() => editShotPrompt({ cardId, index: shot.index, durationSeconds: Number(v) }));
                              }}
                              className="rounded-[8px] border border-border bg-card px-2 py-1 text-[0.8125rem] text-foreground disabled:opacity-40"
                            >
                              <option value="">Auto</option>
                              {videoDurations.map((d) => (
                                <option key={d} value={d}>{d}s</option>
                              ))}
                            </select>
                          </label>

                          {/* Video player (only when this shot HAS a landed video). */}
                          {videoUrl && (
                            <video
                              controls
                              preload="metadata"
                              src={videos[shot.shotId]}
                              className="rounded-[10px] border border-border"
                              style={{ maxWidth: 240 }}
                            />
                          )}
                          {videoPending && !videoUrl && (
                            <div className="flex items-center gap-1 text-[0.75rem] text-muted-foreground">
                              <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> Generating video…
                            </div>
                          )}
                          {isReplacingVideo && (
                            <div className="flex items-center gap-1 text-[0.75rem] text-muted-foreground">
                              <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> Replacing video…
                            </div>
                          )}

                          {/* Per-shot remake video (only when this shot already HAS a video) */}
                          {videoUrl && !generating && editing === null && (
                            isVideoRegenConfirm && regenVideoChild ? (
                              <div className="mt-1 flex flex-col gap-2">
                                <div className="text-[0.75rem] text-foreground">
                                  Replace this video — {creditsLabel(regenVideoChild.estimatedCredits)}? This will spend real credits.
                                </div>
                                <div className="flex gap-2">
                                  <Button variant="default" disabled={generating} onClick={() => void confirmVideoRegen()}>
                                    Confirm — replace
                                  </Button>
                                  <Button variant="secondary" disabled={generating} onClick={() => { setRegenVideoShotId(null); setRegenVideoChild(null); }}>
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              !anyRegenOpen && (
                                <div className="mt-1">
                                  <Button variant="secondary" disabled={busy} onClick={() => void prepareVideoRegen(shot.shotId)}>
                                    <span className="flex items-center gap-1"><RotateCw size={13} /> Remake video</span>
                                  </Button>
                                </div>
                              )
                            )
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Add shot */}
        <div className="mt-3">
          <Button variant="secondary" disabled={busy || editLocked || shots.length >= MAX_STORYBOARD_SHOTS}
            onClick={() => run(() => addShot({ cardId, firstFramePrompt: "New shot — describe the opening frame", videoPrompt: "New shot — describe the motion" }))}>
            <span className="flex items-center gap-1"><Plus size={14} /> Add shot</span>
          </Button>
        </div>

        {/* Gate①: generate all first frames */}
        {showGenerateAll && (
          <div className="mt-4 border-t border-border pt-4">
            {confirming && children ? (
              <div className="flex flex-col gap-3">
                {!affordAll && <TopUpNotice need="generate these frames" />}
                <div className="text-[0.875rem] text-foreground">
                  Generate {children.filter((c) => !c.spent).length} {children.filter((c) => !c.spent).length === 1 ? "frame" : "frames"} for {creditsLabel(totalCredits)}? This will spend real credits.
                </div>
                <div className="flex gap-3">
                  <Button variant="default" disabled={!affordAll || generating} onClick={() => void confirmGenerateAll()}>
                    Confirm — {children.filter((c) => !c.spent).length} {children.filter((c) => !c.spent).length === 1 ? "frame" : "frames"} · {creditsLabel(totalCredits)}
                  </Button>
                  <Button variant="secondary" disabled={generating} onClick={() => { setConfirming(false); setChildren(null); }}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="default" disabled={busy} onClick={() => void prepareAll()}>
                {busy ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : `Generate all first frames (${missingCount})`}
              </Button>
            )}
          </div>
        )}

        {/* Gate②: make all videos */}
        {showMakeVideos && (
          <div className="mt-4 border-t border-border pt-4">
            {videoConfirming && videoChildren ? (
              <div className="flex flex-col gap-3">
                {!affordAllVideos && <TopUpNotice need="make these videos" />}
                <div className="text-[0.875rem] text-foreground">
                  Make {videoChildren.filter((c) => !c.spent).length} {videoChildren.filter((c) => !c.spent).length === 1 ? "video" : "videos"} for {creditsLabel(videoTotalCredits)}? This will spend real credits.
                </div>
                <div className="flex gap-3">
                  <Button variant="default" disabled={!affordAllVideos || generating} onClick={() => void confirmGenerateAllVideos()}>
                    Confirm — {videoChildren.filter((c) => !c.spent).length} {videoChildren.filter((c) => !c.spent).length === 1 ? "clip" : "clips"} · {creditsLabel(videoTotalCredits)}
                  </Button>
                  <Button variant="secondary" disabled={generating} onClick={() => { setVideoConfirming(false); setVideoChildren(null); }}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <Button variant="default" disabled={busy} onClick={() => void prepareVideos()}>
                  {busy ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : `Make all videos (${videoEligibleCount} ${videoEligibleCount === 1 ? "clip" : "clips"})`}
                </Button>
                {videoWaitingCount > 0 ? (
                  <div className="text-[0.75rem] text-muted-foreground">
                    {videoWaitingCount} {videoWaitingCount === 1 ? "shot follows on" : "shots follow on"} — each one starts once the shot before it is made.
                  </div>
                ) : videoBlockedCount > 0 ? (
                  <div className="text-[0.75rem] text-muted-foreground">
                    {videoBlockedCount} {videoBlockedCount === 1 ? "shot needs" : "shots need"} a first frame first.
                  </div>
                ) : null}
              </div>
            )}
          </div>
        )}

        {generating && (
          <div className="mt-3 flex items-center gap-2 text-[0.875rem] text-muted-foreground">
            <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Working — this can take a moment…
          </div>
        )}

        {error && <div role="alert" className="mt-2 text-[0.875rem] text-[var(--error-soft-foreground)]">{error}</div>}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

/** 交换数组两个位置(用于上下移的 order[])。 */
function swap(arr: number[], i: number, j: number): number[] {
  const out = [...arr];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

export default StoryboardCard;
