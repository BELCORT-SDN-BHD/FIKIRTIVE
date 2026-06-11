"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { ProjectDTO } from "@/lib/types";
import { createProject } from "@/lib/actions";

const LAST_PROJECT_KEY = "artlio:lastProject";

/**
 * Vapor app shell: left sidebar rail (wordmark + surfaces) over the ambient
 * layer; pages render their own context bar + content in the main column.
 * `confirmLeave` guards navigation away from unsaved composer edits.
 */
export function AppShell({
  view,
  confirmLeave,
  contextBar,
  children,
}: {
  view: "workbench" | "library";
  confirmLeave?: () => boolean;
  contextBar?: React.ReactNode;
  children: React.ReactNode;
}) {
  // jump back to the project you were working in, not the default one
  const [workbenchHref, setWorkbenchHref] = useState("/");
  useEffect(() => {
    const p = localStorage.getItem(LAST_PROJECT_KEY);
    if (p) setWorkbenchHref(`/?p=${p}`);
  }, []);

  const guard = (e: React.MouseEvent) => {
    if (confirmLeave && !confirmLeave()) e.preventDefault();
  };

  const navItem = (active: boolean) =>
    `flex items-center gap-2.5 px-3 py-2 rounded-[var(--radius-md)] text-sm transition-colors ${
      active ? "glass-chip text-ink" : "text-dim hover:text-ink hover-bright border border-transparent"
    }`;

  return (
    <div className="flex flex-1 min-h-0">
      <nav
        aria-label="Main"
        className="w-52 shrink-0 flex flex-col gap-1 p-3 border-r border-edge bg-surface/60 backdrop-blur-xl max-lg:hidden"
      >
        <span className="font-semibold tracking-tight text-lg px-3 py-2">Artlio</span>

        <Link href={workbenchHref} onClick={guard} className={navItem(view === "workbench")}
          aria-current={view === "workbench" ? "page" : undefined}>
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
            <rect x="1" y="1" width="13" height="9" rx="2" stroke="currentColor" strokeWidth="1.3" />
            <path d="M1 12.5h13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          Workbench
        </Link>
        <Link href="/library" onClick={guard} className={navItem(view === "library")}
          aria-current={view === "library" ? "page" : undefined}>
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
            <circle cx="7.5" cy="7.5" r="6" stroke="currentColor" strokeWidth="1.3" />
            <path d="M7.5 4.5v6M4.5 7.5h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          Library
        </Link>

        <span className="flex-1" />
        <span className="mono-label text-ghost px-3 pb-1">M0 · cloud · founder</span>
      </nav>

      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        {/* <1024 the sidebar is hidden — keep page navigation alive in read-only mode */}
        <div className="lg:hidden flex items-center gap-1 px-4 py-2 border-b border-edge" role="navigation" aria-label="Pages">
          <span className="font-semibold tracking-tight mr-2">Artlio</span>
          <Link href={workbenchHref} onClick={guard}
            className={`text-sm px-2 py-1 rounded-[var(--radius-sm)] ${view === "workbench" ? "glass-chip text-ink" : "text-dim"}`}
            aria-current={view === "workbench" ? "page" : undefined}>
            Workbench
          </Link>
          <Link href="/library" onClick={guard}
            className={`text-sm px-2 py-1 rounded-[var(--radius-sm)] ${view === "library" ? "glass-chip text-ink" : "text-dim"}`}
            aria-current={view === "library" ? "page" : undefined}>
            Library
          </Link>
        </div>
        {contextBar}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">{children}</div>
      </div>
    </div>
  );
}

/** Workbench context bar: project switcher + create. */
export function ProjectBar({
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
    <header className="flex items-center gap-3 px-4 h-12 border-b border-edge shrink-0">
      <select
        aria-label="Project"
        className="glass-chip rounded-[var(--radius-md)] text-sm px-2.5 py-1.5 max-w-56 bg-transparent"
        value={project.id}
        onChange={(e) => {
          if (confirmLeave()) router.push(`/?p=${e.target.value}`);
        }}
      >
        {projects.map((p) => (
          <option key={p.id} value={p.id} className="bg-raised text-ink">
            {p.name}
          </option>
        ))}
      </select>

      {creating ? (
        <span className="flex items-center gap-2">
          <input
            autoFocus
            className="glass-chip bg-transparent rounded-[var(--radius-md)] text-sm px-2.5 py-1.5 w-44"
            placeholder="Project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitNew();
              if (e.key === "Escape") setCreating(false);
            }}
            disabled={pending}
          />
          <button className="text-sm text-ink disabled:opacity-50" onClick={submitNew} disabled={pending}>
            {pending ? "Creating…" : "Create"}
          </button>
        </span>
      ) : (
        <button className="text-sm text-dim hover:text-ink" onClick={() => setCreating(true)}>
          + New project
        </button>
      )}
    </header>
  );
}
