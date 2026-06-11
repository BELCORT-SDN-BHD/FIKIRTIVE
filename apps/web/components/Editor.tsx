"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { artlioEdit, type ArtlioEdit } from "@artlio/core";
import { Button, Chip, EmptyHero, MonoLabel } from "./ds";

/**
 * Phase ② (mock + UI): Shotstack Studio embedded as the assembly-cut editor.
 * The Studio session IS the UI; our contract (artlioEdit) polices everything
 * read back from it — getEdit() snapshots are parsed canonically before any
 * persistence, and a debounced validator flags out-of-contract edits as you
 * work (codex review: don't let visible state silently diverge).
 *
 * MOCK persistence: localStorage per project. Dies when the phase-③ tracer
 * lands (RenderJob row + server persistence replace it). Export is therefore
 * "Validate cut" here — the real Export button ships WITH the pipeline, so no
 * teaser chrome.
 */
const editKey = (projectId: string) => `artlio:edit:${projectId}`;

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
  initialEdit,
  attachedCount,
  onDirtyChange,
}: {
  projectId: string;
  initialEdit: ArtlioEdit | null;
  attachedCount: number;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const studioRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const handles = useRef<StudioHandles | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [dirty, setDirtyState] = useState(false);
  const [loadedFrom, setLoadedFrom] = useState<"board" | "saved" | "quarantined">("board");
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

        // saved local cut wins over the shot-board mock (MOCK: localStorage).
        // A saved cut that no longer parses is QUARANTINED, not deleted —
        // contract evolution must not silently eat work (codex review).
        let template: unknown = initialEdit;
        let from: typeof loadedFrom = "board";
        const raw = localStorage.getItem(editKey(projectId));
        if (raw) {
          try {
            template = artlioEdit.parse(JSON.parse(raw));
            from = "saved";
          } catch {
            localStorage.setItem(`${editKey(projectId)}:quarantine-${Date.now()}`, raw);
            localStorage.removeItem(editKey(projectId));
            from = "quarantined";
          }
        }

        const edit = new Edit(template as never);
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
        setLoadedFrom(from);
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

  function saveCut() {
    const { edit, error } = snapshot();
    if (error) return setNotice({ tone: "warn", text: `Out of contract: ${error}` });
    localStorage.setItem(editKey(projectId), JSON.stringify(edit)); // MOCK persistence
    setDirty(false);
    setLoadedFrom("saved");
    setNotice({ tone: "ok", text: "Cut saved locally." });
    setTimeout(() => setNotice(null), 2200);
  }

  function validateCut() {
    const { edit, error } = snapshot();
    if (error) return setNotice({ tone: "warn", text: `Out of contract: ${error}` });
    const secs = Math.round(
      edit!.timeline.tracks.flatMap((t) => t.clips).reduce((m, c) => Math.max(m, c.start + c.length), 0),
    );
    setNotice({
      tone: "ok",
      text: `Valid cut — ${secs}s, ready for the render pipeline (ships next slice).`,
    });
    setTimeout(() => setNotice(null), 3500);
  }

  function resetToBoard() {
    if (!confirm("Discard the locally saved cut and rebuild from the shot board?")) return;
    localStorage.removeItem(editKey(projectId));
    location.reload(); // simplest correct re-init for the mock phase
  }

  if (!initialEdit) {
    return (
      <div className="screen">
        <div className="screen-pad" style={{ display: "flex", justifyContent: "center", paddingTop: 70 }}>
          <EmptyHero
            title="Nothing to cut yet"
            desc="The editor starts from your shot board — attach a render to a shot and it lands here as a clip."
          >
            <Link href={`/?p=${projectId}`}>
              <Button>Go to the workbench</Button>
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
        {loadedFrom === "saved" && (
          <button
            onClick={resetToBoard}
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
        {loadedFrom === "quarantined" && !notice && (
          <span role="status" style={{ font: "var(--text-small)", color: "var(--warning)" }}>
            A saved cut no longer matched the contract — it was quarantined, this cut is rebuilt from the board.
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
        <Button variant="glass" size="sm" onClick={validateCut} disabled={status !== "ready"}>
          Validate cut
        </Button>
        <Button size="sm" onClick={saveCut} disabled={status !== "ready" || !dirty}>
          Save cut
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
        </>
      )}
    </div>
  );
}
