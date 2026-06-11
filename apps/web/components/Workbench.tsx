"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import type { EntityDTO, GenerationDTO, ProjectDTO, ShotDTO, ShotStatusDTO } from "@/lib/types";
import {
  attachGeneration,
  createShot,
  detachGeneration,
  softDeleteGeneration,
  softDeleteShot,
  updateShotStatus,
  updateShotTitle,
  uploadCandidates,
} from "@/lib/actions";
import { AppShell } from "./AppShell";
import { Composer } from "./Composer";
import { Badge, Button, Chip, EmptyHero, IcImage, IconButton, IcX, MediaCard, MonoLabel, PopMenu } from "./ds";

const STATUSES: { value: ShotStatusDTO; label: string }[] = [
  { value: "DRAFT", label: "Draft" },
  { value: "EXPORTED", label: "Exported" },
  { value: "ATTACHED", label: "Attached" },
  { value: "FINAL", label: "Final" },
];

function useAction() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function run(fn: () => Promise<{ error?: string } | { ok: boolean } | { id: string } | void>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fn();
        if (res && "error" in res && res.error) setError(res.error);
        else after?.();
      } catch {
        setError("Something went wrong — try again.");
      }
    });
  }
  return { pending, error, run };
}

export function Workbench({
  project,
  projects,
  entities,
  shots,
  candidates,
}: {
  project: ProjectDTO;
  projects: ProjectDTO[];
  entities: EntityDTO[];
  shots: ShotDTO[];
  candidates: GenerationDTO[];
}) {
  const [selectedShotId, setSelectedShotId] = useState<string | null>(shots[0]?.id ?? null);
  const selectedShot = shots.find((s) => s.id === selectedShotId) ?? null;
  const [historyFilter, setHistoryFilter] = useState<"unattached" | "shot">("unattached");

  // switching shots OR navigating away replaces the composer — never silently
  // drop unsaved edits
  const [composerDirty, setComposerDirty] = useState(false);
  const confirmLeave = () =>
    !composerDirty || confirm("Discard unsaved prompt changes on the current shot?");
  function selectShot(id: string) {
    if (id !== selectedShotId && !confirmLeave()) return;
    setSelectedShotId(id);
  }

  const board = useAction();

  function addShot() {
    board.run(
      () =>
        createShot(project.id).then((res) => {
          if (res && "id" in res && res.id) setSelectedShotId(res.id);
          return res;
        }),
    );
  }

  const historyItems =
    historyFilter === "shot" && selectedShot ? selectedShot.generations : candidates;

  return (
    <>
      {/* <1024: phase 1 is desktop-first — read-only notice (design doc D9) */}
      <div className="lg:hidden bg-accent-soft text-ink text-sm px-4 py-2 text-center" role="status">
        Artlio works best on a desktop browser — this view is read-only.
      </div>

      <AppShell
        view="workbench"
        title="Workbench"
        confirmLeave={confirmLeave}
        project={project}
        projects={projects}
      >
        <div className="flex flex-col flex-1 min-h-0 max-lg:pointer-events-none">
          <div className="screen">
            <div className="screen-pad">
              {/* ---------- shot board ---------- */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "10px 0 14px" }}>
                <MonoLabel>Shot board</MonoLabel>
                {shots.length > 0 && (
                  <Button variant="glass" size="sm" onClick={addShot} disabled={board.pending} style={{ marginLeft: "auto" }}>
                    {board.pending ? "Adding…" : "+ Add shot"}
                  </Button>
                )}
              </div>

              {board.error && (
                <p role="alert" style={{ font: "var(--text-small)", color: "var(--danger)", margin: "0 0 10px" }}>
                  {board.error}
                </p>
              )}

              {shots.length === 0 ? (
                <div style={{ display: "flex", justifyContent: "center", padding: "48px 0 40px" }}>
                  <EmptyHero
                    title="Plan the film shot by shot"
                    desc={
                      entities.length === 0 ? (
                        <>
                          Each shot holds a prompt and its render history. Create your
                          subjects in the <Link href="/library" style={{ color: "var(--fg-1)", textDecoration: "underline", textUnderlineOffset: 3 }}>Library</Link> to @mention them.
                        </>
                      ) : (
                        "Each shot holds a prompt and its render history — @mention your elements to keep every frame on-model."
                      )
                    }
                  >
                    <Button onClick={addShot} disabled={board.pending}>
                      {board.pending ? "Adding…" : "Add Shot 01"}
                    </Button>
                  </EmptyHero>
                </div>
              ) : (
                <div className="scene-grid">
                  {shots.map((s) => (
                    <ShotCard
                      key={s.id}
                      shot={s}
                      entities={entities}
                      selected={s.id === selectedShotId}
                      onSelect={() => selectShot(s.id)}
                    />
                  ))}
                </div>
              )}

              {/* ---------- history / candidates ---------- */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "34px 0 0" }}>
                <MonoLabel>History</MonoLabel>
              </div>
              <div className="filters-row" style={{ marginTop: 10 }}>
                <Chip selected={historyFilter === "unattached"} onClick={() => setHistoryFilter("unattached")}>
                  Unattached · {candidates.length}
                </Chip>
                <Chip
                  selected={historyFilter === "shot"}
                  onClick={() => selectedShot && setHistoryFilter("shot")}
                  disabled={!selectedShot}
                >
                  {selectedShot ? `Shot ${String(selectedShot.number).padStart(2, "0")} · ${selectedShot.generations.length}` : "Select a shot"}
                </Chip>
              </div>

              <UploadZone projectId={project.id} selectedShot={selectedShot} />

              {historyItems.length === 0 ? (
                <p style={{ font: "var(--text-small)", color: "var(--fg-2)", margin: "14px 4px" }}>
                  {historyFilter === "unattached"
                    ? "Render in ComfyUI with your copied prompt, then drop the results above — every version stays linked to its prompt and elements."
                    : "Nothing attached to this shot yet — attach a candidate from the Unattached tab, or drag one onto the shot card."}
                </p>
              ) : (
                <div className="card-grid" style={{ marginTop: 14 }}>
                  {historyItems.map((g) => (
                    <GenerationCard
                      key={g.id}
                      gen={g}
                      mode={historyFilter}
                      shots={shots}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {selectedShot && (
            <Composer shot={selectedShot} entities={entities} onDirtyChange={setComposerDirty} />
          )}
        </div>
      </AppShell>
    </>
  );
}

/* ---------- shot card ---------- */

function ShotCard({
  shot,
  entities,
  selected,
  onSelect,
}: {
  shot: ShotDTO;
  entities: EntityDTO[];
  selected: boolean;
  onSelect: () => void;
}) {
  const { pending, error, run } = useAction();
  const [title, setTitle] = useState(shot.title);
  const [statusMenu, setStatusMenu] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const latest = shot.generations[0]; // version desc
  const byId = new Map(entities.map((e) => [e.id, e]));

  return (
    <div className="fade-rise" style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <MediaCard
        ratio="16:9"
        src={latest?.url ?? null}
        video={latest?.kind === "video"}
        selected={selected || dragOver}
        statusChip={`SHOT ${String(shot.number).padStart(2, "0")}${latest ? ` · V${latest.version}` : ""}`}
        onClick={onSelect}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("application/x-artlio-generation")) {
            e.preventDefault();
            setDragOver(true);
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const genId = e.dataTransfer.getData("application/x-artlio-generation");
          if (genId) run(() => attachGeneration(genId, shot.id));
        }}
        title={
          selected ? (
            <input
              value={title}
              placeholder="Untitled shot"
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => {
                if (title !== shot.title) run(() => updateShotTitle(shot.id, title));
              }}
              aria-label="Shot title"
              style={{
                background: "none", border: "none", outline: "none", color: "var(--fg-1)",
                font: "inherit", width: "100%", padding: 0,
              }}
            />
          ) : (
            shot.title || "Untitled shot"
          )
        }
        meta={dragOver ? "DROP TO ATTACH" : `${shot.entityIds.length} ELEMENTS · ${shot.generations.length} VERSIONS`}
        footer={
          <>
            <span style={{ display: "flex", gap: 4, flexWrap: "wrap", minWidth: 0, overflow: "hidden" }}>
              {shot.entityIds.slice(0, 3).map((id) => {
                const e = byId.get(id);
                return (
                  <span key={id} className="mention" data-entity-type={e?.type ?? "BRAND"} style={{ fontSize: 11 }}>
                    @{e?.name ?? "deleted"}
                  </span>
                );
              })}
              {shot.entityIds.length > 3 && (
                <span style={{ font: "var(--text-caption)", color: "var(--fg-3)" }}>+{shot.entityIds.length - 3}</span>
              )}
            </span>
            <span style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 4, flex: "none" }} onClick={(e) => e.stopPropagation()}>
              <Badge
                mono
                tone={shot.status === "FINAL" ? "positive" : shot.status === "ATTACHED" ? "accent" : "neutral"}
                role="button"
                tabIndex={0}
                aria-label="Shot status"
                style={{ cursor: "pointer" }}
                onClick={() => setStatusMenu(!statusMenu)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") setStatusMenu(!statusMenu);
                }}
              >
                {shot.status}
              </Badge>
              <PopMenu
                open={statusMenu}
                onClose={() => setStatusMenu(false)}
                side="up"
                align="right"
                heading="Shot status"
                items={STATUSES.map((s) => ({ value: s.value, label: s.label }))}
                value={shot.status}
                onSelect={(v) => run(() => updateShotStatus(shot.id, v))}
                width={180}
              />
              {selected && (
                <IconButton
                  label="Delete shot"
                  size="sm"
                  disabled={pending}
                  onClick={() => run(() => softDeleteShot(shot.id))}
                >
                  <IcX />
                </IconButton>
              )}
            </span>
          </>
        }
      />
      {error && (
        <p role="alert" style={{ font: "var(--text-caption)", color: "var(--danger)", margin: "6px 4px 0" }}>
          {error}
        </p>
      )}
    </div>
  );
}

