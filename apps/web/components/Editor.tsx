"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { artlioEdit, type ArtlioEdit } from "@artlio/core";
import { getRenderJobs, saveProjectEdit, startRender, getEditorMedia } from "@/lib/actions";
import { Button, Chip, EmptyHero, MonoLabel } from "./ds";

/**
 * Assembly-cut editor: Shotstack Studio session policed by the artlioEdit
 * contract — getEdit() snapshots are parsed canonically before any
 * persistence, and a debounced validator flags out-of-contract edits live.
 *
 * Phase-③ tracer: persistence is the SERVER (Project.editJson via
 * saveProjectEdit; the phase-② localStorage mock is dead per process rule 1),
 * and Export is real — RenderJob row → pg-boss → worker ffmpeg → asset.
 */

interface StudioEdit {
  getEdit: () => unknown;
  addClip: (trackIdx: number, clip: unknown) => Promise<void>;
  events: { on: (e: string, cb: () => void) => (() => void) | void };
}
type StudioHandles = {
  edit: StudioEdit;
  dispose: () => void;
};
type EditorClip = { id: string; src: string; kind: "image" | "video"; seconds: number };

/** A blank cut so the editor (and its Assets panel) renders for an empty project
 *  that still has media to drop in — the artlioEdit contract (≥1 clip) is only
 *  enforced at export, so an empty timeline edits fine. */
const EMPTY_EDIT: ArtlioEdit = {
  timeline: { background: "#000000", tracks: [{ clips: [] }] },
  output: { format: "mp4", resolution: "1080", aspectRatio: "16:9", fps: 25 },
};

