"use client";
/** Click-to-enlarge preview (iOS Photos-style) — a full-screen overlay for a
 *  generated/library image or video. Esc or click-outside closes; the media
 *  itself swallows the click so it stays open. Reused by Gen space + Assets. */
import { useEffect } from "react";
import { IcX } from "@/components/ds";

export function Lightbox({ src, kind, onClose }: { src: string; kind: "image" | "video"; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);

  return (
    <div onClick={onClose} role="dialog" aria-modal="true" aria-label="Preview"
      style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,.88)", display: "grid", placeItems: "center", padding: 24 }}>
      <button onClick={onClose} aria-label="Close preview" className="al-iconbtn al-iconbtn-md"
        style={{ position: "absolute", top: 16, right: 16, background: "rgba(255,255,255,.12)", zIndex: 1 }}>
        <IcX size={18} />
      </button>
      {kind === "video" ? (
        <video src={src} controls autoPlay loop playsInline onClick={(e) => e.stopPropagation()}
          style={{ maxWidth: "94vw", maxHeight: "90vh", borderRadius: "var(--radius-md)", background: "#000" }} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" onClick={(e) => e.stopPropagation()}
          style={{ maxWidth: "94vw", maxHeight: "90vh", objectFit: "contain", borderRadius: "var(--radius-md)" }} />
      )}
    </div>
  );
}