/* ---------- history cards + upload ---------- */

function GenerationCard({
  gen,
  mode,
  shots,
}: {
  gen: GenerationDTO;
  mode: "unattached" | "shot";
  shots: ShotDTO[];
}) {
  const { pending, error, run } = useAction();
  const [attachMenu, setAttachMenu] = useState(false);

  return (
    <div
      className="fade-rise"
      draggable={mode === "unattached"}
      onDragStart={(e) => {
        e.dataTransfer.setData("application/x-artlio-generation", gen.id);
        e.dataTransfer.effectAllowed = "link";
      }}
    >
      <MediaCard
        ratio="16:9"
        src={gen.url}
        video={gen.kind === "video"}
        statusChip={mode === "shot" ? `V${gen.version}` : undefined}
        title={gen.promptText || undefined}
        meta={new Date(gen.createdAt)
          .toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
          .toUpperCase()}
        suppressHydrationWarning
        footer={
          <span style={{ display: "flex", alignItems: "center", gap: 6, width: "100%" }} onClick={(e) => e.stopPropagation()}>
            {mode === "unattached" ? (
              <>
                <span style={{ position: "relative", display: "inline-flex" }}>
                  <Chip selected={attachMenu} onClick={() => setAttachMenu(!attachMenu)} disabled={pending || shots.length === 0}>
                    {shots.length === 0 ? "No shots yet" : "Attach to shot…"}
                  </Chip>
                  <PopMenu
                    open={attachMenu}
                    onClose={() => setAttachMenu(false)}
                    side="up"
                    heading="Attach to"
                    items={shots.map((s) => ({
                      value: s.id,
                      label: `Shot ${String(s.number).padStart(2, "0")}${s.title ? ` · ${s.title}` : ""}`,
                    }))}
                    onSelect={(shotId) => run(() => attachGeneration(gen.id, shotId))}
                    width={240}
                  />
                </span>
                <span style={{ flex: 1 }} />
                <IconButton label="Discard" size="sm" disabled={pending} onClick={() => run(() => softDeleteGeneration(gen.id))}>
                  <IcX />
                </IconButton>
              </>
            ) : (
              <>
                <span style={{ flex: 1 }} />
                <Chip disabled={pending} onClick={() => run(() => detachGeneration(gen.id))}>
                  Detach → unattached
                </Chip>
              </>
            )}
          </span>
        }
      />
      {error && (
        <p role="alert" style={{ font: "var(--text-caption)", color: "var(--danger)", margin: "6px 4px 0" }}>
          {error}
        </p>
      )}
    </div>
  );
}

