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
import { startGen, getGenJob } from "@/lib/gen-actions";
import { readPick, writePick } from "@/lib/result-pick";
import {
  activeImageModel,
  activeVideoModel,
  videoDefaults,
  GEN_VIDEO_MODEL_OPTIONS,
  type GenVideoModel,
} from "@fikirtive/core";
import { Button, IcX, IcPlay, IcRetry } from "@/components/ds";
import { MentionInput } from "@/components/MentionInput";
import type { EntityDTO } from "@/lib/types";

type GenDTO = {
  id: string;
  url: string;
  urls: string[];
  kind: string;
  prompt: string;
  favorite: boolean;
  sourceGenerationId: string | null;
};

type PanelState = "loading" | "ready" | "error";

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
}: {
  generationId: string;
  projectId: string;
  onClose: () => void;
  entities?: EntityDTO[];
}) {
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
  const [editStatus, setEditStatus] = useState<"idle" | "running" | "done" | "failed">("idle");
  const [composerKey, setComposerKey] = useState(() => String(Date.now()));

  // Crop (16)
  const [cropOpen, setCropOpen] = useState(false);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [cropStatus, setCropStatus] = useState<"idle" | "saving" | "done" | "failed">("idle");

  // Action states
  const [regenStatus, setRegenStatus] = useState<"idle" | "running" | "done" | "failed">("idle");
  const [animStatus, setAnimStatus] = useState<"idle" | "running" | "done" | "failed">("idle");
  const [copied, setCopied] = useState(false);

  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    setState("loading");
    setGen(null);
    setSelectedIdx(0);
    setCropOpen(false);
    setEditStatus("idle");
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

      // Init aspect picker default
      const vm = activeVideoModel() as GenVideoModel;
      const opts = GEN_VIDEO_MODEL_OPTIONS[vm];
      if (opts?.aspectRatios?.length) {
        const def = videoDefaults(vm).aspectRatio || opts.aspectRatios[0]!;
        setChosenAspect(def);
      }
    });
    return () => {
      cancelledRef.current = true;
    };
  }, [generationId]);

  // Clear edit composer on generation change
  useEffect(() => {
    setEditPrompt("");
    setEditIds([]);
    setComposerKey(String(Date.now()));
  }, [gen?.id]);

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

  const handleFavorite = useCallback(async () => {
    if (!gen) return;
    const next = !favorite;
    setFavoriteLocal(next); // optimistic
    const result = await setFavorite(generationId, next);
    if ("error" in result) setFavoriteLocal(!next); // revert
  }, [gen, favorite, generationId]);

  const pollJob = useCallback(async (jobId: string): Promise<"done" | "failed"> => {
    for (let i = 0; i < 120; i++) {
      if (cancelledRef.current) return "failed";
      await new Promise((r) => setTimeout(r, 2000));
      const job = await getGenJob(jobId);
      if (!job) return "failed";
      if (job.status === "DONE") return "done";
      if (job.status === "FAILED") return "failed";
    }
    return "failed";
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
    if (!gen) return;
    setRegenStatus("running");
    const result = await startGen({
      projectId,
      prompt: gen.prompt,
      count: 1,
      kind: "image",
      model: activeImageModel(),
      idempotencyKey: `regen-${generationId}-${Date.now()}`,
    });
    if ("error" in result) {
      setRegenStatus("failed");
      return;
    }
    const status = await pollJob(result.id);
    if (!cancelledRef.current) {
      setRegenStatus(status);
      // reset to idle after 3s
      setTimeout(() => { if (!cancelledRef.current) setRegenStatus("idle"); }, 3000);
    }
    if (status === "done") await reloadFromJob(result.id);
  }, [gen, generationId, projectId, pollJob, reloadFromJob]);

  const handleAnimate = useCallback(async () => {
    if (!gen) return;
    setAnimStatus("running");
    const vm = activeVideoModel() as GenVideoModel;
    const vd = videoDefaults(vm);
    // Use user's chosen aspect ratio if set; fall back to videoDefaults
    const effectiveAspect = chosenAspect || vd.aspectRatio;
    const result = await startGen({
      projectId,
      prompt: gen.prompt,
      count: 1,
      kind: "video",
      model: vm,
      sourceGenerationId: generationId,
      durationSeconds: vd.seconds,
      resolution: vd.resolution,
      audio: vd.audio,
      ...(effectiveAspect ? { aspectRatio: effectiveAspect } : {}),
      idempotencyKey: `anim-${generationId}-${Date.now()}`,
    });
    if ("error" in result) {
      if (!cancelledRef.current) setAnimStatus("failed");
      return;
    }
    const status = await pollJob(result.id);
    if (!cancelledRef.current) {
      setAnimStatus(status);
      setTimeout(() => { if (!cancelledRef.current) setAnimStatus("idle"); }, 3000);
    }
    if (status === "done") await reloadFromJob(result.id);
  }, [gen, generationId, projectId, pollJob, chosenAspect, reloadFromJob]);

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
    await deleteGeneration(generationId);
    onClose();
  }, [generationId, onClose]);

  // Variant switcher: switch displayed url + persist pick
  const handleVariantPick = useCallback((idx: number) => {
    if (!gen) return;
    setSelectedIdx(idx);
    writePick(gen.id, idx);
  }, [gen]);

  // Edit @composer: submit an edit generation
  const handleEditSubmit = useCallback(async () => {
    if (!gen || !editPrompt.trim() || editStatus === "running") return;
    setEditStatus("running");
    const result = await startGen({
      projectId,
      prompt: editPrompt.trim(),
      entityIds: editIds,
      count: 1,
      kind: "image",
      model: activeImageModel(),
      idempotencyKey: `edit-${gen.id}-${Date.now()}`,
    });
    if ("error" in result) {
      if (!cancelledRef.current) setEditStatus("failed");
      return;
    }
    const status = await pollJob(result.id);
    if (!cancelledRef.current) {
      setEditStatus(status);
      setTimeout(() => { if (!cancelledRef.current) setEditStatus("idle"); }, 3000);
    }
    if (status === "done") await reloadFromJob(result.id);
  }, [gen, editPrompt, editIds, editStatus, projectId, pollJob, reloadFromJob]);

  // Crop: confirm crop and save
  const handleCropConfirm = useCallback(async () => {
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
    const result = await saveCroppedGeneration(gen.id, dataUrl);
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
  }, [gen, croppedAreaPixels, selectedIdx]);

  // Compute active URL to display
  const displayUrl = gen ? (gen.urls[selectedIdx] ?? gen.url) : null;

  // Aspect ratios for picker (only show if model has options)
  const vm = activeVideoModel() as GenVideoModel;
  const videoOpts = GEN_VIDEO_MODEL_OPTIONS[vm];
  const aspectRatios = videoOpts?.aspectRatios ?? [];

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
          borderRadius: 16,
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          aria-label="Close detail panel"
          className="al-iconbtn al-iconbtn-md"
          style={{ position: "absolute", top: 12, right: 12 }}
        >
          <IcX size={16} />
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
            <div style={{ borderRadius: 10, overflow: "hidden", background: "var(--muted)", lineHeight: 0 }}>
              {gen.kind === "video" ? (
                <video
                  key={displayUrl}
                  src={displayUrl}
                  controls
                  playsInline
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
                style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}
              >
                {gen.urls.map((u, i) => (
                  <button
                    key={u}
                    role="option"
                    aria-selected={i === selectedIdx}
                    onClick={() => handleVariantPick(i)}
                    style={{
                      flex: "none",
                      width: 52,
                      height: 52,
                      padding: 0,
                      border: `2px solid ${i === selectedIdx ? "var(--accent)" : "var(--border)"}`,
                      borderRadius: 6,
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
              <p style={{ margin: 0, fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.5 }}>{gen.prompt}</p>
            )}

            {/* Aspect picker (17): for image-to-video Animate when model has aspect ratios */}
            {gen.kind === "image" && aspectRatios.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, color: "var(--muted-foreground)", flexShrink: 0 }}>Aspect</span>
                <div className="al-seg" role="tablist" aria-label="Aspect ratio">
                  {aspectRatios.map((ar) => (
                    <button
                      key={ar}
                      role="tab"
                      type="button"
                      aria-selected={chosenAspect === ar}
                      className={`al-seg-item${chosenAspect === ar ? " al-seg-item-active" : ""}`}
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
              >
                {favorite ? "♥ Saved" : "♡ Save"}
              </Button>

              {/* Regenerate */}
              <Button
                variant="ghost"
                size="sm"
                icon={<IcRetry size={14} />}
                onClick={handleRegen}
                disabled={regenStatus === "running"}
              >
                {regenStatus === "running"
                  ? "Generating…"
                  : regenStatus === "done"
                  ? "New version ready"
                  : regenStatus === "failed"
                  ? "Failed — retry?"
                  : "Regenerate"}
              </Button>

              {/* Animate (image → video) */}
              {gen.kind === "image" && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<IcPlay size={14} />}
                  onClick={handleAnimate}
                  disabled={animStatus === "running"}
                >
                  {animStatus === "running"
                    ? "Animating…"
                    : animStatus === "done"
                    ? "Video ready"
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
              <Button variant="ghost" size="sm" onClick={handleDelete}>
                Delete
              </Button>
            </div>

            {/* Edit @composer (24) */}
            {gen.kind === "image" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>Describe your edit, @ to reference</span>
                <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                  <div className="al-input-wrap" style={{ flex: 1, minWidth: 0, border: "1px solid var(--border)", borderRadius: 8, padding: "6px 10px" }}>
                    <MentionInput
                      entities={entities}
                      docKey={composerKey}
                      placeholder="Describe your edit, @ to reference"
                      disabled={editStatus === "running"}
                      onChange={(text, ids) => {
                        setEditPrompt(text);
                        setEditIds(ids);
                      }}
                      onSubmit={handleEditSubmit}
                    />
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleEditSubmit}
                    disabled={editStatus === "running" || !editPrompt.trim()}
                  >
                    {editStatus === "running"
                      ? "Editing…"
                      : editStatus === "done"
                      ? "Edit ready!"
                      : editStatus === "failed"
                      ? "Failed"
                      : "Send"}
                  </Button>
                </div>
              </div>
            )}

            {/* Crop modal (16) — normal-flow overlay inside panel, NOT position:fixed */}
            {cropOpen && (
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
                    disabled={cropStatus === "saving"}
                  >
                    {cropStatus === "saving" ? "Saving…" : "Confirm crop"}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
