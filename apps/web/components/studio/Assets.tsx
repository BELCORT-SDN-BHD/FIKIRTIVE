"use client";
/** Assets surface — the project's real media library. Every generated image and
 *  video lands here: preview, delete, and (for unattached candidates) attach to
 *  a shot. Free to browse; nothing here spends. */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { IcX } from "@/components/ds";
import { deleteGeneration, attachGeneration } from "@/lib/actions";

export type MediaItem = { id: string; src: string; kind: "image" | "video"; prompt: string; attached: boolean };
export type ShotOption = { id: string; label: string };

const FILTERS = [["all", "All"], ["image", "Images"], ["video", "Videos"]] as const;

export function Assets({ media, shotOptions }: { media: MediaItem[]; shotOptions: ShotOption[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<"all" | "image" | "video">("all");
  const [busy, setBusy] = useState<string | null>(null);

  const shown = media.filter((m) => filter === "all" || m.kind === filter);

  function remove(id: string) {
    if (busy) return;
    setBusy(id);
    (async () => { await deleteGeneration(id); setBusy(null); router.refresh(); })();
  }
  function attach(id: string, shotId: string) {
    if (busy || !shotId) return;
    setBusy(id);
    (async () => { await attachGeneration(id, shotId); setBusy(null); router.refresh(); })();
  }

  return (
    <div className="screen">
      <div className="screen-pad">
        <div style={{ display: "flex", alignItems: "center", gap: 14, margin: "10px 0 16px" }}>
          <h1 style={{ font: "var(--text-display)", letterSpacing: "var(--tracking-display)", color: "var(--fg-1)", margin: 0 }}>Assets</h1>
          <span style={{ flex: 1 }} />
          <span style={{ font: "var(--text-mono-meta)", color: "var(--fg-3)" }}>{media.length} item{media.length === 1 ? "" : "s"}</span>
        </div>

        <div className="al-seg" role="tablist" style={{ marginBottom: 18, width: "fit-content" }}>
          {FILTERS.map(([key, label]) => (
            <button key={key} role="tab" aria-selected={filter === key}
              className={`al-seg-item${filter === key ? " al-seg-item-active" : ""}`} onClick={() => setFilter(key)}>{label}</button>
          ))}
        </div>

        {shown.length === 0 ? (
          <div style={{ display: "grid", placeItems: "center", minHeight: "48vh", textAlign: "center" }}>
            <div>
              <h2 style={{ font: "var(--text-title)", color: "var(--fg-1)", margin: 0 }}>{media.length === 0 ? "Your library is empty" : "Nothing in this filter"}</h2>
              <p style={{ font: "var(--text-body)", color: "var(--fg-2)", margin: "6px 0 0", maxWidth: 420 }}>
                Everything you generate in this project — images and videos — is stored here.
              </p>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
            {shown.map((m) => (
              <div key={m.id} className="al-mediacard" style={{ width: 220, flex: "none", cursor: "default" }}>
                <div style={{ position: "relative", aspectRatio: "16 / 10", background: "#000" }}>
                  {m.kind === "video"
                    ? <video src={m.src} muted loop autoPlay playsInline style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
                    // eslint-disable-next-line @next/next/no-img-element
                    : <img src={m.src} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />}
                  <span style={{ position: "absolute", top: 8, left: 8, font: "var(--text-mono-meta)", color: "var(--fg-1)", background: "rgba(6,8,11,.6)", padding: "1px 6px", borderRadius: 4 }}>
                    {m.attached ? "In a shot" : "Candidate"}{m.kind === "video" ? " · video" : ""}
                  </span>
                  <button className="al-iconbtn al-iconbtn-sm" aria-label="Delete asset" disabled={busy === m.id}
                    onClick={() => remove(m.id)}
                    style={{ position: "absolute", top: 6, right: 6, background: "rgba(6,8,11,.6)" }}>
                    <IcX size={12} />
                  </button>
                  {busy === m.id && (
                    <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "rgba(6,8,11,.55)", font: "var(--text-caption)", color: "var(--fg-2)" }}>working…</span>
                  )}
                </div>
                <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                  <p style={{ font: "var(--text-small)", color: "var(--fg-2)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                    {m.prompt || "Untitled"}
                  </p>
                  {!m.attached && shotOptions.length > 0 && (
                    <select aria-label="Add to shot" disabled={busy === m.id} defaultValue=""
                      onChange={(e) => attach(m.id, e.target.value)}
                      style={{ width: "100%", background: "rgba(255,255,255,.05)", border: "1px solid var(--line-2)", borderRadius: "var(--radius-sm)", padding: "6px 8px", color: "var(--fg-1)", font: "var(--text-small)", outline: "none" }}>
                      <option value="">Add to shot…</option>
                      {shotOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </select>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
