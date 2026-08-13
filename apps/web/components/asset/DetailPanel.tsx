"use client";
/**
 * G2a · per-asset detail panel.
 * G2b adds: variant switcher (25), aspect picker (17), edit @composer (24), crop (16).
 * Opens as an absolute overlay inside the canvas container (not position:fixed).
 * Escape or click-on-backdrop closes; clicking the panel itself does not.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Cropper from "react-easy-crop";
import type { Area } from "react-easy-crop";
import { getGeneration } from "@/lib/asset-actions";
import { saveCroppedGeneration } from "@/lib/asset-actions";
import { setFavorite } from "@/lib/asset-actions";
import { deleteGeneration } from "@/lib/actions";
import {
  startAssetGen,
  getGenJob,
  getActiveGenModels,
  type ActiveGenModels,
} from "@/lib/gen-actions";
import { readPick, writePick } from "@/lib/result-pick";
import { notifyBalanceRefresh } from "@/lib/balance-refresh";
import { PlayIcon, RotateCcwIcon, XIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MentionInput } from "@/components/MentionInput";
import { ImageShapePicker } from "@/components/gen/ImageShapePicker";
import { VideoSpecPicker } from "@/components/gen/VideoSpecPicker";
import {
  clampVideoSpec,
  defaultVideoSpec,
  videoSpecCredits,
  videoSpecMenu as videoSpecMenuOf,
  type VideoSpec,
} from "@/lib/video-spec";
import { creditsLabel } from "@/lib/credit-format";
import { assetSpendControlDisabled, type AssetSpendStatus } from "@/lib/asset-detail-status";
import type { EntityDTO } from "@/lib/types";

type GenDTO = {
  id: string;
  projectId: string;
  url: string;
  urls: string[];
  // aligned to urls; carries each variant's own id/state (F08) and its OWN engine receipt (#776 r2)
  variants: { id: string; url: string; favorite: boolean; finalPrompt: string | null }[];
  kind: string;
  prompt: string;
  /** #776：被请求的那一行自己的「引擎真正跑的那句」。切换缩略图后要读 `variants[i].finalPrompt`。 */
  finalPrompt: string | null;
  /**
   * #914 r4：平台**实际交给引擎**的那一句（worker 在发送那一刻记的）。比对已在服务端做完
   * （asset-actions.sentPromptReceipt）：null = 这一行不是一次引擎调用的产物（历史生成，
   * 或上传/裁剪这类没调过引擎的行）⇒ 整块不渲染，一个字不说。
   */
  sentPrompt: null | { verbatim: true } | { verbatim: false; text: string };
  favorite: boolean;
  sourceGenerationId: string | null;
  /** #643 T2：这张图当初交付时的形状（快照，非像素反推）。老图读不到 ⇒ null。 */
  imageAspect: string | null;
};

type PanelState = "loading" | "ready" | "error";
/** #896 — the only thing left that asks twice is DELETE. The three paid actions
 *  (Regenerate / Animate / Generate edit) now follow the canvas rule: the price is on the
 *  button, the press does it, and a button whose quote hasn't landed is off. Deleting is a
 *  different kind of act — it is irreversible and it isn't a purchase — so V16's confirm stays. */
type ConfirmAction = "delete" | null;

/** Render the cropped area of an image to a canvas and return a data URL. */
async function getCroppedDataUrl(
  imageSrc: string,
  pixelCrop: Area,
): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = imageSrc;
  });
  const canvas = document.createElement("canvas");
  canvas.width = pixelCrop.width;
  canvas.height = pixelCrop.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(
    img,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    pixelCrop.width,
    pixelCrop.height,
  );
  return canvas.toDataURL("image/png");
}

