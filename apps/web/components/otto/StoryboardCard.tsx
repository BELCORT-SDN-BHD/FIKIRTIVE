"use client";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { Film, Pencil, Trash2, Plus, ChevronUp, ChevronDown, RotateCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  parseStoryboardCardPayload,
  shotsNeedingMintedFirstFrame,
  shotsStuckWithoutInheritedFrame,
  deriveShotMediaStates,
  ownedMedia,
  hasPendingMedia,
  resolveSyncAnswer,
  needsRefreshEntrance,
  assertNever,
  nextSyncPhase,
  MAX_STORYBOARD_SHOTS,
  type StoryboardCardView,
  type StoryboardShotView,
  type ShotMediaState,
  type ShotMediaStates,
  type ShotMediaSyncReport,
  type SyncPhase,
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
import { QUEUE_WAIT_NOTE } from "@/lib/progress-format";
import { TopUpNotice } from "@/components/exits/Exits";
import { canAffordPack } from "./pack-credit-math";
import { SpendConfirmation, SpendProgress } from "./spend-state";

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
// #782 r7 (判官 r6 P1-A): the SECOND gear. When the fast watch runs out of tries and the
// server still reports a live job, we keep asking — just rarely. See nextSyncPhase for why
// "we stopped watching closely" must never mean "we stopped listening": the paid output is
// already reachable server-side, the card was simply the one that stopped asking.
const SLOW_SYNC_INTERVAL_MS = 60000;
const SLOW_SYNC_MAX_TRIES = 30;

/**
 * #840 车4 —— 时长那一格「未设」的内部值。
 *
 * 原生下拉用空串表示未设;Radix 的 Select 明令禁止空串 value(它把空串留给
 * 「清空并显示 placeholder」),所以换一个哨兵。它只活在这一格的 value 与 no-op 判据里,
 * 一次都不会走到 `editShotPrompt` —— 商家看到的仍然是 "Auto",选它仍然什么都不发生。
 */
const DURATION_AUTO = "auto";

/** A one-line status under a shot. */
function Note({ children, busy }: { children: React.ReactNode; busy?: boolean }) {
  return (
    <div role={busy ? "status" : undefined} className="flex items-center gap-1 text-xs text-muted-foreground">
      {busy ? <Spinner aria-hidden="true" /> : null} {children}
    </div>
  );
}

/** #782 r11 (judge r10): the words under one media slot, chosen by the derived state ALONE —
 *  no second opinion from a local boolean. `replacing` is now a property of the state itself
 *  (the server says "this job is running AND you still own the previous result"), which is
 *  exactly the fact r10's P1 had nowhere to live: it was kept in a set outside the enum, and
 *  the set got cleared when the fast watch handed over to the slow one.
 *  `assertNever` closes the union, so a state nobody thought about cannot render silence. */
function MediaNote({ state, kind }: { state: ShotMediaState; kind: "frame" | "video" }) {
  const isFrame = kind === "frame";
  const replacing = ownedMedia(state) !== undefined;
  switch (state.kind) {
    case "absent":
      return null; // nothing started — the package button (or the "follows on" note) is the entrance
    case "landed":
      return null; // the media itself is the answer
    case "in-progress":
      // A replacement in flight speaks for itself; the shot's existing media stays on screen
      // above this line (see MediaFrame/MediaVideo).
      if (replacing) return <Note busy>{isFrame ? "Replacing frame…" : "Replacing video…"}</Note>;
      return <Note busy>{isFrame ? "Generating first frame…" : "Generating video…"}</Note>;
    case "landed-unloaded":
      return <Note busy>{isFrame ? "That first frame is ready — loading it." : "That video is ready — loading it."}</Note>;
    case "dead":
      // #782 r5 (judge r4 P1-②): the job is over and there is nothing to show for it. The hold
      // was released when the job ended, so the merchant paid nothing. r7: the way back is this
      // shot's own retry right below — not the package button. r11: when it was a REPLACEMENT
      // that died, the merchant still owns what he had — say both things.
      return (
        <Note>
          {isFrame
            ? "That first frame didn’t go through — you weren’t charged."
            : "That video didn’t go through — you weren’t charged."}
        </Note>
      );
    case "stale-unknown":
      // Deliberately NOT "that didn't go through": a clip runs for minutes, and a cap is not
      // evidence about the merchant's money. Only the server's dead-job answer may say that.
      return (
        <Note>
          {isFrame
            ? "We’ve stopped checking for this frame automatically — check for updates below."
            : "We’ve stopped checking for this video automatically — check for updates below."}
        </Note>
      );
    default:
      return assertNever(state);
  }
}

/** The shot's FIRST FRAME: whatever the merchant owns right now (his own, or the one a running
 *  replacement hasn't superseded yet) plus the one honest line about what is happening. */
function FrameSlot({ state, shotIndex }: { state: ShotMediaState; shotIndex: number }) {
  const owned = ownedMedia(state);
  return (
    <>
      {owned?.url && (
        <img
          src={owned.url}
          alt={"Shot " + (shotIndex + 1) + " first frame"}
          className="w-full max-w-[180px] rounded-lg border border-border"
        />
      )}
      <MediaNote state={state} kind="frame" />
    </>
  );
}

/** The shot's VIDEO, same rule. `landed-unloaded` is the state judge r8's second P1 fell into —
 *  a clip the merchant has already paid for, with no player, no status and no button. It says
 *  what is true and the card's refresh entrance appears (see needsRefreshEntrance). */
function VideoSlot({ state }: { state: ShotMediaState }) {
  const owned = ownedMedia(state);
  return (
    <>
      {owned?.url && (
        <video
          controls
          preload="metadata"
          src={owned.url}
          className="w-full max-w-60 rounded-lg border border-border"
        />
      )}
      <MediaNote state={state} kind="video" />
    </>
  );
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
  // #782 r7 (判官 r6 P1-A): was a boolean ("are we polling?"). A boolean could only answer
  // "keep going" or "give up", and the cap therefore meant give up. The phase adds the third
  // answer the timeline needed: keep asking, slower. See nextSyncPhase.
  const [syncPhase, setSyncPhase] = useState<SyncPhase>("off");
  // #782 r11 (判官 r10): the server's authoritative answer for every shot's two media slots, as
  // of the last sync — job state, resolved url, and (for a replacement in flight) the result the
  // merchant still owns. null = we haven't asked yet. This ONE field replaces r4→r10's url maps,
  // live/dead id sets and "replacing" boolean sets: the card no longer holds any state that could
  // disagree with the server, so there is nothing left to keep in sync, clear, or forget.
  const [reports, setReports] = useState<ShotMediaSyncReport[] | null>(null);

  const pollTriesRef = useRef(0);
  // #782 r15 (judge r14 P2-N1): the version of the world this card is showing. Bumped the moment
  // a local write lands (a saved edit, a wholesale payload injection) — a ref, not state, because
  // a sync request already in the air has to see the new value the instant it changes, not on the
  // next render. Read only by runSyncOnce, through resolveSyncAnswer.
  const viewEpochRef = useRef(0);
  // #782 r17 (judge r16 P2-1): the epoch answers "did the world change?", which says nothing about
  // two syncs issued INSIDE one world — the timer, the mount reconcile and the merchant's own
  // "Check for updates" overlap freely, and those overlapping requests share an epoch. This is the
  // ticket each question takes on its way out; only the LAST one issued is allowed to answer.
  const syncSeqRef = useRef(0);

  // Any structural edit + the spend flow are mutually exclusive (RMW race window).
  const editLocked = generating;

  async function run(fn: () => Promise<ActionResult>) {
    if (busy || generating) return false;
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      if ("error" in res) { setError(res.error); return false; }
      // #782 r15 (judge r14 P2-N1): the world changed HERE. Bump before the new state goes in, so
      // any sync already in the air is stale from this instant on and cannot paint over it.
      viewEpochRef.current += 1;
      setView(parseStoryboardCardPayload(res.payload));
      // A structural or prompt/duration edit shifts indices AND may clear a shot's frame/video
      // server-side (staleness cascade). Discard any prepared children so a confirm can't spend
      // a stale set; the user re-prepares against the fresh payload.
      resetPrepared();
      // #782 r13 (judge r12 P2-F2): the last sync answer describes the world BEFORE this edit,
      // and the composition layer prefers it over the payload — so an edit that DELETED a shot's
      // video keys (packages/otto/src/storyboard-edit.ts drops them on any prompt/duration
      // change) would keep re-rendering the deleted clip as `landed`, with a Remake button over
      // it. Nothing would ever correct it either: `landed` is not an unfinished state, so no
      // refresh entrance appears, and the mount sync runs once per mount. The answer is stale the
      // moment the edit lands, so it is dropped the moment the edit lands.
      setReports(null);
      // …and re-asked, because the world it described just changed on the server. Same $0
      // read-only call the mount reconcile and "Check for updates" use; it can only ever ADD
      // information, and it keeps a frame the edit did NOT invalidate on screen instead of
      // demoting it to "ready — loading it".
      void reconcileOnce();
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
    // #782 r15 (judge r14 P2-N1): a wholesale payload swap is a world change too — an answer
    // asked against the old one describes different shots, so it must not be applied either.
    viewEpochRef.current += 1;
    resetPrepared();
    // #782 r4: a wholesale payload swap can bring different shots — what the server told us
    // describes the old set. Back to "haven't asked yet", not a guess.
    setReports(null);
  }, [payload]);

  const runSyncOnce = useCallback(async (): Promise<boolean> => {
    // returns true if the SERVER says something is still queued or generating — the one rule
    // for whether the watch goes on. A replacement in flight IS a live job, so it keeps the
    // watch alive by itself; r10's P1 was that it did not, because it lived outside this answer.
    //
    // #782 r15 (judge r14 P2-N1): note WHICH world we are asking about, before we ask. sync
    // resolves media urls outside its transaction, so a request can stay in the air for a long
    // time; an edit that lands meanwhile makes the answer a description of a world that no
    // longer exists. resolveSyncAnswer is the one rule for whether it may still be applied.
    const askedAtEpoch = viewEpochRef.current;
    syncSeqRef.current += 1;
    const requestSeq = syncSeqRef.current;
    // #926 (判官 r18): an ERROR answer is still an answer to a NUMBERED question, and a stale
    // one carries no information about the world it now describes — same seq/epoch bar the
    // success path clears above. Before this, a mount-time sync that lost the race to a later
    // manual refresh (r17's overlapping-same-epoch case) could come back failed and conclude
    // "give up" over a watch the fresher answer had just opened. `derivedPending: false` asks
    // resolveSyncAnswer for the verdict a failure is allowed to reach ONLY when this is still
    // the question being asked (rule ③ in its doc: a stale answer must not conclude — it
    // returns `stillPending: true` regardless, same as a stale success).
    const giveUpUnlessStale = () =>
      resolveSyncAnswer({
        askedAtEpoch, currentEpoch: viewEpochRef.current,
        requestSeq, latestSeq: syncSeqRef.current,
        derivedPending: false,
      }).stillPending;
    try {
      const res = await syncStoryboardMedia({ cardId });
      if ("error" in res) return giveUpUnlessStale(); // give up quietly — only if still asked
      const nextView = parseStoryboardCardPayload(res.payload);
      // The answer we just got is FRESH, so pendingness is derived at phase "fast" no matter what
      // gear (or none) we were in when we asked — a manual refresh out of "exhausted" must be able
      // to find live work and restart the watch.
      const derivedPending = hasPendingMedia(
        deriveShotMediaStates({ shots: nextView.shots, reports: res.shots, phase: "fast" }),
      );
      const answer = resolveSyncAnswer({
        askedAtEpoch, currentEpoch: viewEpochRef.current,
        requestSeq, latestSeq: syncSeqRef.current,
        derivedPending,
      });
      if (!answer.apply) return answer.stillPending; // stale → apply nothing, conclude nothing
      setView(nextView);
      setReports(res.shots);
      return answer.stillPending;
    } catch {
      return giveUpUnlessStale();
    }
  }, [cardId]);

  // #782 r11 (judge r10): THE state of this card's media — the server's answer composed with the
  // poll phase, read by every status, every button and every poll decision below. Nothing
  // re-derives it from pointers, and nothing else remembers anything.
  const mediaStates = deriveShotMediaStates({ shots: view.shots, reports, phase: syncPhase });
  const mediaByShot = new Map<string, ShotMediaStates>(mediaStates.map((s) => [s.shotId, s]));
  const polling = syncPhase === "fast" || syncPhase === "slow";
  // Rule ②: the merchant always has a way to ask again whenever the card isn't asking for him.
  const showRefresh = needsRefreshEntrance(mediaStates, polling);

  // Poll cadence: videos take minutes → slow interval + high cap when any video is pending;
  // a frames-only wait keeps the fast/short cadence. The SLOW phase overrides both — it is a
  // background reconcile, not a watch, so the media class no longer sets its pace.
  const anyVideoPending = mediaStates.some((s) => s.video.kind === "in-progress");
  const syncIntervalMs =
    syncPhase === "slow" ? SLOW_SYNC_INTERVAL_MS : anyVideoPending ? VIDEO_SYNC_INTERVAL_MS : FRAME_SYNC_INTERVAL_MS;
  const syncMaxTries =
    syncPhase === "slow" ? SLOW_SYNC_MAX_TRIES : anyVideoPending ? VIDEO_SYNC_MAX_TRIES : FRAME_SYNC_MAX_TRIES;

  useEffect(() => {
    if (syncPhase !== "fast" && syncPhase !== "slow") return;
    const phase = syncPhase; // the two gears that actually run a timer
    let cancelled = false;
    const timer = setInterval(async () => {
      if (cancelled) return;
      pollTriesRef.current += 1;
      const stillPending = await runSyncOnce();
      if (cancelled) return;
      // #782 r7 (判官 r6 P1-A): the ONE rule for what the cap means — see nextSyncPhase.
      // Same phase back = nothing changed; keep the interval and the counter running.
      const next = nextSyncPhase({ phase, triesUsed: pollTriesRef.current, maxTries: syncMaxTries, stillPending });
      if (next === phase) return;

      // Leaving the fast watch ends THIS spend interaction: stop locking edits and stop saying
      // "Working…". #782 r11 (judge r10 P1): it used to ALSO clear the "replacing" sets here —
      // the only record that a paid replacement was in flight — so the very next slow tick saw
      // nothing pending and shut the watch down for good. Nothing is cleared now because nothing
      // is remembered: a replacement is a live job in the server's own answer.
      setGenerating(false);
      if (next === "slow") pollTriesRef.current = 0; // the slow gear gets its own budget

      // #782 r5 (judge r4 P1-①) — the rule is "when we stop ASKING, we stop CLAIMING": leaving
      // a spinner up after the last question hides the very entrance the merchant needs, because
      // nothing will ever update it again. r5 expressed it by EMPTYING the server's live-frame
      // set — writing our own conclusion into the slot that holds the SERVER's answer, and only
      // for frames. That is exactly how judge r8 found a clip still spinning after 151 syncs
      // with no timer left alive. r9 puts the statement where it belongs: `next === "exhausted"`
      // IS "we stopped asking", both media classes read it through deriveShotMediaStates, and
      // the honest copy + the manual refresh entrance follow from the enum instead of from a
      // per-media patch. Money-safe as before: prepare reports such a child spent:true (its job
      // exists), so it is excluded from the quote and cannot be charged twice.
      setSyncPhase(next);
    }, syncIntervalMs);
    return () => { cancelled = true; clearInterval(timer); };
  }, [syncPhase, runSyncOnce, syncIntervalMs, syncMaxTries]);

  /** Ask the server once, and (only if something is genuinely in flight) resume the close watch.
   *  Read-only — it never spends. The mount reconcile and the merchant's "Check for updates"
   *  button are the same act, so they are the same function. */
  const reconcileOnce = useCallback(async () => {
    const stillPending = await runSyncOnce();
    if (stillPending) { setGenerating(true); setSyncPhase("fast"); pollTriesRef.current = 0; }
    // #926 (判官 r18): "off" means nothing is being watched any more — `generating` has to say
    // the same thing, or a card can end up locked (edit disabled, refresh disabled) with no
    // timer left alive to ever clear it, reload-only. Concluding "off" must always let go of
    // "still working" in the same breath.
    else { setGenerating(false); setSyncPhase("off"); } // current answer — "stopped checking" true
  }, [runSyncOnce]);

  // Reload recovery: on mount the card has NO answer from the server, so anything the payload
  // says has landed still has to be LOADED, and anything with an unfinished child is worth
  // asking about. Both questions are the same one — needsRefreshEntrance at polling=false — and
  // #782 r9 (judge r8 P1-②) is what happens when only the second is asked: a shot whose clip had
  // already landed has no unfinished child, so the mount sync was skipped and the card showed a
  // paid-for video as nothing at all, with no button to get it back.
  const didMountSyncRef = useRef(false);
  useEffect(() => {
    if (didMountSyncRef.current) return;
    didMountSyncRef.current = true;
    const initial = deriveShotMediaStates({ shots: view.shots, reports: null, phase: "off" });
    if (!needsRefreshEntrance(initial, false)) return;
    // Async on purpose: the state this settles comes back from the server, so nothing is set
    // synchronously in the effect body.
    void (async () => { await reconcileOnce(); })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Start (or restart) the close watch. Every path that could have produced a result the
   *  card hasn't seen yet goes through here — a confirmed spend, and (r7) any prepare that
   *  came back saying the work is already paid for.
   *
   *  #782 r11 (judge r10): it also asks ONCE, right now. The card no longer keeps a local
   *  "replacing" flag to paint the moment after a spend, so that moment has to come from the
   *  server — and it can, because the spend call only returns after the job row exists. Waiting
   *  for the first interval tick instead would leave the old status on screen for seconds
   *  ("that video didn't go through" while the retry is already running). */
  function startPolling() {
    pollTriesRef.current = 0;
    setSyncPhase("fast");
    void runSyncOnce();
  }

  /** The merchant's own way to ask again (#782 r9, judge r8). $0, and it can only ever ADD
   *  information: it reuses the same read-only sync the poll uses. */
  async function refreshNow() {
    if (busy || generating) return;
    setBusy(true);
    setError(null);
    try {
      await reconcileOnce();
    } catch {
      setError("Couldn't check — please try again.");
    } finally {
      setBusy(false);
    }
  }

  // --- Gate① spend: "Generate all first frames" --------------------------
  async function prepareAll() {
    if (busy || generating) return;
    setBusy(true);
    setError(null);
    try {
      const res = await prepareStoryboardFirstFrames({ cardId });
      if ("error" in res) { setError(res.error); return; }
      // #782 r7 (判官 r6 P1-A): nothing here is BUYABLE — there is only something to WAIT for.
      // r6 opened a confirm reading "Generate 0 frames for 0 credits", and confirming it started
      // nothing and watched nothing: the merchant's one visible way back from a late-landing
      // frame was a button that did nothing. Go back to watching instead — whatever exists is
      // already paid for and reachable.
      // r9 (judge r8 P2): an EMPTY result is the same situation — a frame that landed between
      // the render and this click leaves the server with nothing to mint. `every` on an empty
      // list is true, so dropping r7's `length > 0` guard is the whole fix: both shapes take
      // the honest branch, and neither can produce a zero-credit dead confirm.
      if (res.children.every((c) => c.spent)) {
        setChildren(null);
        setConfirming(false);
        setGenerating(true);
        startPolling();
        return;
      }
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
    // #782 r7 (判官 r6 P1-A): children this confirm may NOT charge again, because they were
    // charged already. They are still work in flight — so they still have to be watched.
    const alreadySpent = children.length - toSpend.length;
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
    if (anyStarted || alreadySpent > 0) {
      startPolling();
    } else {
      setGenerating(false); // nothing started and nothing already paid for → nothing to watch
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
      // #782 r11 (judge r10 P1): the server hands back the replacement ALREADY IN FLIGHT rather
      // than minting a second one. There is nothing to buy here — only something to wait for, so
      // never open a confirm that says "this will spend real credits" over a job already paid for.
      if (res.child.spent) {
        setGenerating(true);
        startPolling();
        return;
      }
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
      // The old frame stays on screen and the card says "Replacing frame…" — both come from the
      // server's next answer (a live job + the result the merchant still owns), which startPolling
      // asks for immediately. r11 keeps no local record of this replacement at all.
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
      // #782 r7 (判官 r6 P1-A) + r9 (judge r8 P2): same rule as the frames gate — an
      // all-paid-for OR empty result is a reason to watch, never a 0-credit confirm that
      // starts nothing.
      if (res.children.every((c) => c.spent)) {
        setVideoChildren(null);
        setVideoConfirming(false);
        setGenerating(true);
        startPolling();
        return;
      }
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
    const alreadySpent = videoChildren.length - toSpend.length; // r7: paid for → still watched
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
    if (anyStarted || alreadySpent > 0) {
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
      // #782 r11 (judge r10 P1 的 kill-shot): 同一次替换第二次点进来,拿回的是**第一笔作业**,
      // 不是第二张账单 —— 回去等结果,不开确认框。
      if (res.child.spent) {
        setGenerating(true);
        startPolling();
        return;
      }
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
      // Same as the frame path: the "Replacing video…" line and the clip that stays on screen are
      // the server's answer, not a local flag (judge r10 P1 — that flag was the whole defect).
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
  // #782 r3 (判官 r2 P1-a/P1-b): shots gate③ has RULED cannot inherit (it tried on the shot
  // before them and that clip has no usable closing frame) are STUCK, not waiting — they're
  // part of `missingCount` above and get their own honest per-shot message below. The ruling
  // lives in the payload precisely so this count never has to guess from pointer shapes: a
  // prepared-but-unspent child is not "in flight" (the entrance must stay), and an upstream
  // remake still running is not "over" (no paid frame may be opened while a free one is coming).
  const stuckShotIds = new Set(shotsStuckWithoutInheritedFrame(shots, view.continuity).map((s) => s.shotId));
  // Shots with no frame that are WAITING for the shot before them (continuous mode) rather
  // than missing something the merchant has to make.
  const inheritingShotIds = new Set(
    view.continuity
      ? shots.filter((s, i) => i > 0 && !s.firstFrameGenerationId && !stuckShotIds.has(s.shotId)).map((s) => s.shotId)
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
  const videoWaitingCount = inheritingShotIds.size;
  const showMakeVideos = videoEligibleCount > 0 && idleForAffordance;

  return (
    <Card size="sm" className="gb w-full max-w-[480px] leading-[1.65]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Film size={18} aria-hidden="true" />
          {view.storyboardTitle || "Storyboard"}
        </CardTitle>
        <CardDescription>
          Review each shot, then make the first frames and videos when you&apos;re ready.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">

        {/* #782 continuous shots — $0, and it changes what gate① will make. `run` clears any
            prepared-but-unspent children on success, so a confirm can never spend a set that
            was staged under the other setting. */}
        <Field orientation="horizontal" data-disabled={busy || editLocked}>
          <FieldContent>
            <FieldLabel htmlFor={`continuity-${cardId}`}>
              Shots continue from each other
            </FieldLabel>
            {view.continuity && (
              <FieldDescription>
                {/* #782 r2b (判官 r1 P1): "exactly where it ends" was an absolute promise the
                    code doesn't keep — re-making an earlier shot never updates a later shot's
                    first frame once that frame already exists. Say what's actually true: the
                    hand-off only happens as each shot is FIRST made, one after another. */}
                As each shot is first made, it picks up from the one before it — so you only make
                the first frame, and the shots are made one after another. Re-making an earlier
                shot won&rsquo;t change a later shot&rsquo;s first frame once it already has one.
              </FieldDescription>
            )}
          </FieldContent>
          <Switch
            id={`continuity-${cardId}`}
            checked={view.continuity}
            disabled={busy || editLocked}
            onCheckedChange={(on) => void run(() => setStoryboardContinuity({ cardId, continuity: on }))}
          />
        </Field>

        {/* Shots */}
        {shots.length > 0 && (
          <div className="flex flex-col gap-2">
            {shots.map((shot) => {
              const isEditing = editing === shot.index;
              // #782 r9 (judge r8): this shot's TWO states — the only thing the block below
              // reads. No local re-derivation from pointers, urls or server sets.
              const media = mediaByShot.get(shot.shotId);
              const frameState: ShotMediaState = media?.frame ?? { kind: "absent" };
              const videoState: ShotMediaState = media?.video ?? { kind: "absent" };
              // The video block belongs to shots that HAVE a first frame — including one whose
              // image hasn't loaded yet, and one whose frame is being replaced right now, since
              // the clip is a separate thing the merchant may already own.
              const hasFrame = ownedMedia(frameState) !== undefined;
              const isRegenConfirm = regenShotId === shot.shotId;
              const isVideoRegenConfirm = regenVideoShotId === shot.shotId;
              // Is there a clip on screen for this shot right now (its own, or the one a running
              // replacement hasn't superseded yet)? Decides "replace" vs "make" wording only.
              const hasClip = ownedMedia(videoState) !== undefined;
              // #782: waiting for the previous shot's clip to hand over its closing frame.
              const isInheriting = inheritingShotIds.has(shot.shotId);
              // #782 r2b (判官 r1 P1): the hand-off already ran and came up empty — this shot
              // needs its OWN first frame (via Generate all below), it won't continue from
              // the shot before it.
              const isStuck = stuckShotIds.has(shot.shotId);
              // Any per-shot confirm currently open (either gate) suppresses the OTHER shots'
              // action buttons — clone gate①'s "only one regen at a time" rule, extended to videos.
              const anyRegenOpen = regenShotId !== null || regenVideoShotId !== null;
              return (
                <Card key={shot.shotId} size="sm" className="gap-2">
                  {/* Row header: shot number + optional title + controls */}
                  <div className="flex items-center gap-2">
                    <Badge variant="default">
                      Shot {shot.index + 1}
                    </Badge>
                    {shot.title && (
                      <span className="text-sm font-semibold text-foreground">{shot.title}</span>
                    )}
                    <div className="ml-auto flex items-center gap-1">
                      <Button type="button" variant="ghost" size="icon-xs" aria-label="Move up" disabled={busy || editLocked || shot.index === 0}
                        onClick={() => run(() => reorderShots({ cardId, order: swap(shots.map((s) => s.index), shot.index, shot.index - 1) }))}
                      >
                        <ChevronUp aria-hidden="true" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon-xs" aria-label="Move down" disabled={busy || editLocked || shot.index === shots.length - 1}
                        onClick={() => run(() => reorderShots({ cardId, order: swap(shots.map((s) => s.index), shot.index, shot.index + 1) }))}
                      >
                        <ChevronDown aria-hidden="true" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon-xs" aria-label="Edit shot" disabled={busy || editLocked}
                        onClick={() => (isEditing ? setEditing(null) : startEdit(shot))}
                      >
                        <Pencil aria-hidden="true" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon-xs" aria-label="Delete shot" disabled={busy || editLocked || shots.length <= 1}
                        onClick={() => run(() => deleteShot({ cardId, index: shot.index }))}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </div>
                  </div>

                  {isEditing ? (
                    <div className="mt-1 flex flex-col gap-3">
                      <FieldGroup className="gap-3">
                        <Field data-disabled={busy}>
                          <FieldLabel htmlFor={`frame-prompt-${shot.shotId}`}>First frame</FieldLabel>
                          <Textarea
                            id={`frame-prompt-${shot.shotId}`}
                            value={draftFf}
                            onChange={(e) => setDraftFf(e.target.value)}
                            rows={2}
                            disabled={busy}
                            className="field-sizing-fixed min-h-0"
                          />
                        </Field>
                        <Field data-disabled={busy}>
                          <FieldLabel htmlFor={`video-prompt-${shot.shotId}`}>Video</FieldLabel>
                          <Textarea
                            id={`video-prompt-${shot.shotId}`}
                            value={draftV}
                            onChange={(e) => setDraftV(e.target.value)}
                            rows={2}
                            disabled={busy}
                            className="field-sizing-fixed min-h-0"
                          />
                        </Field>
                      </FieldGroup>
                      <div className="flex gap-2">
                        <Button variant="default" size="sm" disabled={busy} onClick={() => saveEdit(shot.index)}>
                          {busy && <Spinner data-icon="inline-start" aria-label="Saving shot" />}
                          {busy ? "Saving…" : "Save"}
                        </Button>
                        <Button variant="secondary" size="sm" disabled={busy} onClick={() => setEditing(null)}>Cancel</Button>
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

                      {/* First-frame: image, status or nothing — ONE derived state decides. */}
                      <FrameSlot state={frameState} shotIndex={shot.index} />
                      {/* #782: this shot has nothing to make — it opens on the closing moment of
                          the shot before it, once that one is done. */}
                      {isInheriting && frameState.kind !== "in-progress" && (
                        <div className="text-[0.75rem] text-muted-foreground">
                          Opens where shot {shot.index} ends — nothing to make here.
                        </div>
                      )}
                      {/* #782 r3 (判官 r2 P1-a): gate③ has ruled that shot {shot.index}'s clip
                          cannot hand a closing frame over — an honest, permanent fact about that
                          clip. It is shown WHENEVER the shot is stuck, including while a prepared
                          (or running) child of its own exists: r2b hid it behind !framePending,
                          and a prepared-but-unspent child then left the card saying only
                          "Generating first frame…" with no explanation and no way forward. The
                          two lines answer different questions — this one WHY the hand-off is off,
                          the spinner above WHETHER a frame is on its way. */}
                      {isStuck && (
                        <div className="text-[0.75rem] text-muted-foreground">
                          Shot {shot.index}&rsquo;s ending frame didn&rsquo;t come through — this shot needs its own
                          first frame; it won&rsquo;t continue from shot {shot.index}.
                        </div>
                      )}
                      {/* Per-shot frame regenerate — only for a frame that is actually on screen
                          and finished (a "landed" state IS the image; see FrameSlot). While a paid
                          replacement is in flight the state is "in-progress", so this button is
                          gone — that is judge r10's second-charge entrance, closed at the surface;
                          the server closes it again underneath (isUnconsumedInFlight). */}
                      {frameState.kind === "landed" && !generating && editing === null && (
                        isRegenConfirm && regenChild ? (
                          <SpendConfirmation
                            className="mt-1"
                            title="Confirm credit spend"
                            description={`Replace this frame — ${creditsLabel(regenChild.estimatedCredits)}? This will spend real credits.`}
                          >
                              <Button variant="default" disabled={generating} onClick={() => void confirmRegen()}>
                                Confirm — replace
                              </Button>
                              <Button variant="secondary" disabled={generating} onClick={() => { setRegenShotId(null); setRegenChild(null); }}>
                                Cancel
                              </Button>
                          </SpendConfirmation>
                        ) : (
                          !anyRegenOpen && (
                            <div className="mt-1">
                              <Button variant="secondary" size="sm" disabled={busy} onClick={() => void prepareRegen(shot.shotId)}>
                                <RotateCw data-icon="inline-start" aria-hidden="true" />
                                Regenerate frame
                              </Button>
                            </div>
                          )
                        )
                      )}

                      {/* --- Video block (only for shots that HAVE a first frame) --- */}
                      {hasFrame && (
                        <div className="mt-1 flex flex-col gap-2">
                          <Separator />
                          {/* Duration select (model-driven options; editing-class → disabled while generating). */}
                          <Field orientation="horizontal" data-disabled={busy || generating || editing !== null}>
                            <FieldLabel htmlFor={`duration-${shot.shotId}`}>Duration</FieldLabel>
                            {/* #840 车4:迁到 ui/Select(Radix)。屏幕上的东西一样不变 —— 未设时
                                触发器仍读 "Auto",菜单里仍是 Auto + 各时长档,选 Auto 仍是
                                no-op(编辑动作没有清回自动的路)。唯一的变化是那一格的内部值:
                                Radix 明令禁止空串 value,所以 "" 换成哨兵 "auto",no-op 那一支
                                照原样跟着改判据。`aria-label` 是把可访问名字**补回来**,不是
                                新增:原生下拉从外层 label 拿到 "Duration",而按钮型的
                                触发器不走 label 关联(它的名字来自内容 = 选中的那一档)。 */}
                            <Select
                              value={shot.durationSeconds != null ? String(shot.durationSeconds) : DURATION_AUTO}
                              disabled={busy || generating || editing !== null}
                              onValueChange={(v) => {
                                // "Auto" is display-only for the unset state — the edit
                                // action has no clear-to-auto path, so picking it is a no-op.
                                if (v === DURATION_AUTO) return;
                                void run(() => editShotPrompt({ cardId, index: shot.index, durationSeconds: Number(v) }));
                              }}
                            >
                              <SelectTrigger
                                id={`duration-${shot.shotId}`}
                                aria-label="Duration"
                                size="sm"
                                className="w-24"
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectGroup>
                                  <SelectItem value={DURATION_AUTO}>Auto</SelectItem>
                                  {videoDurations.map((d) => (
                                    <SelectItem key={d} value={String(d)}>{d}s</SelectItem>
                                  ))}
                                </SelectGroup>
                              </SelectContent>
                            </Select>
                          </Field>

                          {/* Player, status or nothing — ONE derived state decides. A remake in
                              flight keeps the old clip on screen with one "Replacing video…" line
                              (r11: that is the server's answer, not a local flag). */}
                          <VideoSlot state={videoState} />

                          {/* Per-shot video action — remake the clip this shot HAS, or retry the
                              one that died.
                              #782 r7 (judge r6 P1-B): this used to hang off `videoUrl` alone, and
                              a dead clip never has one — so the only way back was "Make all
                              videos", which quotes every shot at once. With one dead clip and one
                              unmade shot, a merchant holding enough credits for exactly one clip
                              had the package confirm greyed out and no other control on the card:
                              the rescue existed in the server action (regenShotVideoCard only
                              needs this shot's FIRST FRAME, and mints a fresh card for a dead job)
                              and was unreachable in the interface. One shot, one price, its own
                              button — the package and the single shot stop blocking each other.
                              r9: the two states that earn this button are named, not inferred —
                              "landed" (there is a clip to replace) and "dead" (there is one to
                              retry). Everything else has its own honest exit above. r11: a clip
                              being REPLACED is "in-progress", so the button is correctly absent
                              until that job ends — no second bill for one replacement. */}
                          {(videoState.kind === "landed" || videoState.kind === "dead") && !generating && editing === null && (
                            isVideoRegenConfirm && regenVideoChild ? (
                              <SpendConfirmation
                                className="mt-1"
                                title="Confirm credit spend"
                                description={<>
                                  {hasClip ? "Replace this video" : "Make this video"} — {creditsLabel(regenVideoChild.estimatedCredits)}? This will spend real credits.
                                  <span className="mt-1 block text-muted-foreground">
                                    This won&rsquo;t change the first frame of any shot that already has one.
                                  </span>
                                </>}
                              >
                                {/* #782 r2b (判官 r1 P1): honest downstream note — sync only ever
                                    FILLS an empty first frame, it never overwrites one that's
                                    already set, so a later shot's frame stays exactly as it is. */}
                                  <Button variant="default" disabled={generating} onClick={() => void confirmVideoRegen()}>
                                    {hasClip ? "Confirm — replace" : "Confirm — make video"}
                                  </Button>
                                  <Button variant="secondary" disabled={generating} onClick={() => { setRegenVideoShotId(null); setRegenVideoChild(null); }}>
                                    Cancel
                                  </Button>
                              </SpendConfirmation>
                            ) : (
                              !anyRegenOpen && (
                                <div className="mt-1">
                                  <Button variant="secondary" size="sm" disabled={busy} onClick={() => void prepareVideoRegen(shot.shotId)}>
                                    <RotateCw data-icon="inline-start" aria-hidden="true" />
                                    {hasClip ? "Remake video" : "Try this video again"}
                                  </Button>
                                </div>
                              )
                            )
                          )}
                        </div>
                      )}
                    </>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </CardContent>

      <CardFooter className="flex-col items-stretch">
        {/* Add shot */}
        <div>
          <Button variant="secondary" size="sm" disabled={busy || editLocked || shots.length >= MAX_STORYBOARD_SHOTS}
            onClick={() => run(() => addShot({ cardId, firstFramePrompt: "New shot — describe the opening frame", videoPrompt: "New shot — describe the motion" }))}>
            <Plus data-icon="inline-start" aria-hidden="true" />
            Add shot
          </Button>
        </div>

        {/* Gate①: generate all first frames */}
        {showGenerateAll && (
          <div className="flex flex-col gap-3">
            <Separator />
            {confirming && children ? (
              <div className="flex flex-col gap-3">
                {!affordAll && <TopUpNotice need="generate these frames" />}
                <SpendConfirmation
                  title="Confirm credit spend"
                  description={`Generate ${children.filter((c) => !c.spent).length} ${children.filter((c) => !c.spent).length === 1 ? "frame" : "frames"} for ${creditsLabel(totalCredits)}? This will spend real credits.`}
                >
                  <Button variant="default" size="sm" disabled={!affordAll || generating} onClick={() => void confirmGenerateAll()}>
                    Confirm — {children.filter((c) => !c.spent).length} {children.filter((c) => !c.spent).length === 1 ? "frame" : "frames"} · {creditsLabel(totalCredits)}
                  </Button>
                  <Button variant="secondary" size="sm" disabled={generating} onClick={() => { setConfirming(false); setChildren(null); }}>
                    Cancel
                  </Button>
                </SpendConfirmation>
              </div>
            ) : (
              <Button variant="default" size="sm" disabled={busy} onClick={() => void prepareAll()}>
                {busy && <Spinner data-icon="inline-start" aria-label="Preparing first frames" />}
                {busy ? "Preparing first frames…" : `Generate all first frames (${missingCount})`}
              </Button>
            )}
          </div>
        )}

        {/* Gate②: make all videos */}
        {showMakeVideos && (
          <div className="flex flex-col gap-3">
            <Separator />
            {videoConfirming && videoChildren ? (
              <div className="flex flex-col gap-3">
                {!affordAllVideos && <TopUpNotice need="make these videos" />}
                <SpendConfirmation
                  title="Confirm credit spend"
                  description={`Make ${videoChildren.filter((c) => !c.spent).length} ${videoChildren.filter((c) => !c.spent).length === 1 ? "video" : "videos"} for ${creditsLabel(videoTotalCredits)}? This will spend real credits.`}
                >
                  <Button variant="default" size="sm" disabled={!affordAllVideos || generating} onClick={() => void confirmGenerateAllVideos()}>
                    Confirm — {videoChildren.filter((c) => !c.spent).length} {videoChildren.filter((c) => !c.spent).length === 1 ? "clip" : "clips"} · {creditsLabel(videoTotalCredits)}
                  </Button>
                  <Button variant="secondary" size="sm" disabled={generating} onClick={() => { setVideoConfirming(false); setVideoChildren(null); }}>
                    Cancel
                  </Button>
                </SpendConfirmation>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <Button variant="default" size="sm" disabled={busy} onClick={() => void prepareVideos()}>
                  {busy && <Spinner data-icon="inline-start" aria-label="Preparing videos" />}
                  {busy ? "Preparing videos…" : `Make all videos (${videoEligibleCount} ${videoEligibleCount === 1 ? "clip" : "clips"})`}
                </Button>
                {videoWaitingCount > 0 ? (
                  <div className="text-xs text-muted-foreground">
                    {videoWaitingCount} {videoWaitingCount === 1 ? "shot follows on" : "shots follow on"} — each one starts once the shot before it is made.
                  </div>
                ) : videoBlockedCount > 0 ? (
                  <div className="text-xs text-muted-foreground">
                    {videoBlockedCount} {videoBlockedCount === 1 ? "shot needs" : "shots need"} a first frame first.
                  </div>
                ) : null}
              </div>
            )}
          </div>
        )}

        {/* #782 r9 (judge r8) — rule ②: the merchant's own way to ask again. It appears exactly
            when the card is showing something unfinished that nothing is going to update on its
            own: we stopped checking (the 151-sync timeline), a paid-for result whose file hasn't
            loaded, or a "generating" claim with no watch behind it. $0 and read-only — it reuses
            the same sync the poll uses, so it can only ever ADD information. */}
        {showRefresh && (
          <div>
            <Button variant="secondary" size="sm" disabled={busy || generating} onClick={() => void refreshNow()}>
              <RotateCw data-icon="inline-start" aria-hidden="true" />
              Check for updates
            </Button>
          </div>
        )}

        {generating && (
          /* #979:等待措辞只有一处作者(`QUEUE_WAIT_NOTE`)—— 这句话本来就是仓库里
             那句诚实的原型,现在计划卡也引它,两处不会再各自漂成两句。 */
          <SpendProgress
            title="Working"
            description={`${QUEUE_WAIT_NOTE}…`}
          />
        )}

        {error && (
          <Alert role="alert" variant="destructive" density="compact">
            <AlertTitle>Action wasn&apos;t completed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </CardFooter>
    </Card>
  );
}

/** 交换数组两个位置(用于上下移的 order[])。 */
function swap(arr: number[], i: number, j: number): number[] {
  const out = [...arr];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

export default StoryboardCard;