export function Editor({
  projectId,
  boardEdit,
  savedEdit,
  attachedCount,
  onDirtyChange,
}: {
  projectId: string;
  /** rebuilt from the shot board every load */
  boardEdit: ArtlioEdit | null;
  /** the persisted working cut (Project.editJson), wins when present */
  savedEdit: ArtlioEdit | null;
  attachedCount: number;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const studioRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const handles = useRef<StudioHandles | null>(null);
  const initialEdit = savedEdit ?? boardEdit;
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [dirty, setDirtyState] = useState(false);
  const loadedFrom: "board" | "saved" = savedEdit ? "saved" : "board";
  const [notice, setNotice] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [liveIssue, setLiveIssue] = useState<string | null>(null);
  const setDirty = (d: boolean) => {
    setDirtyState(d);
    onDirtyChange(d);
  };

  // editor Assets panel: the project's generated media, clickable to add to the cut
  const [media, setMedia] = useState<EditorClip[]>([]);
  useEffect(() => {
    let alive = true;
    setMedia([]); // clear stale media on a project switch (don't show/append another project's clips)
    getEditorMedia(projectId).then((m) => { if (alive) setMedia(m); }).catch(() => {});
    return () => { alive = false; };
  }, [projectId]);
  // start with a blank cut if there's no board/saved cut but there IS media to add
  const startEdit = initialEdit ?? (media.length > 0 ? EMPTY_EDIT : null);

  // refresh/close with an unsaved cut → browser-native confirm (mirrors Composer)
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // leaving the editor (nav away / unmount) → report clean, so re-entry doesn't
  // prompt on a stale dirty flag (the parent's guard reads this)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => onDirtyChange(false), []);

  useEffect(() => {
    if (!startEdit) return;
    let disposed = false;
    // partial teardown for a cancelled init (StrictMode double-effect /
    // project switch): dispose whatever got constructed so far, in order
    const partials: Array<{ dispose?: () => void }> = [];
    const teardown = () => {
      for (const p of [...partials].reverse()) {
        try {
          p.dispose?.();
        } catch {
          /* already torn down */
        }
      }
      partials.length = 0;
    };

    (async () => {
      try {
        // Studio is browser-only (PixiJS) — import inside the effect, never SSR
        const { Edit, Canvas, Controls, Timeline, UIController } = await import(
          "@shotstack/shotstack-studio"
        );
        if (disposed) return;

        const edit = new Edit(startEdit as never);
        const canvas = new Canvas(edit);
        partials.push(canvas);
        const ui = UIController.create(edit, canvas);
        partials.push(ui);
        await canvas.load();
        if (disposed) return teardown();
        await edit.load();
        if (disposed) return teardown();

        const timeline = new Timeline(edit, timelineRef.current as HTMLElement, {
          resizable: true,
        });
        partials.push(timeline);
        await timeline.load();
        if (disposed) return teardown();

        const controls = new Controls(edit);
        // codex review: Controls leaks its document keyboard listeners — the
        // SDK ships NO teardown API on this class (verified in index.d.ts).
        // The optional call is forward-compat for when they add one; until
        // then a project switch leaves one stale handler behind (known, low
        // impact, tracked in TODOS).
        partials.push({ dispose: () => (controls as unknown as { dispose?: () => void }).dispose?.() });
        await controls.load();
        if (disposed) return teardown();

        // live contract check, debounced — surface drift while editing
        let debounce: ReturnType<typeof setTimeout> | undefined;
        const off = edit.events.on("edit:changed", () => {
          setDirty(true);
          clearTimeout(debounce);
          debounce = setTimeout(() => {
            const res = artlioEdit.safeParse(edit.getEdit());
            setLiveIssue(res.success ? null : res.error.issues[0]?.message ?? "invalid edit");
          }, 800);
        });
        partials.push({
          dispose: () => {
            clearTimeout(debounce);
            if (typeof off === "function") off();
          },
        });

        handles.current = { edit: edit as unknown as StudioEdit, dispose: teardown };
        setStatus("ready");
      } catch (e) {
        console.error("[editor] studio failed to load", e);
        teardown();
        if (!disposed) setStatus("failed");
      }
    })();

    return () => {
      disposed = true;
      handles.current?.dispose();
      handles.current = null;
      teardown(); // covers a cancelled init that never reached handles
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, startEdit]);

  /** read back the Studio snapshot and canonicalize through the contract */
  function snapshot(): { edit?: ArtlioEdit; error?: string } {
    const h = handles.current;
    if (!h) return { error: "Editor not ready yet." };
    const result = artlioEdit.safeParse(h.edit.getEdit());
    if (!result.success) {
      const first = result.error.issues[0];
      return {
        error: `${first?.message ?? "invalid edit"}${first?.path?.length ? ` (at ${first.path.join(".")})` : ""}`,
      };
    }
    return { edit: result.data };
  }

  // append a project asset to the visual track (track 0) at the current end
  async function appendAsset(clip: EditorClip) {
    const h = handles.current;
    if (!h || status !== "ready") return;
    const cur = h.edit.getEdit() as ArtlioEdit;
    const track0 = cur.timeline.tracks[0]?.clips ?? [];
    const end = track0.reduce((m, c) => Math.max(m, c.start + c.length), 0);
    try {
      await h.edit.addClip(0, { asset: { type: clip.kind, src: clip.src }, start: end, length: clip.seconds });
    } catch (e) {
      console.error("[editor] addClip failed", e);
    }
  }

  const [busy, setBusy] = useState(false);

  async function saveCut(): Promise<boolean> {
    const { edit, error } = snapshot();
    if (error) {
      setNotice({ tone: "warn", text: `Out of contract: ${error}` });
      return false;
    }
    setBusy(true);
    try {
      const res = await saveProjectEdit(projectId, JSON.stringify(edit));
      if (res && "error" in res && res.error) {
        setNotice({ tone: "warn", text: res.error });
        return false;
      }
      setDirty(false);
      setNotice({ tone: "ok", text: "Cut saved." });
      setTimeout(() => setNotice(null), 2200);
      return true;
    } catch {
      setNotice({ tone: "warn", text: "Save failed — check your connection and retry." });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function exportCut() {
    // export always renders what is SAVED — save first if dirty
    if (dirty) {
      const ok = await saveCut();
      if (!ok) return;
    }
    const { edit, error } = snapshot();
    if (error) return setNotice({ tone: "warn", text: `Out of contract: ${error}` });
    setBusy(true);
    try {
      const res = await startRender(projectId, JSON.stringify(edit));
      if (res && "error" in res && res.error) setNotice({ tone: "warn", text: res.error });
      else {
        setNotice({ tone: "ok", text: "Render queued — progress below." });
        setTimeout(() => setNotice(null), 2600);
        setJobsTick((t) => t + 1); // poll immediately
      }
    } catch {
      setNotice({ tone: "warn", text: "Export failed — check your connection and retry." });
    } finally {
      setBusy(false);
    }
  }

  async function resetToBoard() {
    if (!boardEdit) return;
    if (!confirm("Replace the saved cut with a fresh one built from the shot board?")) return;
    setBusy(true);
    try {
      const res = await saveProjectEdit(projectId, JSON.stringify(boardEdit));
      if (res && "error" in res && res.error) setNotice({ tone: "warn", text: res.error });
      else location.reload();
    } finally {
      setBusy(false);
    }
  }

  // ---- render jobs strip (polls while anything is active) ----
  type JobRow = Awaited<ReturnType<typeof getRenderJobs>>[number];
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [jobsTick, setJobsTick] = useState(0);
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const rows = await getRenderJobs(projectId);
        if (stop) return;
        setJobs(rows);
        const active = rows.some((r) => r.status === "QUEUED" || r.status === "RENDERING");
        timer = setTimeout(poll, active ? 2500 : 15000);
      } catch {
        if (!stop) timer = setTimeout(poll, 10000);
      }
    };
    poll();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [projectId, jobsTick]);

  if (!startEdit) {
    return (
      <div className="screen">
        <div className="screen-pad" style={{ display: "flex", justifyContent: "center", paddingTop: 70 }}>
          <EmptyHero
            title="Nothing to cut yet"
            desc="Generate a clip in Gen space (or a shot in the Storyboard) and it lands here — then trim, reorder, and export."
          >
            <Link href={`/studio?p=${projectId}`}>
              <Button>Go to Gen space</Button>
            </Link>
          </EmptyHero>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "0 18px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 4px 12px", flexWrap: "wrap" }}>
        <MonoLabel>Assembly cut</MonoLabel>
        <span style={{ font: "var(--text-mono-meta)", color: "var(--fg-3)" }}>
          {loadedFrom === "saved"
            ? "saved cut loaded"
            : `${attachedCount} clip${attachedCount === 1 ? "" : "s"} from the board`}
        </span>
        {loadedFrom === "saved" && boardEdit && (
          <button
            onClick={resetToBoard}
            disabled={busy}
            style={{
              font: "var(--text-caption)", color: "var(--fg-2)", background: "none",
              border: "none", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3,
            }}
          >
            Reset to board
          </button>
        )}
        {dirty && <span style={{ font: "var(--text-mono-meta)", color: "var(--warning)" }}>unsaved</span>}
        {liveIssue && (
          <span role="status" style={{ font: "var(--text-small)", color: "var(--warning)" }}>
            Out of contract: {liveIssue}
          </span>
        )}
        {notice && (
          <span
            role="status"
            style={{ font: "var(--text-small)", color: notice.tone === "ok" ? "var(--positive)" : "var(--warning)" }}
          >
            {notice.text}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <Chip mono interactive={false} title="The render target. Phase 2 adds your own templates and APIs.">
          Target · worker ffmpeg
        </Chip>
        <Button variant="glass" size="sm" onClick={saveCut} disabled={status !== "ready" || !dirty || busy}>
          {busy ? "Working…" : "Save cut"}
        </Button>
        <Button size="sm" onClick={exportCut} disabled={status !== "ready" || busy || !!liveIssue}>
          Export MP4
        </Button>
      </div>

      {status === "failed" ? (
        <div className="al-panel" style={{ padding: 24 }}>
          <p style={{ font: "var(--text-body)", color: "var(--danger)", margin: 0 }}>
            The editor failed to load — check the console, then reload the page.
          </p>
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: "flex", gap: 12 }}>
          {/* Assets panel — click a clip to append it to the cut */}
          <aside style={{ width: 220, flex: "none", display: "flex", flexDirection: "column", border: "1px solid var(--line-2)", borderRadius: "var(--radius-lg)", overflow: "hidden", maxHeight: "100%" }}>
            <div style={{ padding: "9px 12px", borderBottom: "1px solid var(--line-2)", flex: "none" }}><MonoLabel>Assets</MonoLabel></div>
            <div style={{ flex: 1, overflow: "auto", padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
              {media.length === 0 ? (
                <p style={{ font: "var(--text-caption)", color: "var(--fg-3)", margin: 0 }}>No media yet — generate in Gen space, then click a clip here to add it to the cut.</p>
              ) : media.map((m) => (
                <button key={m.id} onClick={() => appendAsset(m)} title="Add to the cut" disabled={status !== "ready"}
                  style={{ position: "relative", border: "1px solid var(--line-2)", borderRadius: "var(--radius-md)", overflow: "hidden", background: "#000", aspectRatio: "16 / 10", cursor: "pointer", padding: 0 }}>
                  {m.kind === "video"
                    ? <video src={m.src} muted playsInline preload="metadata" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    // eslint-disable-next-line @next/next/no-img-element
                    : <img src={m.src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                  <span aria-hidden style={{ position: "absolute", top: 4, left: 4, width: 18, height: 18, display: "grid", placeItems: "center", borderRadius: 4, background: "rgba(0,0,0,.6)", color: "#fff", font: "var(--text-mono-meta)" }}>+</span>
                  <span style={{ position: "absolute", bottom: 4, right: 4, font: "var(--text-mono-meta)", color: "#fff", background: "rgba(0,0,0,.6)", padding: "0 5px", borderRadius: 3 }}>{m.kind === "video" ? `${Math.round(m.seconds)}s` : "img"}</span>
                </button>
              ))}
            </div>
          </aside>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <div
            ref={studioRef}
            data-shotstack-studio
            className="al-panel"
            style={{ flex: 1, minHeight: 240, overflow: "hidden", borderRadius: "var(--radius-lg)" }}
          />
          <div
            ref={timelineRef}
            data-shotstack-timeline
            style={{
              height: 280,
              overflow: "hidden",
              marginTop: 12,
              borderRadius: "var(--radius-lg)",
              border: "1px solid var(--line-2)",
            }}
          />
          {jobs.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }} aria-label="Renders">
              <MonoLabel>Renders</MonoLabel>
              {jobs.map((j) => (
                <div key={j.id} className="glass-chip" style={{ display: "flex", alignItems: "center", gap: 10, borderRadius: "var(--radius-md)", padding: "8px 12px" }}>
                  <span className="mono-label" style={{ color: j.status === "FAILED" ? "var(--danger)" : j.status === "DONE" ? "var(--positive)" : "var(--fg-2)" }}>
                    {j.status}
                  </span>
                  {(j.status === "QUEUED" || j.status === "RENDERING") && (
                    <span style={{ flex: 1, height: 4, borderRadius: 99, background: "rgba(255,255,255,.08)", overflow: "hidden" }} aria-label={`progress ${j.progress}%`}>
                      <span style={{ display: "block", height: "100%", width: `${j.progress}%`, background: "linear-gradient(90deg, rgba(255,255,255,.55), #fff)", transition: "width .4s var(--ease-out)" }} />
                    </span>
                  )}
                  {j.status === "FAILED" && (
                    <span style={{ flex: 1, font: "var(--text-small)", color: "var(--danger)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={j.error}>
                      {j.error || "render failed"} — fix the cut and export again
                    </span>
                  )}
                  {j.status === "DONE" && j.url && (
                    <>
                      <span style={{ flex: 1 }} />
                      <a href={j.url} download style={{ font: "var(--text-small)", color: "var(--fg-1)", textDecoration: "underline", textUnderlineOffset: 3 }}>
                        Download MP4
                      </a>
                    </>
                  )}
                  {j.status === "DONE" && !j.url && (
                    <span style={{ flex: 1, font: "var(--text-small)", color: "var(--fg-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      Render finished — file not ready yet, reload to fetch it
                    </span>
                  )}
                  <span style={{ font: "var(--text-mono-meta)", color: "var(--fg-4)" }} suppressHydrationWarning>
                    {new Date(j.createdAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              ))}
            </div>
          )}
          </div>
        </div>
      )}
    </div>
  );
}
