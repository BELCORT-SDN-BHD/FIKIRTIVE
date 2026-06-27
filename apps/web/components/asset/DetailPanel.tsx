"use client";
/**
 * G2a · per-asset detail panel.
 * G2b adds: variant switcher (25), aspect picker (17).
 * Opens as an absolute overlay inside the canvas container (not position:fixed).
 * Escape or click-on-backdrop closes; clicking the panel itself does not.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getGeneration } from "@/lib/asset-actions";
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

export default function DetailPanel({
  generationId,
  projectId,
  onClose,
  entities: _entities = [],
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

  // Esc key
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

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
  }, [gen, generationId, projectId, pollJob]);

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
  }, [gen, generationId, projectId, pollJob, chosenAspect]);

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

  // Compute active URL to display
  const displayUrl = gen ? (gen.urls[selectedIdx] ?? gen.url) : null;

  // Aspect ratios for picker (only show if model has options)
  const vm = activeVideoModel() as GenVideoModel;
  const videoOpts = GEN_VIDEO_MODEL_OPTIONS[vm];
  const aspectRatios = videoOpts?.aspectRatios ?? [];

  return (
    // Faux-viewport overlay — absolute inside the canvas container, not fixed
    <div
      onClick={onClose}
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
    >
      {/* Panel card — click stops propagation so backdrop click still works */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="al-panel"
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
          style={{ position: "absolute", top: 12, right: 12, background: "rgba(255,255,255,.08)" }}
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
          <div style={{ minHeight: 200, display: "grid", placeItems: "center", color: "var(--c-danger, #f55)" }}>
            Could not load this asset.
          </div>
        )}

        {state === "ready" && gen && displayUrl && (
          <>
            {/* Media preview */}
            <div style={{ borderRadius: 10, overflow: "hidden", background: "#000", lineHeight: 0 }}>
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
                      border: `2px solid ${i === selectedIdx ? "var(--brand, #6c63ff)" : "transparent"}`,
                      borderRadius: 6,
                      overflow: "hidden",
                      cursor: "pointer",
                      background: "#000",
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
              <p style={{ margin: 0, fontSize: 13, opacity: 0.7, lineHeight: 1.5 }}>{gen.prompt}</p>
            )}

            {/* Aspect picker (17): for image-to-video Animate when model has aspect ratios */}
            {gen.kind === "image" && aspectRatios.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, opacity: 0.6, flexShrink: 0 }}>Aspect</span>
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
          </>
        )}
      </div>
    </div>
  );
}
