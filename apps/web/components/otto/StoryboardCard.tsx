"use client";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { Film, Pencil, Trash2, Plus, ChevronUp, ChevronDown, Loader2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseStoryboardCardPayload, MAX_STORYBOARD_SHOTS, type StoryboardCardView, type StoryboardShotView } from "@/lib/storyboard-card";
import { editShotPrompt, addShot, deleteShot, reorderShots } from "@/lib/storyboard-actions";
import {
  prepareStoryboardFirstFrames,
  regenShotFirstFrameCard,
  syncStoryboardFirstFrames,
  type ChildFrameCard,
} from "@/lib/storyboard-gate1-actions";
import { coworkGenerate } from "@/lib/cowork-actions";
import { creditsLabel } from "@/lib/credit-format";
import { canAffordPack } from "./pack-credit-math";

export interface StoryboardCardProps {
  cardId: string;
  payload: unknown;
  balanceUsd?: number;
  onBalanceRefresh?: () => void;
}

type ActionResult = { payload: unknown } | { error: string };

const SYNC_INTERVAL_MS = 3000;
const SYNC_MAX_TRIES = 40;

/** A shot is "pending" once it points at a child card but has no finished image yet. */
function isPending(s: StoryboardShotView): boolean {
  return !!s.firstFrameCardId && !s.firstFrameGenerationId;
}

/** Otto 的分镜卡(F3:可逐帧编辑,$0)+ F4 闸①:聚合确认铸首帧图、逐帧重出、缩略图。
 *  本地 state 持 payload;编辑动作成功后用返回 payload 更新。闸①:prepare($0)→ 确认 →
 *  逐子卡 coworkGenerate(唯一花钱调用)→ sync 轮询把 firstFrameGenerationId 写回 + 取图。
 *  样式沿用 OttoActionPlanCard:.gb 壳 → bg-secondary 卡体 → bg-card 行。 */
