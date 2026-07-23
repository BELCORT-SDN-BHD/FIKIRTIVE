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
  startGen,
  getGenJob,
  getActiveGenModels,
  type ActiveGenModels,
} from "@/lib/gen-actions";
import { readPick, writePick } from "@/lib/result-pick";
import { Button, IcX, IcPlay, IcRetry } from "@/components/ds";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button as UiButton } from "@/components/ui/button";
import { MentionInput } from "@/components/MentionInput";
import { creditsLabel } from "@/lib/credit-format";
import type { EntityDTO } from "@/lib/types";

type GenDTO = {
  id: string;
  projectId: string;
  url: string;
  urls: string[];
  variants: { id: string; url: string; favorite: boolean }[]; // aligned to urls; carries each variant's own id/state (F08)
  kind: string;
  prompt: string;
  favorite: boolean;
  sourceGenerationId: string | null;
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

  // Aspect picker (17)
  const [chosenAspect, setChosenAspect] = useState<string>("");

  // Edit @composer (24)
  const [editPrompt, setEditPrompt] = useState("");
  const [editIds, setEditIds] = useState<string[]>([]);
  const [editStatus, setEditStatus] = useState<"idle" | "running" | "done" | "failed" | "timeout">("idle");
  const [composerKey, setComposerKey] = useState(() => String(Date.now()));

  // Crop (16)
  const [cropOpen, setCropOpen] = useState(false);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [cropStatus, setCropStatus] = useState<"idle" | "saving" | "done" | "failed">("idle");

  // Action states
  const [regenStatus, setRegenStatus] = useState<"idle" | "running" | "done" | "failed" | "timeout">("idle");
  const [animStatus, setAnimStatus] = useState<"idle" | "running" | "done" | "failed" | "timeout">("idle");
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
    const initialAspect =
      activeModels.videoDefaults.aspectRatio ||
      activeModels.videoAspectRatios[0] ||
      "";
    if (initialAspect) queueMicrotask(() => setChosenAspect((current) => current || initialAspect));
  }, [activeModels]);

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
  const videoCost = activeModels?.videoCredits ?? null;
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

  const pollJob = useCallback(async (jobId: string): Promise<"done" | "failed" | "timeout"> => {
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
      const { image } = await ensureModels(); // F18: server-resolved model
      const result = await startGen({
        projectId: targetProjectId,
        prompt: gen.prompt,
        count: 1,
        kind: "image",
        model: image,
        idempotencyKey: `regen-${generationId}-${Date.now()}`,
      });
      if ("error" in result) {
        setRegenStatus("failed");
        return;
      }
      const status = await pollJob(result.id);
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
  }, [gen, generationId, targetProjectId, pollJob, reloadFromJob, readOnly]);

  const handleAnimate = useCallback(async () => {
    if (readOnly) return;
    if (!gen || animBusyRef.current) return;
    animBusyRef.current = true;
    try {
      setAnimStatus("running");
      const models = await ensureModels();
      const vm = models.video;
      const vd = models.videoDefaults;
      // Use user's chosen aspect ratio if set; fall back to videoDefaults
      const effectiveAspect = chosenAspect || vd.aspectRatio;
      const result = await startGen({
        projectId: targetProjectId,
        prompt: gen.prompt,
        count: 1,
        kind: "video",
        model: vm,
        sourceGenerationId: selectedGenId,
        durationSeconds: vd.seconds,
        resolution: vd.resolution,
        audio: vd.audio,
        ...(effectiveAspect ? { aspectRatio: effectiveAspect } : {}),
        idempotencyKey: `anim-${selectedGenId}-${Date.now()}`,
      });
      if ("error" in result) {
        if (!cancelledRef.current) setAnimStatus("failed");
        return;
      }
      const status = await pollJob(result.id);
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
  }, [gen, selectedGenId, targetProjectId, pollJob, chosenAspect, reloadFromJob, readOnly]);

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
          description: "This removes the selected generation from your library and canvas views. This cannot be undone.",
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
      const { image } = await ensureModels(); // F18: server-resolved model
      const result = await startGen({
        projectId: targetProjectId,
        prompt: editPrompt.trim(),
        entityIds: editIds,
        count: 1,
        kind: "image",
        model: image,
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
      const status = await pollJob(result.id);
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
  }, [gen, editPrompt, editIds, editStatus, targetProjectId, pollJob, reloadFromJob, selectedGenId, readOnly]);

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

  // Aspect ratios for picker (only show if model has options) — F18: server-resolved model
  const aspectRatios = activeModels?.videoAspectRatios ?? [];

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
          <IcX size={17} />
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

            {/* Aspect picker (17): for image-to-video Animate when model has aspect ratios */}
            {gen.kind === "image" && aspectRatios.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--muted-foreground)", flexShrink: 0 }}>Aspect</span>
                <div className="al-seg" role="tablist" aria-label="Aspect ratio">
                  {aspectRatios.map((ar) => (
                    <button
                      key={ar}
                      role="tab"
                      type="button"
                      aria-selected={chosenAspect === ar}
                      className={`al-seg-item${chosenAspect === ar ? " al-seg-item-active" : ""}`}
                      disabled={readOnly}
                      title={readOnlyReason}
                      onClick={() => setChosenAspect(ar)}
                    >
                      {ar}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Action rail */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {/* Favorite */}
              <Button
                variant={favorite ? "primary" : "ghost"}
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
                  icon={<IcRetry size={14} />}
                  onClick={() => requestSpendConfirm("regen")}
                  disabled={readOnly || regenStatus === "running" || regenStatus === "timeout"}
                  title={readOnlyReason}
                >
                  {regenStatus === "running"
                    ? "Generating…"
                    : regenStatus === "done"
                    ? "New version ready"
                    : regenStatus === "timeout"
                    ? "Still processing — check the library"
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
                  icon={<IcPlay size={14} />}
                  onClick={() => requestSpendConfirm("animate")}
                  disabled={readOnly || animStatus === "running" || animStatus === "timeout"}
                  title={readOnlyReason}
                >
                  {animStatus === "running"
                    ? "Animating…"
                    : animStatus === "done"
                    ? "Video ready"
                    : animStatus === "timeout"
                    ? "Still processing — check the library"
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
                    variant="primary"
                    size="sm"
                    onClick={requestEditSubmit}
                    disabled={readOnly || editStatus === "running" || editStatus === "timeout" || !editPrompt.trim()}
                    title={readOnlyReason}
                  >
                    {editStatus === "running"
                      ? "Editing…"
                      : editStatus === "done"
                      ? "Edit ready!"
                      : editStatus === "timeout"
                      ? "Still processing — check the library"
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
                    variant="primary"
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
            <UiButton variant="ghost" onClick={() => setConfirmAction(null)}>Cancel</UiButton>
            <UiButton
              variant={confirmAction === "delete" ? "destructive" : "default"}
              disabled={confirmDetails?.disabled ?? true}
              onClick={runConfirmedAction}
            >
              {confirmDetails?.confirmLabel ?? "Confirm"}
            </UiButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