export default function DetailPanel({
  generationId,
  projectId,
  onClose,
  entities = [],
  readOnlyReason,
}: {
  generationId: string;
  projectId: string;
  onClose: () => void;
  entities?: EntityDTO[];
  readOnlyReason?: string;
}) {
  const readOnly = !!readOnlyReason;
  const [state, setState] = useState<PanelState>("loading");
  const [gen, setGen] = useState<GenDTO | null>(null);
  const [favorite, setFavoriteLocal] = useState(false);

  // Variant switcher (25)
  const [selectedIdx, setSelectedIdx] = useState(0);

  // #645 T4 — the VIDEO spec (length / quality / shape), used by Animate only. Animate always
  // starts from THIS image, so the shape seeds to Adaptive: the engine follows the source frame
  // rather than being told a ratio it would have to crop or pad to.
  const [videoSpec, setVideoSpec] = useState<VideoSpec | null>(null);
  // #643 T2 —— the IMAGE shape, used by Regenerate and by the edit composer. Seeded from the
  // shape this very image was delivered in, so "do it again" / "edit this" keep the shape by
  // default; the merchant can pick another one and what is on screen is what gets made.
  const [chosenImageAspect, setChosenImageAspect] = useState<string>("");

  // Edit @composer (24)
  const [editPrompt, setEditPrompt] = useState("");
  const [editIds, setEditIds] = useState<string[]>([]);
  const [editStatus, setEditStatus] = useState<AssetSpendStatus>("idle");
  const [composerKey, setComposerKey] = useState(() => String(Date.now()));

  // Crop (16)
  const [cropOpen, setCropOpen] = useState(false);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [cropStatus, setCropStatus] = useState<"idle" | "saving" | "done" | "failed">("idle");

  // Action states
  const [regenStatus, setRegenStatus] = useState<AssetSpendStatus>("idle");
  const [animStatus, setAnimStatus] = useState<AssetSpendStatus>("idle");
  const [copied, setCopied] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const regenBusyRef = useRef(false);
  const animBusyRef = useRef(false);
  const editBusyRef = useRef(false);

  const cancelledRef = useRef(false);
  // Fetch opaque active capability ids, exact quotes, and video controls once. Spend handlers
  // await this server-derived contract; provider-backed model ids stay server-side.
  const [activeModels, setActiveModels] = useState<ActiveGenModels | null>(null);
  const modelsRef = useRef<ActiveGenModels | null>(null);
  const ensureModels = async () => {
    if (!modelsRef.current) modelsRef.current = await getActiveGenModels();
    setActiveModels(modelsRef.current);
    return modelsRef.current;
  };
  useEffect(() => { void ensureModels(); }, []);

  useEffect(() => {
    cancelledRef.current = false;
    queueMicrotask(() => {
      if (cancelledRef.current) return;
      setState("loading");
      setGen(null);
      setSelectedIdx(0);
      setCropOpen(false);
      setEditStatus("idle");
    });
    getGeneration(generationId).then((result) => {
      if (cancelledRef.current) return;
      if ("error" in result) {
        setState("error");
        return;
      }
      setGen(result);
      setFavoriteLocal(result.favorite);
      setState("ready");

      // Restore persisted variant pick
      const saved = readPick(result.id);
      if (saved !== null && saved < result.urls.length) {
        setSelectedIdx(saved);
      }

    });
    return () => {
      cancelledRef.current = true;
    };
  }, [generationId]);

  useEffect(() => {
    if (!activeModels) return;
    // 带首帧的那条路(Animate)⇒ 形状默认 Adaptive。菜单与默认档都来自服务端解析。
    const initial = defaultVideoSpec(activeModels, { hasSourceImage: true });
    queueMicrotask(() => setVideoSpec((current) => current ?? initial));
  }, [activeModels]);

  // #643 T2：图片形状的种子 = 这张图**当初交付时的形状**（快照，不是从像素反推）；
  // 快照读不到（T1 之前的老图）就用服务端的默认形状 —— 那正是那些老图当年真的形状。
  // 换看另一张图（gen.id 变了）就重新播种，不把上一张的形状带过来。
  useEffect(() => {
    if (!activeModels) return;
    const seed = gen?.imageAspect || activeModels.imageDefaultAspect;
    if (seed) queueMicrotask(() => setChosenImageAspect(seed));
  }, [activeModels, gen?.id, gen?.imageAspect]);

  // Clear edit composer on generation change
  useEffect(() => {
    queueMicrotask(() => {
      setEditPrompt("");
      setEditIds([]);
      setComposerKey(String(Date.now()));
    });
  }, [gen?.id]);

  useEffect(() => {
    if (!gen) return;
    queueMicrotask(() => setFavoriteLocal(gen.variants[selectedIdx]?.favorite ?? gen.favorite));
  }, [gen, selectedIdx]);

  // Esc key
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (cropOpen) { setCropOpen(false); return; }
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, cropOpen]);

  // The generation the user is actually LOOKING AT — the selected variant, not the primary
  // prop. All mutate/spend handlers act on this so a sibling variant isn't animated/deleted/
  // starred/edited against the wrong image (F08/F09). Still an owned id resolved server-side.
  const selectedGenId = gen ? (gen.variants[selectedIdx]?.id ?? gen.id) : generationId;
  const targetProjectId = gen?.projectId ?? projectId;
  const imageCost = activeModels?.imageCredits ?? null;
  // #645 T4：视频按档计价，所以这里报的必须是**选中那一档**的价（服务端那张按档价目表），
  // 不是默认档的价 —— 显示一个价、扣另一个价是这条线上最贵的一类缺陷。
  const videoCost = activeModels
    ? (videoSpec ? videoSpecCredits(activeModels, videoSpec) : activeModels.videoCredits)
    : null;

  // #896 r2 P0-a —— 每条付费路一道闸,**控件与动作读同一个布尔值**。
  // 之前闸只装在按钮的 disabled 上:编辑框的 Shift/Cmd/Ctrl+Enter 直接进 handleEditSubmit,
  // 报价还没回来也照跑 —— 它自己 await 一次 ensureModels() 再发付费请求,于是商家在屏幕上
  // 从没见过那个价就被扣了钱。按钮变灰是**提示**,不是闸;闸必须在动作入口,这样按钮、
  // 快捷键、以及以后任何新入口都同样 fail closed(关类不补例)。
  const regenBlocked = assetSpendControlDisabled(regenStatus, readOnly) || imageCost == null;
  const animateBlocked = assetSpendControlDisabled(animStatus, readOnly) || videoCost == null;
  const editBlocked =
    assetSpendControlDisabled(editStatus, readOnly) || !editPrompt.trim() || imageCost == null;

  const handleFavorite = useCallback(async () => {
    if (readOnly) return;
    if (!gen) return;
    const targetGenId = selectedGenId;
    const next = !favorite;
    const applyLocal = (value: boolean) => {
      setFavoriteLocal(value);
      setGen((prev) => prev
        ? {
            ...prev,
            favorite: prev.id === targetGenId ? value : prev.favorite,
            variants: prev.variants.map((variant) => (
              variant.id === targetGenId ? { ...variant, favorite: value } : variant
            )),
          }
        : prev);
    };
    applyLocal(next); // optimistic
    const result = await setFavorite(targetGenId, next);
    if ("error" in result) applyLocal(!next); // revert
  }, [gen, favorite, selectedGenId, readOnly]);

  const pollJob = useCallback(async (jobId: string): Promise<"done" | "failed" | "cancelled" | "timeout"> => {
    // ~8 min at 2.5s — mirrors the canvas poll() window (useCanvasGen.ts). Video gens can
    // legitimately exceed the old ~4-min cap; the worker settles late jobs regardless of this
    // client poll. A client-side give-up is a "timeout" (still working), NOT a "failed": surfacing
    // it as failed invites a retry, and regen/animate/edit mint a fresh idempotencyKey per click →
    // a second real charge on a job that's still running.
    for (let i = 0; i < 192; i++) {
      if (cancelledRef.current) return "timeout";
      const job = await getGenJob(jobId);
      if (!job) return "failed";
      if (job.status === "DONE") return "done";
      if (job.status === "FAILED") return "failed";
      // A cancel is its own ending, not a failure (#602 T3 · r2 judge P2). It stops the poll —
      // before, CANCELLED was unrecognised here and this loop ran its full ~8-minute budget on a
      // job that had already stopped — and it gets its own word, so the button that comes back
      // does not say "Failed — retry?" about something the merchant chose to stop.
      if (job.status === "CANCELLED") return "cancelled";
      await new Promise((r) => setTimeout(r, 2500));
    }
    return "timeout";
  }, []);

  // After a job completes, resolve its new generation id and load it into the panel
  // (so a paid regen/animate/edit result is visible here, not only in Library).
  const reloadFromJob = useCallback(async (jobId: string) => {
    const job = await getGenJob(jobId);
    const newId = job?.generationIds?.[0];
    if (!newId) return;
    setState("loading");
    setGen(null);
    const r = await getGeneration(newId);
    if (cancelledRef.current) return;
    if (!r || "error" in r) { setState("error"); return; }
    setGen(r);
    setFavoriteLocal(r.favorite);
    setSelectedIdx(0);
    setState("ready");
  }, []);

  const handleRegen = useCallback(async () => {
    if (regenBlocked) return;
    if (!gen || regenBusyRef.current) return;
    regenBusyRef.current = true;
    try {
      setRegenStatus("running");
      const models = await ensureModels(); // F18: server-resolved model
      // #643 T2：形状是屏幕上正显示的那一格 —— 重做一张不会悄悄换掉形状。
      const aspectRatio = chosenImageAspect || gen.imageAspect || models.imageDefaultAspect;
      // #645 T4(判官 r1 P0-2)：同 Animate —— 屏幕上那个价随请求发出去，服务端重核。
      const result = await startAssetGen({
        expectedCredits: models.imageCredits,
        projectId: targetProjectId,
        prompt: gen.prompt,
        count: 1,
        kind: "image",
        model: models.image,
        ...(aspectRatio ? { aspectRatio } : {}),
        idempotencyKey: `regen-${generationId}-${Date.now()}`,
      });
      if ("error" in result) {
        setRegenStatus("failed");
        return;
      }
      // The hold is on the ledger the moment startGen accepts, and the settle/refund
      // lands when the job resolves — announce both so the global nav's credits figure
      // moves with the money instead of waiting for a page reload (#550). Same two-point
      // pattern the canvas generations already use (useCanvasGen's onBalanceRefresh).
      notifyBalanceRefresh();
      const status = await pollJob(result.id);
      notifyBalanceRefresh();
      if (!cancelledRef.current) {
        setRegenStatus(status);
        // A timeout means the paid job is STILL RUNNING (the worker settles it late) — keep the
        // "still processing" state so the control never reverts to an inviting "Regenerate" whose
        // re-click mints a NEW idempotencyKey = a second charge. done/failed reset to idle (a real
        // failure is refunded, so retrying it is safe).
        if (status !== "timeout") {
          setTimeout(() => { if (!cancelledRef.current) setRegenStatus("idle"); }, 3000);
        }
      }
      if (status === "done") await reloadFromJob(result.id);
    } finally {
      regenBusyRef.current = false;
    }
  }, [gen, generationId, targetProjectId, pollJob, reloadFromJob, regenBlocked, chosenImageAspect]);

  const handleAnimate = useCallback(async () => {
    if (animateBlocked) return;
    if (!gen || animBusyRef.current) return;
    animBusyRef.current = true;
    try {
      setAnimStatus("running");
      const models = await ensureModels();
      const vm = models.video;
      const vd = models.videoDefaults;
      // #645 T4：发出去的就是选择器上显示的那一档 —— 规格夹回菜单，夹不住就回默认档
      // （绝不把一个菜单外的值送进付费请求）。没有选择器时按服务端默认档交付。
      const spec = clampVideoSpec(models, videoSpec ?? undefined, { hasSourceImage: true });
      // #645 T4(判官 r1 P0-2)：屏幕上那个价是商家授权的一部分，所以它随请求一起发出去。
      // 服务端自己算一遍，不符就在扣款前拒绝 —— 与 Canvas / Otto 同一套绑定。
      const quoted = videoSpecCredits(models, spec);
      if (quoted == null) { if (!cancelledRef.current) setAnimStatus("failed"); return; }
      const result = await startAssetGen({
        expectedCredits: quoted,
        projectId: targetProjectId,
        prompt: gen.prompt,
        count: 1,
        kind: "video",
        model: vm,
        sourceGenerationId: selectedGenId,
        durationSeconds: spec.seconds,
        resolution: spec.resolution,
        audio: vd.audio,
        ...(spec.aspectRatio ? { aspectRatio: spec.aspectRatio } : {}),
        idempotencyKey: `anim-${selectedGenId}-${Date.now()}`,
      });
      if ("error" in result) {
        if (!cancelledRef.current) setAnimStatus("failed");
        return;
      }
      notifyBalanceRefresh();
      const status = await pollJob(result.id);
      notifyBalanceRefresh();
      if (!cancelledRef.current) {
        setAnimStatus(status);
        // Timeout ⇒ the paid video job is still running (worker settles late ones) — stay in
        // "still processing" so a re-click can't fire a second charge. See handleRegen.
        if (status !== "timeout") {
          setTimeout(() => { if (!cancelledRef.current) setAnimStatus("idle"); }, 3000);
        }
      }
      if (status === "done") await reloadFromJob(result.id);
    } finally {
      animBusyRef.current = false;
    }
  }, [gen, selectedGenId, targetProjectId, pollJob, videoSpec, reloadFromJob, animateBlocked]);

  const handleCopyLink = useCallback(async () => {
    if (!gen) return;
    const url = gen.urls[selectedIdx] ?? gen.url;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => { if (!cancelledRef.current) setCopied(false); }, 2000);
    } catch {
      // silently ignore clipboard errors
    }
  }, [gen, selectedIdx]);

  const handleDelete = useCallback(async () => {
    if (readOnly) return;
    await deleteGeneration(selectedGenId);
    onClose();
  }, [selectedGenId, onClose, readOnly]);

  const confirmDetails = confirmAction === "delete"
    ? {
        title: "Delete this asset?",
        description: "This removes the selected generation from your library. A canvas card that uses it stays where it is and reads 'Preview missing'. This cannot be undone.",
        confirmLabel: "Delete",
        disabled: readOnly,
      }
    : null;

  // Variant switcher: switch displayed url + persist pick
  const handleVariantPick = useCallback((idx: number) => {
    if (!gen) return;
    setSelectedIdx(idx);
    setFavoriteLocal(gen.variants[idx]?.favorite ?? gen.favorite);
    writePick(gen.id, idx);
  }, [gen]);

  // Edit @composer: submit an edit generation
  const handleEditSubmit = useCallback(async () => {
    // The gate, not the button. This handler is reachable from the composer's
    // Shift/Cmd/Ctrl+Enter as well as from the priced button beside it, and both ways in
    // must refuse on exactly the same terms — no quote on screen, no spend (#896 r2 P0-a).
    if (editBlocked) return;
    if (!gen || editBusyRef.current) return;
    editBusyRef.current = true;
    try {
      setEditStatus("running");
      const models = await ensureModels(); // F18: server-resolved model
      // #643 T2：编辑同样交付屏幕上显示的那一格。服务端在没收到形状时会按底图快照继承，
      // 这里显式带上是为了让「屏幕上写的」与「引擎收到的」永远是同一个值。
      const aspectRatio = chosenImageAspect || gen.imageAspect || models.imageDefaultAspect;
      // #645 T4(判官 r1 P0-2)：编辑框也显示价格，所以它同样带绑定。
      const result = await startAssetGen({
        expectedCredits: models.imageCredits,
        projectId: targetProjectId,
        prompt: editPrompt.trim(),
        entityIds: editIds,
        count: 1,
        kind: "image",
        model: models.image,
        ...(aspectRatio ? { aspectRatio } : {}),
        // F09: condition the edit on the image the user is actually viewing (the selected
        // variant), so a paid "edit this" result relates to the displayed image instead of
        // being an unconditioned fresh generation. Owned id resolved server-side (D19).
        sourceGenerationId: selectedGenId,
        idempotencyKey: `edit-${selectedGenId}-${Date.now()}`,
      });
      if ("error" in result) {
        if (!cancelledRef.current) setEditStatus("failed");
        return;
      }
      notifyBalanceRefresh();
      const status = await pollJob(result.id);
      notifyBalanceRefresh();
      if (!cancelledRef.current) {
        setEditStatus(status);
        // Timeout ⇒ the paid edit job is still running — stay in "still processing" so a re-click
        // can't fire a second charge. See handleRegen.
        if (status !== "timeout") {
          setTimeout(() => { if (!cancelledRef.current) setEditStatus("idle"); }, 3000);
        }
      }
      if (status === "done") await reloadFromJob(result.id);
    } finally {
      editBusyRef.current = false;
    }
  }, [gen, editPrompt, editIds, editBlocked, targetProjectId, pollJob, reloadFromJob, selectedGenId, chosenImageAspect]);

  const runConfirmedAction = useCallback(() => {
    setConfirmAction(null);
    if (readOnly) return;
    void handleDelete();
  }, [handleDelete, readOnly]);

  // Crop: confirm crop and save
  const handleCropConfirm = useCallback(async () => {
    if (readOnly) return;
    if (!gen || !croppedAreaPixels) return;
    const srcUrl = gen.urls[selectedIdx] ?? gen.url;
    setCropStatus("saving");
    let dataUrl: string;
    try {
      dataUrl = await getCroppedDataUrl(srcUrl, croppedAreaPixels);
    } catch {
      if (!cancelledRef.current) setCropStatus("failed");
      return;
    }
    const result = await saveCroppedGeneration(selectedGenId, dataUrl);
    if ("error" in result) {
      if (!cancelledRef.current) setCropStatus("failed");
      return;
    }
    // Close crop modal; reload panel with new generation id
    if (!cancelledRef.current) {
      setCropOpen(false);
      setCropStatus("idle");
      // Reload panel to new cropped generation
      // (parent passes generationId as key; we call getGeneration with the new id)
      setState("loading");
      setGen(null);
      getGeneration(result.id).then((r) => {
        if (cancelledRef.current) return;
        if ("error" in r) { setState("error"); return; }
        setGen(r);
        setFavoriteLocal(r.favorite);
        setSelectedIdx(0);
        setState("ready");
      });
    }
  }, [gen, croppedAreaPixels, selectedIdx, selectedGenId, readOnly]);

  // Compute active URL to display
  const displayUrl = gen ? (gen.urls[selectedIdx] ?? gen.url) : null;

  // #645 T4：视频规格菜单（只在模型暴露时渲染）— F18: server-resolved model
  const videoSpecMenu = activeModels ? videoSpecMenuOf(activeModels) : null;
  const imageAspectRatios = activeModels?.imageAspectRatios ?? [];

  return (
    // Faux-viewport overlay — absolute inside the canvas container, not fixed
    <div
      onClick={cropOpen ? undefined : onClose}
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(20,20,24,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
    >
      {/* Panel card — click stops propagation so backdrop click still works */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="al-panel cv-detail"
        style={{
          position: "relative",
          width: 520,
          maxWidth: "90%",
          maxHeight: "85%",
          overflowY: "auto",
          borderRadius: 20,
          padding: 22,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          aria-label="Close detail panel"
          className="al-iconbtn al-iconbtn-md"
          style={{ position: "absolute", top: 12, right: 12 }}
        >
          <XIcon size={17} />
        </button>

        {/* Content */}
        {state === "loading" && (
          <div style={{ minHeight: 200, display: "grid", placeItems: "center", opacity: 0.5 }}>
            Loading…
          </div>
        )}

        {state === "error" && (
          <div style={{ minHeight: 200, display: "grid", placeItems: "center", color: "var(--error)" }}>
            Could not load this asset.
          </div>
        )}

        {state === "ready" && gen && displayUrl && (
          <>
            {/* Media preview */}
            <div style={{ borderRadius: 14, overflow: "hidden", background: "var(--muted)", lineHeight: 0 }}>
              {gen.kind === "video" ? (
                <video
                  key={displayUrl}
                  src={displayUrl}
                  controls
                  playsInline
                  preload="metadata"
                  style={{ width: "100%", maxHeight: 340, objectFit: "contain" }}
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={displayUrl}
                  alt={gen.prompt}
                  style={{ width: "100%", maxHeight: 340, objectFit: "contain" }}
                />
              )}
            </div>

            {/* Variant switcher (25): thumbnail strip when multiple urls */}
            {gen.urls.length > 1 && (
              <div
                role="listbox"
                aria-label="Variant thumbnails"
                style={{ display: "flex", gap: 9, overflowX: "auto", paddingBottom: 2 }}
              >
                {gen.urls.map((u, i) => (
                  <button
                    key={u}
                    role="option"
                    aria-selected={i === selectedIdx}
                    onClick={() => handleVariantPick(i)}
                    style={{
                      flex: "none",
                      width: 62,
                      height: 62,
                      padding: 0,
                      border: `${i === selectedIdx ? "2px" : "1px"} solid ${i === selectedIdx ? "var(--brand)" : "var(--border)"}`,
                      borderRadius: 10,
                      overflow: "hidden",
                      cursor: "pointer",
                      background: "var(--muted)",
                      opacity: i === selectedIdx ? 1 : 0.55,
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={u}
                      alt={`Variant ${i + 1}`}
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                  </button>
                ))}
              </div>
            )}

            {/* Prompt text */}
            {gen.prompt && (
              <p style={{ margin: 0, fontSize: 14, color: "var(--muted-foreground)", lineHeight: 1.5 }}>{gen.prompt}</p>
            )}

            {/* #776/#914 生成回执 —— 引擎自报「它真正跑的那句话」，只有视频契约会给这个字段
                （官方 Image 响应结构没有 revised_prompt，参见 packages/core/src/refgen.ts 的
                GenerationReceipt 注释）；图片这条路上它恒为未知，不是「这次没报」。

                #914（Founder 裁决 2026-08-13，市调见 #909）：图片这一整行**永不出现**，不分
                「有 / 无」两种形状 —— 旧版 "Not reported by the engine." 曾经在图片这条路上
                永远显示，那不是诚实报告未知，是一个字段模板在填不上时自己编的句子（通行做法：
                有则显示、无则整行不出现，Ideogram / Adobe 同款）。商家想知道「这台引擎会不会
                自己改写我的话」，去选引擎的位置（ImageShapePicker / VideoSpecPicker）看一次
                静态能力说明就够了，不必每张图重复念一遍。视频这条路上这一行**行为不变**，r2
                判官的五条纪律原样保留：未知也要说出口、读这一张自己的那句、一模一样就只说
                一句、供应商指纹词已在服务端滤掉。
                样式沿用本面板既有的内联写法；这一面的 shadcn 化属于 #840 的界面族拆分。 */}
            {gen.kind === "video" && (() => {
              // 回退只在「这一张根本不在列表里」时发生（与 displayUrl 同一套），**不是**在
              // 「这一张的值是 null」时发生 —— 后者正是要显示的答案。写成 `?.finalPrompt ??`
              // 的话，第二张没报就会悄悄继承第一张那一句，也就是判官点的那个串台。
              const selectedVariant = gen.variants[selectedIdx];
              // `?? null`：读不到这个字段（老的调用点、老的 DTO）与「引擎没报」是同一件事 ——
              // 未知。归一成 null，下面只需要判一种「不知道」。
              const shownFinalPrompt = (selectedVariant ? selectedVariant.finalPrompt : gen.finalPrompt) ?? null;
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--muted-foreground)" }}>
                    What the engine ran
                  </span>
                  <p style={{ margin: 0, fontSize: 14, color: "var(--muted-foreground)", lineHeight: 1.5, ...(shownFinalPrompt ? {} : { fontStyle: "italic" }) }}>
                    {shownFinalPrompt === null
                      ? "Not reported by the engine."
                      : shownFinalPrompt.trim() === gen.prompt.trim()
                        ? "Your prompt, exactly as you wrote it."
                        : shownFinalPrompt}
                  </p>
                </div>
              );
            })()}

            {/* #914 r4(判官 r3)图片回执:**我们自己**把哪一句交给了引擎 —— 不问引擎要,
                所以图片这条路上也答得出来。事实由 worker 在调用引擎那一刻记下(所有花钱
                入口唯一的汇合点，而且提示词到那时才拼完:#774 的参考图编号句是 worker 现
                产的)，比对在服务端一次做完（asset-actions.sentPromptReceipt）。

                r2/r3 的病根:记录点在 web 层 —— 记下的永远不是真正送出去的全文，于是
                「原样送出」这句话在模板一键成片这类必带底图的单上必然是谎。r4 把记录点
                搬到真实发送层，这里只负责显示服务端已经比完的结论:
                  · null（这一行不是引擎产的：历史生成，或上传/裁剪这类 $0 摄取行）⇒
                    **整块不渲染**，一个字都不说；
                  · 逐字相同 ⇒ 一句 "Sent exactly as you wrote it."；
                  · 不同     ⇒ 把实际送出的全文亮出来（已过白标）。 */}
            {/* `!= null` 而不是 `!== null`:字段整个读不到(老的调用点 / 老的 DTO)与「没有
                这条记录」是同一件事 —— 两种都往「什么都不说」那一边倒,与服务端
                sentPromptReceipt 的同一条纪律对齐。 */}
            {gen.kind === "image" && gen.sentPrompt != null && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--muted-foreground)" }}>
                  What we sent to the engine
                </span>
                <p style={{ margin: 0, fontSize: 14, color: "var(--muted-foreground)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                  {gen.sentPrompt.verbatim ? "Sent exactly as you wrote it." : gen.sentPrompt.text}
                </p>
              </div>
            )}

            {/* #643 T2 — Image shape: what Regenerate and the edit composer below will deliver.
                Seeded from the shape this image was made in, so neither one silently reshapes it.
                Same cost in every shape. */}
            {gen.kind === "image" && imageAspectRatios.length > 0 && chosenImageAspect && (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--muted-foreground)", flexShrink: 0 }}>Image shape</span>
                <ImageShapePicker
                  compact
                  label="Image shape"
                  value={chosenImageAspect}
                  options={imageAspectRatios}
                  onChange={setChosenImageAspect}
                  disabled={readOnly}
                  title="The shape a new image made here will have — same cost in every shape"
                />
              </div>
            )}

            {/* Video spec (#645 T4): length, quality and shape of the clip Animate will make.
                Labelled apart from the image shape above so the two shape controls on one panel
                cannot be confused for each other (#643 T2). The shape defaults to Adaptive —
                Animate always starts from this image, so the engine follows it rather than
                being told a ratio. The price below follows the chosen spec. */}
            {gen.kind === "image" && videoSpec && videoSpecMenu && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--muted-foreground)", flexShrink: 0 }}>Video spec</span>
                <VideoSpecPicker
                  compact
                  value={videoSpec}
                  menu={videoSpecMenu}
                  onChange={setVideoSpec}
                  disabled={readOnly}
                  hasSourceImage
                />
              </div>
            )}

            {/* Action rail */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {/* Favorite */}
              <Button
                variant={favorite ? "default" : "ghost"}
                size="sm"
                onClick={handleFavorite}
                disabled={readOnly}
                title={readOnlyReason}
              >
                {favorite ? "♥ Saved" : "♡ Save"}
              </Button>

              {/* Regenerate — #896: the canvas rule. The price is on the button, the press
                  does it, and until the server quote lands the button says so and is off. */}
              {gen.kind === "image" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleRegen()}
                  disabled={regenBlocked}
                  title={readOnlyReason}
                >
                  <RotateCcwIcon />
                  {regenStatus === "running"
                    ? "Generating…"
                    : regenStatus === "done"
                    ? "New version ready"
                    : regenStatus === "timeout"
                    ? "Still processing — check the library"
                    : regenStatus === "cancelled"
                    ? "Cancelled"
                    : regenStatus === "failed"
                    ? "Failed — retry?"
                    : imageCost == null
                    ? "Checking cost…"
                    : `Regenerate · ${creditsLabel(imageCost)}`}
                </Button>
              )}

              {/* Animate (image → video) — priced from the spec chosen above, so the number on
                  the button follows the picker rather than a stale default tier (#645 T4). */}
              {gen.kind === "image" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleAnimate()}
                  disabled={animateBlocked}
                  title={readOnlyReason}
                >
                  <PlayIcon />
                  {animStatus === "running"
                    ? "Animating…"
                    : animStatus === "done"
                    ? "Video ready"
                    : animStatus === "timeout"
                    ? "Still processing — check the library"
                    : animStatus === "cancelled"
                    ? "Cancelled"
                    : animStatus === "failed"
                    ? "Failed — retry?"
                    : videoCost == null
                    ? "Checking cost…"
                    : `Animate · ${creditsLabel(videoCost)}`}
                </Button>
              )}

              {/* Crop (16) */}
              {gen.kind === "image" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setCrop({ x: 0, y: 0 }); setZoom(1); setCropStatus("idle"); setCropOpen(true); }}
                  disabled={readOnly}
                  title={readOnlyReason}
                >
                  Crop
                </Button>
              )}

              {/* Download */}
              <a
                href={displayUrl}
                download
                className="al-btn al-btn-secondary al-btn-sm"
                style={{ textDecoration: "none" }}
              >
                Download
              </a>

              {/* Copy link */}
              <Button variant="ghost" size="sm" onClick={handleCopyLink}>
                {copied ? "Copied!" : "Copy link"}
              </Button>

              {/* Delete */}
              <Button variant="ghost" size="sm" onClick={() => { if (!readOnly) setConfirmAction("delete"); }} disabled={readOnly} title={readOnlyReason}>
                Delete
              </Button>
            </div>

            {/* Edit @composer (24) */}
            {gen.kind === "image" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid var(--border)", padding: "13px 16px" }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: "var(--muted-foreground)" }}>Describe your edit, @ to reference</span>
                <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                  <div className="al-input-wrap" style={{ flex: 1, minWidth: 0, border: "1.5px solid var(--border)", borderRadius: 12, padding: "5px 5px 5px 12px" }}>
                    <MentionInput
                      entities={entities}
                      docKey={composerKey}
                      placeholder="Describe your edit, @ to reference"
                      disabled={readOnly || editStatus === "running"}
                      onChange={(text, ids) => {
                        if (readOnly) return;
                        setEditPrompt(text);
                        setEditIds(ids);
                      }}
                      onSubmit={() => void handleEditSubmit()}
                    />
                  </div>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => void handleEditSubmit()}
                    disabled={editBlocked}
                    title={readOnlyReason}
                  >
                    {editStatus === "running"
                      ? "Editing…"
                      : editStatus === "done"
                      ? "Edit ready!"
                      : editStatus === "timeout"
                      ? "Still processing — check the library"
                      : editStatus === "cancelled"
                      ? "Cancelled"
                      : editStatus === "failed"
                      ? "Failed"
                      : imageCost == null
                      ? "Checking cost…"
                      : `Generate edit · ${creditsLabel(imageCost)}`}
                  </Button>
                </div>
              </div>
            )}

            {/* Crop modal (16) — normal-flow overlay inside panel, NOT position:fixed */}
            {cropOpen && !readOnly && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "rgba(0,0,0,0.85)",
                  borderRadius: 16,
                  zIndex: 10,
                  display: "flex",
                  flexDirection: "column",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Crop area — takes remaining space */}
                <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
                  <Cropper
                    image={displayUrl}
                    crop={crop}
                    zoom={zoom}
                    onCropChange={setCrop}
                    onZoomChange={setZoom}
                    onCropComplete={(_croppedArea, croppedAreaPx) => {
                      setCroppedAreaPixels(croppedAreaPx);
                    }}
                  />
                </div>
                {/* Crop controls */}
                <div style={{ display: "flex", gap: 8, padding: 16, justifyContent: "flex-end", background: "rgba(0,0,0,.4)" }}>
                  {cropStatus === "failed" && (
                    <span style={{ fontSize: 12, color: "var(--error)", alignSelf: "center", marginRight: "auto" }}>
                      Crop failed — try again
                    </span>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => setCropOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={handleCropConfirm}
                    disabled={readOnly || cropStatus === "saving"}
                  >
                    {cropStatus === "saving" ? "Saving…" : "Confirm crop"}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      <Dialog open={confirmAction !== null} onOpenChange={(open) => { if (!open) setConfirmAction(null); }}>
        <DialogContent onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>{confirmDetails?.title ?? ""}</DialogTitle>
            <DialogDescription>{confirmDetails?.description ?? ""}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmAction(null)}>Cancel</Button>
            <Button
              variant={confirmAction === "delete" ? "destructive" : "default"}
              disabled={confirmDetails?.disabled ?? true}
              onClick={runConfirmedAction}
            >
              {confirmDetails?.confirmLabel ?? "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
