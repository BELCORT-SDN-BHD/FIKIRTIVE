"use client";
import { useRef, useState } from "react";
import { coworkTurn, coworkRenameThread, coworkDeleteThread, setCoworkBrief } from "@/lib/cowork-actions";
import { uploadReference } from "@/lib/actions";
import { getCoworkThreadClient } from "@/lib/cowork-fetch";
import { MentionInput } from "@/components/MentionInput";
import { Lightbox } from "@/components/Lightbox";
import { IcPlus, Dialog, Button } from "@/components/ds";
import { GEN_PRICE_USD_PER_IMAGE, videoPriceUsd, videoDefaults, GEN_VIDEO_MODELS, type GenVideoModel } from "@artlio/core";
import { GenerateCard } from "./GenerateCard";
import type { EntityDTO, ChatThreadDTO } from "@/lib/types";

const isVideoUrl = (u: string) => /\.(mp4|webm|mov|mkv)(\?|$)/i.test(u); // mirrors GenSpace

// DISPLAY-ONLY cost re-derived from a GEN_RESULT's {kind, model}. Video price needs
// per-gen params (seconds/resolution/audio) the result DTO doesn't carry, so we
// approximate from the model's defaults — hence the "~". Never gates anything.
function resultPriceUsd(kind: string, model: string): number | null {
  if (kind === "video") {
    if (!(GEN_VIDEO_MODELS as readonly string[]).includes(model)) return null;
    const m = model as GenVideoModel;
    const d = videoDefaults(m);
    return videoPriceUsd(m, { seconds: d.seconds, resolution: d.resolution, audio: d.audio, count: 1 });
  }
  return GEN_PRICE_USD_PER_IMAGE;
}

