"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { ProjectDTO } from "@/lib/types";
import { createProject } from "@/lib/actions";

/**
 * Guard contract: when `confirmLeave` is provided (workbench), every
 * navigation away must pass it first — the composer may hold unsaved edits.
 */
function NavLinks({
  view,
  workbenchHref,
  confirmLeave,
}: {
  view: "workbench" | "library";
  workbenchHref: string;
  confirmLeave?: () => boolean;
}) {
  const base = "text-sm px-2 py-1 rounded-[var(--radius-sm)]";
  const guard = (e: React.MouseEvent) => {
    if (confirmLeave && !confirmLeave()) e.preventDefault();
  };
  return (
    <nav aria-label="Main" className="flex items-center gap-1">
      <Link
        href={workbenchHref}
        onClick={guard}
        className={`${base} ${view === "workbench" ? "text-ink bg-raised" : "text-dim hover:text-ink"}`}
        aria-current={view === "workbench" ? "page" : undefined}
      >
        Workbench
      </Link>
      <Link
        href="/library"
        onClick={guard}
        className={`${base} ${view === "library" ? "text-ink bg-raised" : "text-dim hover:text-ink"}`}
        aria-current={view === "library" ? "page" : undefined}
      >
        Library
      </Link>
    </nav>
  );
}

const LAST_PROJECT_KEY = "artlio:lastProject";

/** Library header: nav only — entities are owner-scoped, no project context. */
export function LibraryTopBar() {
  // jump back to the project you were working in, not the default one
  const [workbenchHref, setWorkbenchHref] = useState("/");
  useEffect(() => {
    const p = localStorage.getItem(LAST_PROJECT_KEY);
    if (p) setWorkbenchHref(`/?p=${p}`);
  }, []);

  return (
    <header className="flex items-center gap-4 px-4 h-12 border-b border-edge bg-surface shrink-0">
      <span className="font-display font-semibold tracking-tight text-lg">
        Artlio
      </span>
      <NavLinks view="library" workbenchHref={workbenchHref} />
      <span className="ml-auto font-mono text-xs text-faint">
        M0 · local · founder
      </span>
    </header>
  );
}

export function TopBar({
  project,
  projects,
  confirmLeave,
}: {
  project: ProjectDTO;
  projects: ProjectDTO[];
  confirmLeave: () => boolean;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    localStorage.setItem(LAST_PROJECT_KEY, project.id);
  }, [project.id]);

  function submitNew() {
    const trimmed = name.trim();
    if (!trimmed) return setCreating(false);
    if (!confirmLeave()) return;
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
      <NavLinks view="workbench" workbenchHref={`/?p=${project.id}`} confirmLeave={confirmLeave} />
      <span className="text-faint text-sm">/</span>

      <select
        aria-label="Project"
        className="bg-raised border border-edge rounded-[var(--radius-sm)] text-sm px-2 py-1 max-w-56"
        value={project.id}
        onChange={(e) => {
          if (confirmLeave()) router.push(`/?p=${e.target.value}`);
        }}
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