export function StoryboardCard({ cardId, payload, balanceUsd, onBalanceRefresh }: StoryboardCardProps) {
  const [view, setView] = useState<StoryboardCardView>(() => parseStoryboardCardPayload(payload));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draftFf, setDraftFf] = useState("");
  const [draftV, setDraftV] = useState("");

  // Gate① state.
  // `children` is the SERVER-returned set from the prepare call made in THIS confirm
  // interaction. The spend loop derives its work list from THIS array only — never a
  // stale render — and it's CLEARED on any edit or payload change (forcing a re-prepare).
  const [children, setChildren] = useState<ChildFrameCard[] | null>(null);
  const [totalCredits, setTotalCredits] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [regenShotId, setRegenShotId] = useState<string | null>(null); // shotId awaiting per-shot confirm
  const [regenChild, setRegenChild] = useState<ChildFrameCard | null>(null); // the freshly-minted child for that shot
  const [generating, setGenerating] = useState(false); // spend loop OR sync poll running
  const [frames, setFrames] = useState<Record<string, string>>({});
  const [polling, setPolling] = useState(false);

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
      // A structural edit shifts indices AND may re-prompt a shot (clearing its frame
      // server-side). Discard any prepared children so a confirm can't spend a stale set;
      // the user re-prepares against the fresh payload.
      setChildren(null);
      setConfirming(false);
      setRegenShotId(null);
      setRegenChild(null);
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

  // --- Gate① sync polling -------------------------------------------------
  // Reconcile finished first-frame jobs into the payload; refresh thumbnails.
  // Runs while `polling` is true, every 3s, capped. Stops when no shot is pending.
  // Money guard: if the parent re-injects a fresh payload (identity change), any
  // previously-prepared spend set is now stale — discard it so a confirm can't spend
  // against an outdated child list. Skips the initial mount (prevPayloadRef seeded once).
  const prevPayloadRef = useRef(payload);
  useEffect(() => {
    if (prevPayloadRef.current === payload) return;
    prevPayloadRef.current = payload;
    setChildren(null);
    setConfirming(false);
    setRegenShotId(null);
    setRegenChild(null);
  }, [payload]);

  const runSyncOnce = useCallback(async (): Promise<boolean> => {
    // returns true if any shot is still pending after this sync
    try {
      const res = await syncStoryboardFirstFrames({ cardId });
      if ("error" in res) return false; // give up quietly on a sync error
      const nextView = parseStoryboardCardPayload(res.payload);
      setView(nextView);
      setFrames(res.frames);
      return nextView.shots.some(isPending);
    } catch {
      return false;
    }
  }, [cardId]);

  useEffect(() => {
    if (!polling) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      if (cancelled) return;
      pollTriesRef.current += 1;
      const stillPending = await runSyncOnce();
      if (cancelled) return;
      if (!stillPending || pollTriesRef.current >= SYNC_MAX_TRIES) {
        setPolling(false);
        setGenerating(false);
      }
    }, SYNC_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [polling, runSyncOnce]);

  // Reload-mid-generation recovery: on mount, if any shot has a child but no image,
  // sync ONCE and start polling if still pending. Never spends — read-only reconcile.
  const didMountSyncRef = useRef(false);
  useEffect(() => {
    if (didMountSyncRef.current) return;
    didMountSyncRef.current = true;
    if (!view.shots.some(isPending)) return;
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

  // Spend EXACTLY the server-returned children from THIS confirm interaction.
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

  // --- Gate① per-shot regenerate -----------------------------------------
  async function prepareRegen(shotId: string) {
    if (busy || generating) return;
    setBusy(true);
    setError(null);
    try {
      const res = await regenShotFirstFrameCard({ cardId, shotId });
      if ("error" in res) { setError(res.error); return; }
      // Reflect the cleared frame immediately (server dropped firstFrameGenerationId).
      setView((v) => ({
        ...v,
        shots: v.shots.map((s) =>
          s.shotId === shotId
            ? { ...s, firstFrameCardId: res.child.childCardId, firstFrameGenerationId: undefined }
            : s,
        ),
      }));
      setFrames((f) => { const n = { ...f }; delete n[shotId]; return n; });
      setRegenShotId(shotId);
      setRegenChild(res.child);
    } catch {
      setError("Couldn't prepare — please try again.");
    } finally {
      setBusy(false);
    }
  }

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
    if (started) startPolling();
    else setGenerating(false);
  }

  const shots = view.shots;
  const missingCount = shots.filter((s) => !s.firstFrameGenerationId).length;
  const bal = balanceUsd ?? 0;
  const affordAll = canAffordPack(totalCredits, bal);
  // Show the "Generate all" affordance only when idle (not editing, not confirming a regen).
  const showGenerateAll = missingCount > 0 && editing === null && regenShotId === null && !generating;

  return (
    <div className="gb leading-[1.65]" style={{ maxWidth: 480 }}>
      <div className="rounded-[18px] border border-border bg-secondary p-6">
        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
          <Film size={20} className="text-foreground" />
          <span className="font-bold text-[1rem] text-foreground">
            {view.storyboardTitle || "Storyboard"}
          </span>
        </div>

        {/* Shots */}
        {shots.length > 0 && (
          <div className="flex flex-col gap-2">
            {shots.map((shot) => {
              const isEditing = editing === shot.index;
              const frameUrl = frames[shot.shotId];
              const hasFrame = !!shot.firstFrameGenerationId;
              const shotPending = isPending(shot);
              const isRegenConfirm = regenShotId === shot.shotId;
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
                      {shotPending && !frameUrl && (
                        <div className="flex items-center gap-1 text-[0.75rem] text-muted-foreground">
                          <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> Generating first frame…
                        </div>
                      )}

                      {/* Per-shot regenerate (only when this shot already HAS a frame) */}
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
                          regenShotId === null && (
                            <div className="mt-1">
                              <Button variant="secondary" disabled={busy} onClick={() => void prepareRegen(shot.shotId)}>
                                <span className="flex items-center gap-1"><RotateCw size={13} /> Regenerate frame</span>
                              </Button>
                            </div>
                          )
                        )
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
                {!affordAll && (
                  <div role="alert" className="text-[0.875rem] text-[var(--error-soft-foreground)]">
                    Not enough credits — top up to generate these frames.
                  </div>
                )}
                <div className="text-[0.875rem] text-foreground">
                  Generate {children.filter((c) => !c.spent).length} {children.filter((c) => !c.spent).length === 1 ? "frame" : "frames"} for ~{creditsLabel(totalCredits)}? This will spend real credits.
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

        {generating && (
          <div className="mt-3 flex items-center gap-2 text-[0.875rem] text-muted-foreground">
            <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Generating first frames — this can take a moment…
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
