"use client";

import { useRef, useState, useTransition } from "react";
import type { EntityDTO, GenerationDTO, ShotDTO } from "@/lib/types";
import {
  uploadCandidates,
  attachGeneration,
  detachGeneration,
  softDeleteGeneration,
} from "@/lib/actions";

export function CandidatePanel({
  candidates,
  shots,
  entities,
  selectedShot,
  projectId,
}: {
  candidates: GenerationDTO[];
  shots: ShotDTO[];
  entities: EntityDTO[];
  selectedShot: ShotDTO | null;
  projectId: string;
}) {
  return (
    <div className="p-3 flex flex-col gap-5">
      <section aria-label="Candidate zone">
        <h2 className="mono-label text-faint mb-2">
          Candidates
        </h2>
        <UploadZone projectId={projectId} selectedShot={selectedShot} entities={entities} />
        {candidates.length === 0 ? (
          <p className="text-xs text-dim mt-2 leading-relaxed">
            Render in ComfyUI with your copied prompt, then drop the result
            above — every version stays linked to its prompt and entities.
          </p>
        ) : (
          <ul className="flex flex-col gap-2 mt-2">
            {candidates.map((c) => (
              <CandidateCard key={c.id} gen={c} shots={shots} />
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Shot history">
        <h2 className="mono-label text-faint mb-2">
          History
          {selectedShot && (
            <span className="font-mono text-xs text-faint normal-case tracking-normal ml-2">
              Shot {String(selectedShot.number).padStart(2, "0")}
            </span>
          )}
        </h2>
        {!selectedShot ? (
          <p className="text-xs text-dim">Select a shot to see its versions.</p>
        ) : selectedShot.generations.length === 0 ? (
          <p className="text-xs text-dim leading-relaxed">
            Nothing attached yet — drag a candidate onto this shot&apos;s card,
            or use “Attach” on a candidate.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {selectedShot.generations.map((g) => (
              <HistoryCard key={g.id} gen={g} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function UploadZone({
  projectId,
  selectedShot,
  entities,
}: {
  projectId: string;
  selectedShot: ShotDTO | null;
  entities: EntityDTO[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setError(null);
    startTransition(async () => {
      const res = await uploadCandidates(projectId, fd);
      if (res && "error" in res && res.error) setError(res.error);
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  return (
    <>
      <button
        className={`w-full border border-dashed rounded-[var(--radius-lg)] p-4 text-center text-xs transition-colors ${
          dragOver ? "border-accent text-accent" : "border-edge text-dim hover:text-ink"
        } disabled:opacity-50`}
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
        {pending
          ? "Uploading…"
          : dragOver
            ? "Drop to add candidates"
            : "Drop renders here or click to upload"}
        {selectedShot && !pending && (
          <span className="block mt-1 text-[10px] text-faint">
            will carry Shot {String(selectedShot.number).padStart(2, "0")}&apos;s
            prompt &amp; entities ({selectedShot.entityIds.length})
          </span>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,video/*"
        className="hidden"
        onChange={(e) => e.target.files && upload(e.target.files)}
      />
      {error && (
        <p className="text-xs text-danger mt-1" role="alert">
          {error} — try again.
        </p>
      )}
    </>
  );
}

function Media({ gen }: { gen: GenerationDTO }) {
  return gen.kind === "video" ? (
    <video
      src={gen.url}
      controls
      muted
      playsInline
      preload="metadata"
      className="w-full rounded-[var(--radius-sm)] bg-surface"
    />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={gen.url} alt="" className="w-full rounded-[var(--radius-sm)] object-cover bg-surface" />
  );
}

function useAction() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
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
  return { pending, error, run };
}

function CandidateCard({ gen, shots }: { gen: GenerationDTO; shots: ShotDTO[] }) {
  const { pending, error, run } = useAction();

  return (
    <li
      className="bg-raised border border-edge rounded-[var(--radius-lg)] p-2 flex flex-col gap-1.5"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("application/x-artlio-generation", gen.id);
        e.dataTransfer.effectAllowed = "link";
      }}
    >
      <Media gen={gen} />
      {gen.promptText && (
        <p className="text-[11px] text-dim line-clamp-2">{gen.promptText}</p>
      )}
      <div className="flex items-center gap-2">
        <select
          aria-label="Attach to shot"
          className="bg-surface border border-edge rounded-[var(--radius-sm)] text-xs px-1.5 py-1 flex-1 min-w-0 disabled:opacity-50"
          disabled={pending || shots.length === 0}
          value=""
          onChange={(e) => {
            const shotId = e.target.value;
            if (shotId) run(() => attachGeneration(gen.id, shotId));
          }}
        >
          <option value="" disabled>
            {shots.length === 0 ? "No shots yet" : "Attach to shot…"}
          </option>
          {shots.map((s) => (
            <option key={s.id} value={s.id}>
              Shot {String(s.number).padStart(2, "0")}
              {s.title ? ` · ${s.title}` : ""}
            </option>
          ))}
        </select>
        <button
          className="text-xs text-faint hover:text-ink disabled:opacity-50"
          disabled={pending}
          onClick={() => run(() => softDeleteGeneration(gen.id))}
        >
          Discard
        </button>
      </div>
      {error && (
        <p className="text-[11px] text-danger" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

function HistoryCard({ gen }: { gen: GenerationDTO }) {
  const { pending, error, run } = useAction();

  return (
    <li className="bg-raised border border-edge rounded-[var(--radius-lg)] p-2 flex flex-col gap-1.5">
      <div className="flex items-center">
        <span className="font-mono text-[10px] bg-accent-soft text-ink rounded-full px-2 py-0.5">
          v{gen.version}
        </span>
        {/* locale rendering differs between server and client — suppress the diff */}
        <time
          className="ml-auto font-mono text-[10px] text-faint"
          dateTime={gen.createdAt}
          suppressHydrationWarning
        >
          {new Date(gen.createdAt).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </time>
      </div>
      <Media gen={gen} />
      {gen.promptText && (
        <p className="text-[11px] text-dim line-clamp-2">{gen.promptText}</p>
      )}
      {error && (
        <p className="text-[11px] text-danger" role="alert">
          {error}
        </p>
      )}
      <button
        className="self-end text-xs text-faint hover:text-ink disabled:opacity-50"
        disabled={pending}
        onClick={() => run(() => detachGeneration(gen.id))}
      >
        Detach → candidates
      </button>
    </li>
  );
}