function UploadZone({ projectId, selectedShot }: { projectId: string; selectedShot: ShotDTO | null }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { pending, error, run } = useAction();
  const [dragOver, setDragOver] = useState(false);

  function upload(files: FileList | File[]) {
    const list = [...files];
    if (list.length === 0) return;
    const fd = new FormData();
    for (const f of list) fd.append("files", f);
    // associate provenance with the shot being worked on (prompt + entities)
    if (selectedShot) {
      fd.set("promptText", selectedShot.promptText);
      for (const id of selectedShot.entityIds) fd.append("entityIds", id);
    }
    run(async () => {
      const res = await uploadCandidates(projectId, fd);
      if (inputRef.current) inputRef.current.value = "";
      return res;
    });
  }

  return (
    <>
      <button
        className={`drop-zone${dragOver ? " over" : ""}`}
        disabled={pending}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            setDragOver(true);
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          upload(e.dataTransfer.files);
        }}
      >
        <span className="drop-zone-tile">
          <IcImage size={18} />
        </span>
        <span>
          {pending
            ? "Uploading…"
            : dragOver
              ? "Drop to add renders"
              : (
                <>
                  Drop renders here, or{" "}
                  <span style={{ color: "var(--fg-1)", textDecoration: "underline", textUnderlineOffset: 3 }}>browse</span>
                  {selectedShot
                    ? ` — they'll carry Shot ${String(selectedShot.number).padStart(2, "0")}'s prompt & elements (${selectedShot.entityIds.length})`
                    : ""}
                </>
              )}
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,video/*"
        className="hidden"
        aria-label="Upload renders"
        onChange={(e) => e.target.files && upload(e.target.files)}
      />
      {error && (
        <p role="alert" style={{ font: "var(--text-small)", color: "var(--danger)", margin: "8px 4px 0" }}>
          {error} — try again.
        </p>
      )}
    </>
  );
}