export function Cowork({ projectId, entities, threads, brief = "" }: {
  projectId: string;
  entities: EntityDTO[];
  threads: ChatThreadDTO[];
  brief?: string;
}) {
  // chatbox sessions: the full thread list (newest-first, with messages) is the
  // client source of truth — switching is pure local state, no per-switch fetch.
  const [list, setList] = useState<ChatThreadDTO[]>(threads);
  const [activeId, setActiveId] = useState<string | null>(threads[0]?.id ?? null);
  const active = list.find((t) => t.id === activeId) ?? null;
  const messages = active?.messages ?? [];

  const [text, setText] = useState("");
  const [ids, setIds] = useState<string[]>([]);
  const [variantSel, setVariantSel] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false); // synchronous double-submit guard (GenSpace pattern)
  const [composerKey, setComposerKey] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // "Reply to message" — the message the user wants to quote in the next turn.
  // Shown as a dismissible chip above the promptbar; cleared after send (or dismiss).
  const [replyTo, setReplyTo] = useState<{ id: string; label: string } | null>(null);

  // "Animate this result" / uploaded image: the i2v source frame for the next turn.
  // coworkTurn validates it and forces a video proposal. Cleared after send (or dismiss).
  const [pendingSource, setPendingSource] = useState<{ id: string; preview?: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);

  // T3: click-to-enlarge for durable GEN_RESULT media (reuses the Gen-space Lightbox).
  const [zoom, setZoom] = useState<{ src: string; kind: "image" | "video" } | null>(null);

  // Project brief editor state.
  const [briefOpen, setBriefOpen] = useState(false);
  const [briefText, setBriefText] = useState(brief);
  const [briefBusy, setBriefBusy] = useState(false);
  const [briefErr, setBriefErr] = useState<string | null>(null);

  // Re-fetch a thread by id and make it active (shared by send + card revise).
  async function refreshThread(id: string) {
    const fresh = await getCoworkThreadClient(id);
    if (fresh) {
      setList((cur) => [fresh, ...cur.filter((t) => t.id !== fresh.id)]);
      setActiveId(fresh.id);
    }
  }

  function animateResult(generationId: string) {
    setPendingSource({ id: generationId });
    setError(null);
    // focus the composer so the user can describe the motion right away
    requestAnimationFrame(() => dockRef.current?.querySelector<HTMLElement>(".ProseMirror")?.focus());
  }

  function onUploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file || uploading) return;
    setError(null);
    setUploading(true);
    (async () => {
      try {
        const fd = new FormData();
        fd.append("files", file);
        const res = await uploadReference(projectId, fd);
        if ("error" in res) { setError(res.error); return; }
        setPendingSource({ id: res.id, preview: res.src });
        requestAnimationFrame(() => dockRef.current?.querySelector<HTMLElement>(".ProseMirror")?.focus());
      } catch {
        setError("Couldn't upload — please try again.");
      } finally {
        setUploading(false); // always clears, even if uploadReference throws
      }
    })();
  }

  // inline rename state for the rail
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");

  async function send() {
    if (!text.trim() || busy || busyRef.current || uploading) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await coworkTurn({ threadId: active?.id, projectId, text, entityIds: ids, variantSel, ...(pendingSource ? { sourceGenerationId: pendingSource.id } : {}), ...(replyTo ? { replyToMessageId: replyTo.id } : {}) });
      if ("error" in res) { setError(res.error); return; }
      // keep the brief editor in sync when the agent refined the brief this turn (the
      // dialog is a closed modal during a send, so this never clobbers an open edit).
      if (res.brief !== undefined) setBriefText(res.brief);
      await refreshThread(res.threadId);
      setText("");
      setIds([]);
      setVariantSel({});
      setPendingSource(null);
      setReplyTo(null);
      setComposerKey((k) => k + 1);
    } catch {
      setError("Couldn't reach cowork — please try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function saveBrief() {
    setBriefBusy(true);
    setBriefErr(null);
    try {
      const res = await setCoworkBrief({ projectId, brief: briefText });
      if ("error" in res) { setBriefErr(res.error); return; }
      setBriefOpen(false);
    } catch {
      setBriefErr("Couldn't save — please try again.");
    } finally {
      setBriefBusy(false);
    }
  }

  function newChat() {
    setActiveId(null);
    setText("");
    setIds([]);
    setVariantSel({});
    setReplyTo(null);
    setComposerKey((k) => k + 1);
    setError(null);
  }

  function selectThread(id: string) {
    if (renamingId) return; // don't switch out from under an open rename input
    setActiveId(id);
    setError(null);
  }

  function startRename(id: string, title: string) {
    setRenamingId(id);
    setRenameText(title);
  }

  async function commitRename(id: string) {
    const t = renameText.trim();
    setRenamingId(null);
    if (!t) return;
    const prev = list.find((x) => x.id === id)?.title;
    if (t === prev) return;
    setList((cur) => cur.map((x) => (x.id === id ? { ...x, title: t } : x)));
    const res = await coworkRenameThread({ threadId: id, title: t });
    if ("error" in res) setError(res.error);
  }

  async function deleteThread(id: string) {
    if (!window.confirm("Delete this conversation?")) return;
    const res = await coworkDeleteThread({ threadId: id });
    if ("error" in res) { setError(res.error); return; }
    setList((cur) => cur.filter((x) => x.id !== id));
    if (activeId === id) setActiveId(list.find((x) => x.id !== id)?.id ?? null);
  }

  return (
    <div className="cw-shell">
      <aside className="cw-rail">
        <button className="cw-rail-new" onClick={newChat}>
          <IcPlus size={15} /> New chat
        </button>
        <button
          className="al-iconbtn al-iconbtn-sm"
          title="Project brief"
          aria-label="Edit project brief"
          style={{ display: "flex", alignItems: "center", gap: 5, width: "100%", justifyContent: "flex-start", padding: "4px 8px", font: "var(--text-small)", color: "var(--fg-3)", borderRadius: 6, margin: "4px 0 0" }}
          onClick={() => { setBriefText(briefText); setBriefErr(null); setBriefOpen(true); }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
          Project brief{briefText ? " ·" : ""}
        </button>
        <div className="cw-rail-list">
          {list.map((t) => (
            <div
              key={t.id}
              className={`cw-rail-item${t.id === activeId ? " cw-rail-item-active" : ""}`}
              onClick={() => selectThread(t.id)}
            >
              {renamingId === t.id ? (
                <input
                  className="cw-rail-rename"
                  autoFocus
                  value={renameText}
                  onChange={(e) => setRenameText(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={() => commitRename(t.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); commitRename(t.id); }
                    if (e.key === "Escape") { e.preventDefault(); setRenamingId(null); }
                  }}
                />
              ) : (
                <>
                  <span
                    className="cw-rail-title"
                    onDoubleClick={(e) => { e.stopPropagation(); startRename(t.id, t.title); }}
                    title={t.title}
                  >
                    {t.title}
                  </span>
                  <span className="cw-rail-actions">
                    <button
                      className="al-iconbtn al-iconbtn-sm"
                      aria-label="Rename conversation"
                      title="Rename"
                      onClick={(e) => { e.stopPropagation(); startRename(t.id, t.title); }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                    </button>
                    <button
                      className="al-iconbtn al-iconbtn-sm"
                      aria-label="Delete conversation"
                      title="Delete"
                      onClick={(e) => { e.stopPropagation(); deleteThread(t.id); }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
                    </button>
                  </span>
                </>
              )}
            </div>
          ))}
        </div>
      </aside>

      <div className="cw-main">
        <div className="screen">
          <div className="screen-pad">
            <h1 style={{ font: "var(--text-title)", color: "var(--fg-1)", margin: "10px 0 18px" }}>Cowork</h1>

            {messages.length === 0 && !busy && (
              <p style={{ font: "var(--text-body)", color: "var(--fg-3)", margin: "8px 0" }}>
                Describe what you&apos;d like to create and hit Send.
              </p>
            )}

            {messages.map((m) => {
              // Reply icon button — shown unobtrusively on every message row.
              const replyBtn = (
                <button
                  type="button"
                  className="al-iconbtn al-iconbtn-sm"
                  aria-label="Reply to this message"
                  title="Reply"
                  style={{ opacity: 0.45, flexShrink: 0 }}
                  onClick={() => {
                    const label = m.kind === "GEN_CARD" ? "proposal"
                      : m.kind === "GEN_RESULT" ? "result"
                      : m.text.slice(0, 60) || m.kind.toLowerCase();
                    setReplyTo({ id: m.id, label });
                    requestAnimationFrame(() => dockRef.current?.querySelector<HTMLElement>(".ProseMirror")?.focus());
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 17l-5-5 5-5"/><path d="M4 12h11a4 4 0 0 1 4 4v2"/></svg>
                </button>
              );

              if (m.kind === "TEXT") {
                return (
                  <div key={m.id} className={m.role === "USER" ? "cw-msg cw-user" : "cw-msg cw-agent"} style={{ display: "flex", alignItems: "flex-start", gap: 4 }}>
                    <span style={{ flex: 1, minWidth: 0 }}>{m.text}</span>
                    {replyBtn}
                  </div>
                );
              }
              if (m.kind === "PLAN") {
                const steps = (m.payload as { planSteps?: string[] } | null)?.planSteps ?? [];
                if (!steps.length) return null;
                return (
                  <div key={m.id} style={{ display: "flex", alignItems: "flex-start", gap: 4 }}>
                    <ul className="cw-plan" style={{ flex: 1, minWidth: 0, margin: 0 }}>
                      {steps.map((s, i) => <li key={i}>{s}</li>)}
                    </ul>
                    {replyBtn}
                  </div>
                );
              }
              if (m.kind === "GEN_CARD") {
                return (
                  <div key={m.id} style={{ display: "flex", alignItems: "flex-start", gap: 4 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <GenerateCard
                        cardId={m.id}
                        payload={m.payload}
                        entities={entities}
                        alreadyGenerated={!!m.genJobId}
                        threadId={active!.id}
                        projectId={projectId}
                        onRevised={() => { if (active) refreshThread(active.id); }}
                      />
                    </div>
                    {replyBtn}
                  </div>
                );
              }
              if (m.kind === "GEN_RESULT") {
                const r = m.payload as { kind?: string; model?: string; urls?: string[]; generationIds?: string[] } | null;
                const urls = r?.urls ?? [];
                const genIds = r?.generationIds ?? [];
                const rKind = r?.kind ?? "image";
                const model = r?.model ?? "";
                const isImage = rKind === "image"; // only image frames are animatable
                const price = resultPriceUsd(rKind, model); // DISPLAY-ONLY
                return (
                  <div key={m.id} style={{ display: "flex", alignItems: "flex-start", gap: 4 }}>
                    <div className="cw-result" style={{ flex: 1, minWidth: 0 }}>
                      {urls.map((u, i) => {
                        const gid = genIds[i];
                        const video = isVideoUrl(u);
                        const kind = video ? "video" : "image";
                        const canAnimate = isImage && !video && !!gid;
                        const ext = u.split("?")[0].split(".").pop() || "bin";
                        const filename = `artlio-${(genIds[i] ?? String(i)).slice(0, 8)}.${ext}`;
                        return (
                          <figure key={i} className="cw-media">
                            <div className="cw-media-frame">
                              {video ? (
                                <video src={u} controls muted loop playsInline />
                              ) : (
                                <button
                                  type="button"
                                  className="cw-media-btn"
                                  title="Click to enlarge"
                                  onClick={() => setZoom({ src: u, kind })}
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={u} alt="" />
                                </button>
                              )}
                              {/* Download — top-left overlay; plain anchor (no JS spend path) */}
                              <a
                                href={u}
                                download={filename}
                                className="al-iconbtn al-iconbtn-sm"
                                title="Download"
                                aria-label="Download"
                                style={{ position: "absolute", top: 6, left: 6, background: "rgba(0,0,0,.55)", color: "#fff" }}
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
                              </a>
                              {canAnimate && (
                                <button
                                  type="button"
                                  className="al-iconbtn al-iconbtn-sm"
                                  aria-label="Animate this frame"
                                  title="Animate this frame"
                                  onClick={() => animateResult(gid)}
                                  style={{ position: "absolute", top: 6, right: 6, background: "rgba(0,0,0,.55)", color: "#fff" }}
                                >
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden><polygon points="5 3 19 12 5 21 5 3" /></svg>
                                </button>
                              )}
                            </div>
                            <figcaption className="cw-media-cap">
                              {model || kind}
                              {price != null && <span className="cw-media-cap-price"> · ~${price.toFixed(2)}</span>}
                            </figcaption>
                          </figure>
                        );
                      })}
                    </div>
                    {replyBtn}
                  </div>
                );
              }
              if (m.kind === "DENIAL" || m.kind === "TURN_ERROR") {
                return (
                  <div key={m.id} style={{ display: "flex", alignItems: "flex-start", gap: 4 }}>
                    <span className="cw-msg cw-error" style={{ flex: 1, minWidth: 0 }}>{m.text}</span>
                    {replyBtn}
                  </div>
                );
              }
              return null;
            })}

            {error && <div className="cw-msg cw-error">{error}</div>}
          </div>
        </div>

        <div className="composer-dock" ref={dockRef}>
          {replyTo && (
            <div className="cw-animate-hint" style={{ maxWidth: 880, width: "100%", display: "flex", alignItems: "center", gap: 8, margin: "0 0 8px", font: "var(--text-small)", color: "var(--fg-2)" }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 17l-5-5 5-5"/><path d="M4 12h11a4 4 0 0 1 4 4v2"/></svg>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Replying to: {replyTo.label}</span>
              <button
                type="button"
                className="al-iconbtn al-iconbtn-sm"
                aria-label="Cancel reply"
                title="Cancel"
                onClick={() => setReplyTo(null)}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
              </button>
            </div>
          )}
          {pendingSource && (
            <div className="cw-animate-hint" style={{ maxWidth: 880, width: "100%", display: "flex", alignItems: "center", gap: 8, margin: "0 0 8px", font: "var(--text-small)", color: "var(--fg-2)" }}>
              {pendingSource.preview && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={pendingSource.preview} alt="" style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 4, flexShrink: 0 }} />
              )}
              {!pendingSource.preview && (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden><polygon points="5 3 19 12 5 21 5 3" /></svg>
              )}
              <span style={{ flex: 1, minWidth: 0 }}>Animating this frame — describe the motion.</span>
              <button
                type="button"
                className="al-iconbtn al-iconbtn-sm"
                aria-label="Cancel animate"
                title="Cancel"
                onClick={() => setPendingSource(null)}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
              </button>
            </div>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={onUploadFile}
          />
          <div className="al-promptbar" style={{ maxWidth: 880, width: "100%" }}>
            <div className="al-input-wrap" style={{ border: "none", background: "none", padding: 0 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <MentionInput
                  entities={entities}
                  docKey={String(composerKey)}
                  placeholder="Describe what you want to create…"
                  disabled={busy}
                  onChange={(t, i, vs) => { setText(t); setIds(i); setVariantSel(vs); }}
                  onSubmit={send}
                />
              </div>
            </div>
            <div className="al-promptbar-row">
              <button
                type="button"
                className="al-iconbtn al-iconbtn-md"
                aria-label="Upload an image to animate"
                title="Upload an image to animate"
                disabled={busy || uploading}
                onClick={() => fileInput.current?.click()}
              >
                <IcPlus size={16} />
              </button>
              <span className="al-promptbar-spacer" />
              <button
                className="al-btn al-btn-md al-btn-primary"
                disabled={busy || uploading || !text.trim()}
                onClick={send}
              >
                {busy ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {zoom && <Lightbox src={zoom.src} kind={zoom.kind} onClose={() => setZoom(null)} />}

      <Dialog
        open={briefOpen}
        title="Project brief"
        onClose={() => { if (!briefBusy) setBriefOpen(false); }}
        actions={[
          <Button key="cancel" variant="ghost" onClick={() => setBriefOpen(false)} disabled={briefBusy}>Cancel</Button>,
          <Button key="save" onClick={saveBrief} disabled={briefBusy}>{briefBusy ? "Saving…" : "Save"}</Button>,
        ]}
      >
        <p style={{ font: "var(--text-small)", color: "var(--fg-3)", margin: "0 0 12px" }}>
          Creative direction the agent honors every turn — tone, style, constraints.
        </p>
        <textarea
          rows={6}
          maxLength={2000}
          value={briefText}
          onChange={(e) => setBriefText(e.target.value)}
          disabled={briefBusy}
          placeholder="e.g. Always use a cinematic widescreen look, warm golden-hour tones, no text overlays."
          style={{ width: "100%", resize: "vertical", font: "var(--text-body)", color: "var(--fg-1)", background: "var(--surface-2)", border: "1px solid var(--border-1)", borderRadius: 8, padding: "8px 10px", boxSizing: "border-box", outline: "none" }}
        />
        {briefErr && <p role="alert" style={{ font: "var(--text-caption)", color: "var(--danger)", margin: "8px 0 0" }}>{briefErr}</p>}
      </Dialog>
    </div>
  );
}
