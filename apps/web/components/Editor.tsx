"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { artlioEdit, type ArtlioEdit } from "@artlio/core";
import { getRenderJobs, saveProjectEdit, startRender } from "@/lib/actions";
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
  events: { on: (e: string, cb: () => void) => (() => void) | void };
}
type StudioHandles = {
  edit: StudioEdit;
  dispose: () => void;
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

  useEffect(() => {
    if (!initialEdit) return;
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

        const edit = new Edit(initialEdit as never);
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
  }, [projectId, initialEdit]);

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

  if (!initialEdit) {
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
        <>
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
                  <span style={{ font: "var(--text-mono-meta)", color: "var(--fg-4)" }} suppressHydrationWarning>
                    {new Date(j.createdAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
