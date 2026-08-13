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
  /** #914 r2：这一单在我们自己拼装步骤之前长什么样（image-only）；null = 与 `prompt` 无分家。 */
  requestedPrompt: string | null;
  favorite: boolean;
  sourceGenerationId: string | null;
  /** #643 T2：这张图当初交付时的形状（快照，非像素反推）。老图读不到 ⇒ null。 */
  imageAspect: string | null;
};

type PanelState = "loading" | "ready" | "error";
type ConfirmAction = "regen" | "animate" | "edit" | "delete" | null;

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
  const imageCostLabel = imageCost == null ? "checking exact cost" : creditsLabel(imageCost);
  const videoCostLabel = videoCost == null ? "checking exact cost" : creditsLabel(videoCost);

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
    if (readOnly) return;
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
  }, [gen, generationId, targetProjectId, pollJob, reloadFromJob, readOnly, chosenImageAspect]);

  const handleAnimate = useCallback(async () => {
    if (readOnly) return;
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
  }, [gen, selectedGenId, targetProjectId, pollJob, videoSpec, reloadFromJob, readOnly]);

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

  const requestSpendConfirm = useCallback((action: Exclude<ConfirmAction, "delete" | null>) => {
    if (readOnly) return;
    setConfirmAction(action);
    void ensureModels();
  }, [readOnly]);

  const requestEditSubmit = useCallback(() => {
    if (readOnly) return;
    if (!editPrompt.trim() || editStatus === "running") return;
    setConfirmAction("edit");
    void ensureModels();
  }, [editPrompt, editStatus, readOnly]);

  const confirmDetails = (() => {
    switch (confirmAction) {
      case "regen":
        return {
          title: "Regenerate this image?",
          description: `Creates one new image version from the same prompt. Cost: ${imageCostLabel}. No charge until you confirm.`,
          confirmLabel: imageCost == null ? "Checking cost..." : "Regenerate",
          disabled: readOnly || imageCost == null || regenStatus === "running",
        };
      case "animate":
        return {
          title: "Animate this image?",
          description: `Creates one video from the selected image. Cost: ${videoCostLabel}. No charge until you confirm.`,
          confirmLabel: videoCost == null ? "Checking cost..." : "Animate",
          disabled: readOnly || videoCost == null || animStatus === "running",
        };
      case "edit":
        return {
          title: "Generate this edit?",
          description: `Uses the current image as the source for your edit. Cost: ${imageCostLabel}. No charge until you confirm.`,
          confirmLabel: imageCost == null ? "Checking cost..." : "Generate edit",
          disabled: readOnly || imageCost == null || editStatus === "running" || !editPrompt.trim(),
        };
      case "delete":
        return {
          title: "Delete this asset?",
          description: "This removes the selected generation from your library. A canvas card that uses it stays where it is and reads 'Preview missing'. This cannot be undone.",
          confirmLabel: "Delete",
          disabled: readOnly,
        };
      default:
        return null;
    }
  })();

  // Variant switcher: switch displayed url + persist pick
  const handleVariantPick = useCallback((idx: number) => {
    if (!gen) return;
    setSelectedIdx(idx);
    setFavoriteLocal(gen.variants[idx]?.favorite ?? gen.favorite);
    writePick(gen.id, idx);
  }, [gen]);

  // Edit @composer: submit an edit generation
  const handleEditSubmit = useCallback(async () => {
    if (readOnly) return;
    if (!gen || !editPrompt.trim() || editStatus === "running" || editBusyRef.current) return;
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
  }, [gen, editPrompt, editIds, editStatus, targetProjectId, pollJob, reloadFromJob, selectedGenId, readOnly, chosenImageAspect]);

  const runConfirmedAction = useCallback(() => {
    const action = confirmAction;
    setConfirmAction(null);
    if (readOnly) return;
    if (action === "regen") void handleRegen();
    if (action === "animate") void handleAnimate();
    if (action === "edit") void handleEditSubmit();
    if (action === "delete") void handleDelete();
  }, [confirmAction, handleAnimate, handleDelete, handleEditSubmit, handleRegen, readOnly]);

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

            {/* #914 r2(判官 r1 P1)图片回执:平台送出前对提示词做过的加工 —— 这是我们自己的
                数据，两端必然可知，不依赖引擎回不回执。r1 在这里恒定声明 "Sent exactly as you
                wrote it." —— 判官指出这不实:官方契约只证明「引擎不回报改写」，不证明「引擎
                不改写」，而且我们自己的拼装管线（coworkGenerate 的 composePrompt，给未配专属
                提示词技能的模型家族追加家族×模式指令词）确实会加工图片提示词。修法=按真实
                比对条件化：`gen.requestedPrompt`（拼装前，null = 与 `prompt` 无分家，见
                asset-actions.ts 的字段注释）与 `gen.prompt`（拼装后，平台真正送出的那句）
                逐字相同才说「原样」，不同就把 `gen.prompt` 整句亮出来 —— 商家看得到自己批的
                是哪一句、平台实际送出的又是哪一句。 */}
            {gen.kind === "image" && (() => {
              const requested = gen.requestedPrompt ?? gen.prompt;
              const sentAsIs = requested.trim() === gen.prompt.trim();
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--muted-foreground)" }}>
                    What we sent to the engine
                  </span>
                  <p style={{ margin: 0, fontSize: 14, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
                    {sentAsIs ? "Sent exactly as you wrote it." : gen.prompt}
                  </p>
                </div>
              );
            })()}

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

              {/* Regenerate */}
              {gen.kind === "image" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => requestSpendConfirm("regen")}
                  disabled={assetSpendControlDisabled(regenStatus, readOnly)}
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
                    : "Regenerate"}
                </Button>
              )}

              {/* Animate (image → video) */}
              {gen.kind === "image" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => requestSpendConfirm("animate")}
                  disabled={assetSpendControlDisabled(animStatus, readOnly)}
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
                    : "Animate"}
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
                      onSubmit={requestEditSubmit}
                    />
                  </div>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={requestEditSubmit}
                    disabled={assetSpendControlDisabled(editStatus, readOnly) || !editPrompt.trim()}
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
                      : "Send"}
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
