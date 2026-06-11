"use client";

import { useState, useTransition } from "react";
import type { EntityDTO, ShotDTO, ShotStatusDTO } from "@/lib/types";
import {
  createShot,
  updateShotTitle,
  updateShotStatus,
  softDeleteShot,
  attachGeneration,
} from "@/lib/actions";

const STATUS_META: Record<ShotStatusDTO, { label: string; className: string }> = {
  DRAFT: { label: "Draft", className: "text-faint border-edge" },
  EXPORTED: { label: "Exported", className: "text-brand border-brand/40" },
  ATTACHED: { label: "Attached", className: "text-ink border-edge-strong" },
  FINAL: { label: "Final", className: "text-positive border-positive/40" },
};

export function ShotStrip({
  shots,
  entities,
  projectId,
  selectedShotId,
  onSelectShot,
}: {
  shots: ShotDTO[];
  entities: EntityDTO[];
  projectId: string;
  selectedShotId: string | null;
  onSelectShot: (id: string) => void;
}) {
  const [pending, startTransition] = useTransition();

  function addShot() {
    startTransition(async () => {
      const res = await createShot(projectId);
      if ("id" in res && res.id) onSelectShot(res.id);
    });
  }

  return (
    <section className="p-4 flex-1" aria-label="Shot board">
      <h2 className="mono-label text-faint mb-3">
        Shot Board
      </h2>

      {shots.length === 0 ? (
        <div className="border border-dashed border-edge rounded-[var(--radius-lg)] p-8 text-center">
          <p className="text-sm text-dim mb-3">
            Shots are the spine of your project — each holds a prompt and its
            generation history.
          </p>
          <button
            onClick={addShot}
            disabled={pending}
            className="btn-primary text-sm px-4 py-2"
          >
            {pending ? "Adding…" : "+ Add Shot 01"}
          </button>
        </div>
      ) : (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
          {shots.map((s) => (
            <ShotCard
              key={s.id}
              shot={s}
              entities={entities}
              selected={s.id === selectedShotId}
              onSelect={() => onSelectShot(s.id)}
            />
          ))}
          <button
            onClick={addShot}
            disabled={pending}
            className="border border-dashed border-edge rounded-[var(--radius-lg)] min-h-40 text-dim hover:text-ink hover:border-faint text-sm disabled:opacity-50"
          >
            {pending ? "Adding…" : "+ Add shot"}
          </button>
        </div>
      )}
    </section>
  );
}

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
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(shot.title);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = shot.generations[0]; // version desc
  const byId = new Map(entities.map((e) => [e.id, e]));

  function run(fn: () => Promise<{ error?: string } | { ok: boolean } | void>) {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fn();
        if (res && "error" in res && res.error) setError(res.error);
      } catch {
        setError("Something went wrong — try again.");
      }
    });
  }

  return (
    <div
      className={`bg-raised border rounded-[var(--radius-lg)] p-3 flex flex-col gap-2 cursor-pointer transition-colors ${
        selected ? "border-accent" : dragOver ? "border-accent border-dashed" : "border-edge"
      }`}
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
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-faint">
          SHOT {String(shot.number).padStart(2, "0")}
        </span>
        <select
          aria-label="Shot status"
          value={shot.status}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            const status = e.target.value as ShotStatusDTO;
            run(() => updateShotStatus(shot.id, status));
          }}
          className={`ml-auto bg-transparent border rounded-full text-[10px] font-mono px-2 py-0.5 ${STATUS_META[shot.status].className}`}
        >
          {Object.entries(STATUS_META).map(([value, m]) => (
            <option key={value} value={value} className="bg-raised text-ink">
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <div className="aspect-video bg-surface rounded-[var(--radius-sm)] overflow-hidden flex items-center justify-center">
        {latest ? (
          latest.kind === "video" ? (
            <video src={latest.url} muted loop playsInline preload="metadata" className="w-full h-full object-cover" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={latest.url} alt="" className="w-full h-full object-cover" />
          )
        ) : (
          <span className="text-xs text-faint px-3 text-center">
            {dragOver ? "Drop to attach" : "Drag a candidate here to attach"}
          </span>
        )}
      </div>

      <input
        value={title}
        placeholder="Untitled shot"
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => {
          if (title !== shot.title) run(() => updateShotTitle(shot.id, title));
        }}
        className="bg-transparent text-sm font-medium outline-none placeholder:text-faint"
      />

      <div className="flex flex-wrap gap-1 min-h-5">
        {shot.entityIds.map((id) => {
          const e = byId.get(id);
          return (
            <span key={id} className="mention" data-entity-type={e?.type ?? "BRAND"}>
              @{e?.name ?? "deleted"}
            </span>
          );
        })}
        {latest && (
          <span className="ml-auto font-mono text-[10px] text-faint self-center">
            v{latest.version}
          </span>
        )}
      </div>

      {error && (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
      <button
        className="self-end text-[11px] text-faint hover:text-ink disabled:opacity-50"
        disabled={pending}
        onClick={(e) => {
          e.stopPropagation();
          run(() => softDeleteShot(shot.id));
        }}
      >
        Delete
      </button>
    </div>
  );
}
