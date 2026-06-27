"use client";
/**
 * G2a · per-asset detail panel.
 * Opens as an absolute overlay inside the canvas container (not position:fixed).
 * Escape or click-on-backdrop closes; clicking the panel itself does not.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getGeneration } from "@/lib/asset-actions";
import { setFavorite } from "@/lib/asset-actions";
import { deleteGeneration } from "@/lib/actions";
import { startGen, getGenJob } from "@/lib/gen-actions";
import { activeImageModel, activeVideoModel } from "@fikirtive/core";
import { Button, IcX, IcPlay, IcRetry } from "@/components/ds";

type GenDTO = {
  id: string;
  url: string;
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
}: {
  generationId: string;
  projectId: string;
  onClose: () => void;
}) {
  const [state, setState] = useState<PanelState>("loading");
  const [gen, setGen] = useState<GenDTO | null>(null);
  const [favorite, setFavoriteLocal] = useState(false);

  // Action states
  const [regenStatus, setRegenStatus] = useState<"idle" | "running" | "done" | "failed">("idle");
  const [animStatus, setAnimStatus] = useState<"idle" | "running" | "done" | "failed">("idle");
  const [copied, setCopied] = useState(false);

  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    setState("loading");
    setGen(null);
    getGeneration(generationId).then((result) => {
      if (cancelledRef.current) return;
      if ("error" in result) {
        setState("error");
        return;
      }
      setGen(result);
      setFavoriteLocal(result.favorite);
      setState("ready");
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
    if (cancelledRef.current) return;
    setRegenStatus(status);
    // reset to idle after 3s
    setTimeout(() => { if (!cancelledRef.current) setRegenStatus("idle"); }, 3000);
  }, [gen, generationId, projectId, pollJob]);

  const handleAnimate = useCallback(async () => {
    if (!gen) return;
    setAnimStatus("running");
    const result = await startGen({
      projectId,
      prompt: gen.prompt,
      count: 1,
      kind: "video",
      model: activeVideoModel(),
      sourceGenerationId: generationId,
      idempotencyKey: `anim-${generationId}-${Date.now()}`,
    });
    if ("error" in result) {
      setAnimStatus("failed");
      return;
    }
    const status = await pollJob(result.id);
    if (cancelledRef.current) return;
    setAnimStatus(status);
    setTimeout(() => { if (!cancelledRef.current) setAnimStatus("idle"); }, 3000);
  }, [gen, generationId, projectId, pollJob]);

  const handleCopyLink = useCallback(async () => {
    if (!gen) return;
    try {
      await navigator.clipboard.writeText(gen.url);
      setCopied(true);
      setTimeout(() => { if (!cancelledRef.current) setCopied(false); }, 2000);
    } catch {
      // silently ignore clipboard errors
    }
  }, [gen]);

  const handleDelete = useCallback(async () => {
    await deleteGeneration(generationId);
    onClose();
  }, [generationId, onClose]);

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

        {state === "ready" && gen && (
          <>
            {/* Media preview */}
            <div style={{ borderRadius: 10, overflow: "hidden", background: "#000", lineHeight: 0 }}>
              {gen.kind === "video" ? (
                <video
                  src={gen.url}
                  controls
                  playsInline
                  style={{ width: "100%", maxHeight: 340, objectFit: "contain" }}
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={gen.url}
                  alt={gen.prompt}
                  style={{ width: "100%", maxHeight: 340, objectFit: "contain" }}
                />
              )}
            </div>

            {/* Prompt text */}
            {gen.prompt && (
              <p style={{ margin: 0, fontSize: 13, opacity: 0.7, lineHeight: 1.5 }}>{gen.prompt}</p>
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
                href={gen.url}
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
