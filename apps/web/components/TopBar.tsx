"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ProjectDTO } from "@/lib/types";
import { createProject } from "@/lib/actions";

export function TopBar({
  project,
  projects,
}: {
  project: ProjectDTO;
  projects: ProjectDTO[];
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();

  function submitNew() {
    const trimmed = name.trim();
    if (!trimmed) return setCreating(false);
    startTransition(async () => {
      const res = await createProject(trimmed);
      setCreating(false);
      setName("");
      if ("id" in res) router.push(`/?p=${res.id}`);
    });
  }

  return (
    <header className="flex items-center gap-4 px-4 h-12 border-b border-edge bg-surface shrink-0">
      <span className="font-display font-semibold tracking-tight text-lg">
        Artlio
      </span>
      <span className="text-faint text-sm">/</span>

      <select
        aria-label="Project"
        className="bg-raised border border-edge rounded-[var(--radius-sm)] text-sm px-2 py-1 max-w-56"
        value={project.id}
        onChange={(e) => router.push(`/?p=${e.target.value}`)}
      >
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>

      {creating ? (
        <span className="flex items-center gap-2">
          <input
            autoFocus
            className="bg-raised border border-edge rounded-[var(--radius-sm)] text-sm px-2 py-1 w-44"
            placeholder="Project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitNew();
              if (e.key === "Escape") setCreating(false);
            }}
            disabled={pending}
          />
          <button
            className="text-sm text-accent disabled:opacity-50"
            onClick={submitNew}
            disabled={pending}
          >
            {pending ? "Creating…" : "Create"}
          </button>
        </span>
      ) : (
        <button
          className="text-sm text-dim hover:text-ink"
          onClick={() => setCreating(true)}
        >
          + New project
        </button>
      )}

      <span className="ml-auto font-mono text-xs text-faint">
        M0 · local · founder
      </span>
    </header>
  );
}
