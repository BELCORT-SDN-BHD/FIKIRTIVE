"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { artlioEdit, type ArtlioEdit } from "@artlio/core";
import { Button, Chip, EmptyHero, MonoLabel } from "./ds";

/**
 * Phase ② (mock + UI): Shotstack Studio embedded as the assembly-cut editor.
 * The Studio session IS the UI; our contract (artlioEdit) polices everything
 * read back from it — getEdit() snapshots are parsed canonically before any
 * persistence.
 *
 * MOCK persistence: localStorage per project. Dies when the phase-③ tracer
 * lands (RenderJob row + server persistence replace it). Export is therefore
 * "Validate cut" here — the real Export button ships WITH the pipeline, so no
 * teaser chrome.
 */
const editKey = (projectId: string) => `artlio:edit:${projectId}`;

type StudioHandles = {
  edit: { getEdit: () => unknown; events: { on: (e: string, cb: () => void) => () => void } };
  dispose: () => void;
};

export function Editor({
  projectId,
  initialEdit,
  attachedCount,
}: {
  projectId: string;
  initialEdit: ArtlioEdit | null;
  attachedCount: number;
}) {
  const studioRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const handles = useRef<StudioHandles | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);

  useEffect(() => {
    if (!initialEdit) return;
    let disposed = false;

    (async () => {
      try {
        // Studio is browser-only (PixiJS) — import inside the effect, never SSR
        const { Edit, Canvas, Controls, Timeline, UIController } = await import(
          "@shotstack/shotstack-studio"
        );

        // saved local cut wins over the shot-board mock (MOCK: localStorage)
        let template: unknown = initialEdit;
        try {
          const saved = localStorage.getItem(editKey(projectId));
          if (saved) template = artlioEdit.parse(JSON.parse(saved));
        } catch {
          localStorage.removeItem(editKey(projectId)); // corrupted — fall back
        }

        const edit = new Edit(template as never);
        const canvas = new Canvas(edit);
        const ui = UIController.create(edit, canvas);
        await canvas.load();
        await edit.load();
        const timeline = new Timeline(edit, timelineRef.current as HTMLElement, {
          resizable: true,
        });
        await timeline.load();
        const controls = new Controls(edit);
        await controls.load();

        if (disposed) {
          timeline.dispose?.();
          canvas.dispose?.();
          ui.dispose?.();
          return;
        }

        const off = edit.events.on("edit:changed", () => setDirty(true));
        handles.current = {
          edit: edit as never,
          dispose: () => {
            off?.();
            timeline.dispose?.();
            canvas.dispose?.();
            ui.dispose?.();
          },
        };
        setStatus("ready");
      } catch (e) {
        console.error("[editor] studio failed to load", e);
        setStatus("failed");
      }
    })();

    return () => {
      disposed = true;
      handles.current?.dispose();
      handles.current = null;
    };
  }, [projectId, initialEdit]);

  /** read back the Studio snapshot and canonicalize through the contract */
  function snapshot(): { edit?: ArtlioEdit; error?: string } {
    const h = handles.current;
    if (!h) return { error: "Editor not ready yet." };
    const result = artlioEdit.safeParse(h.edit.getEdit());
    if (!result.success) {
      const first = result.error.issues[0];
      return { error: `${first?.message ?? "invalid edit"}${first?.path?.length ? ` (at ${first.path.join(".")})` : ""}` };
    }
    return { edit: result.data };
  }

  function saveCut() {
    const { edit, error } = snapshot();
    if (error) return setNotice({ tone: "warn", text: `Out of contract: ${error}` });
    localStorage.setItem(editKey(projectId), JSON.stringify(edit)); // MOCK persistence
    setDirty(false);
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
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 4px 12px" }}>
        <MonoLabel>Assembly cut</MonoLabel>
        <span style={{ font: "var(--text-mono-meta)", color: "var(--fg-3)" }}>
          {attachedCount} clip{attachedCount === 1 ? "" : "s"} from the board
        </span>
        {dirty && <span style={{ font: "var(--text-mono-meta)", color: "var(--warning)" }}>unsaved</span>}
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
