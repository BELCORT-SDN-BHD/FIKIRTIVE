"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { ProjectDTO } from "@/lib/types";
import { createProject } from "@/lib/actions";
import { Badge, Dialog, IcAt, IcClapper, IcFolder, Input, PopMenu, Wordmark, Button } from "./ds";

const LAST_PROJECT_KEY = "artlio:lastProject";

/**
 * Prototype-faithful app shell: 236px sidenav (wordmark, project pill, nav
 * groups, footer) + 58px topbar + scrolling screen. `confirmLeave` guards
 * navigation away from unsaved composer edits.
 */
export function AppShell({
  view,
  title,
  confirmLeave,
  project,
  projects,
  topbar,
  children,
}: {
  view: "workbench" | "library";
  title: string;
  confirmLeave?: () => boolean;
  project?: ProjectDTO;
  projects?: ProjectDTO[];
  topbar?: React.ReactNode;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [workbenchHref, setWorkbenchHref] = useState("/");
  const [projectMenu, setProjectMenu] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (project) localStorage.setItem(LAST_PROJECT_KEY, project.id);
    const p = localStorage.getItem(LAST_PROJECT_KEY);
    if (p) setWorkbenchHref(`/?p=${p}`);
  }, [project]);

  const guard = (e: React.MouseEvent) => {
    if (confirmLeave && !confirmLeave()) e.preventDefault();
  };

  function switchProject(id: string) {
    if (id === "__new__") {
      setNaming(true);
      return;
    }
    if (confirmLeave && !confirmLeave()) return;
    router.push(`/?p=${id}`);
  }

  function submitNewProject() {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (confirmLeave && !confirmLeave()) return;
    startTransition(async () => {
      const res = await createProject(trimmed);
      setNaming(false);
      setName("");
      if ("id" in res) router.push(`/?p=${res.id}`);
    });
  }

  const projectItems = [
    ...(projects ?? []).map((p) => ({ value: p.id, label: p.name })),
    { value: "__new__", label: "+ New project", desc: "Start a fresh shot board" },
  ];

  return (
    <div className="app">
      <nav className="sidenav max-lg:hidden" aria-label="Main">
        <div className="sidenav-brand">
          <Wordmark />
        </div>

        <span style={{ position: "relative", display: "block" }}>
          <button
            className="sidenav-project"
            onClick={() => (project ? setProjectMenu(!projectMenu) : router.push(workbenchHref))}
            aria-haspopup="listbox"
            aria-expanded={projectMenu}
          >
            <IcFolder size={15} style={{ color: "var(--fg-3)", flexShrink: 0 }} />
            <span className="sidenav-project-name">{project ? project.name : "Open a project"}</span>
          </button>
          <PopMenu
            open={projectMenu}
            onClose={() => setProjectMenu(false)}
            side="down"
            heading="Projects"
            items={projectItems}
            value={project?.id}
            onSelect={switchProject}
            width={240}
          />
        </span>

        <div className="nav-group">
          <Link href={workbenchHref} onClick={guard} className={`navitem${view === "workbench" ? " active" : ""}`}
            aria-current={view === "workbench" ? "page" : undefined}>
            <IcClapper size={17} />
            <span className="lbl">Workbench</span>
          </Link>
        </div>
        <div className="nav-grouplabel">
          <span className="mono-label">Workspace</span>
        </div>
        <div className="nav-group">
          <Link href="/library" onClick={guard} className={`navitem${view === "library" ? " active" : ""}`}
            aria-current={view === "library" ? "page" : undefined}>
            <IcAt size={17} />
            <span className="lbl">Elements</span>
          </Link>
        </div>

        <div className="sidenav-foot">
          <div style={{ padding: "0 4px" }}>
            <Badge mono>M0 · cloud</Badge>
          </div>
          <div className="user-row">
            <span
              aria-hidden
              style={{
                width: 26, height: 26, borderRadius: 999, flex: "none",
                background: "var(--glass-2)", border: "1px solid var(--line-1)",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                fontSize: 10.5, fontWeight: 600, boxShadow: "var(--inset-light)",
              }}
            >
              F
            </span>
            <span className="user-name">founder</span>
          </div>
        </div>
      </nav>

      <div className="main">
        {/* <1024 the sidenav is hidden — keep page navigation alive in read-only mode */}
        <div className="lg:hidden flex items-center gap-1 px-4 py-2 border-b border-edge" role="navigation" aria-label="Pages">
          <Wordmark />
          <Link href={workbenchHref} onClick={guard}
            className={`text-sm px-2 py-1 rounded-[var(--radius-sm)] ${view === "workbench" ? "text-ink" : "text-dim"}`}
            aria-current={view === "workbench" ? "page" : undefined}>
            Workbench
          </Link>
          <Link href="/library" onClick={guard}
            className={`text-sm px-2 py-1 rounded-[var(--radius-sm)] ${view === "library" ? "text-ink" : "text-dim"}`}
            aria-current={view === "library" ? "page" : undefined}>
            Elements
          </Link>
        </div>

        <header className="topbar">
          <span className="topbar-title">{title}</span>
          {topbar}
          <span className="topbar-spacer" />
        </header>

        {children}
      </div>

      <Dialog
        open={naming}
        title="New project"
        onClose={() => setNaming(false)}
        actions={[
          <Button key="c" variant="ghost" onClick={() => setNaming(false)}>Cancel</Button>,
          <Button key="s" onClick={submitNewProject} disabled={pending}>
            {pending ? "Creating…" : "Create project"}
          </Button>,
        ]}
      >
        <Input
          label="Name"
          placeholder="Neon Alley spec spot"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitNewProject();
          }}
          disabled={pending}
        />
      </Dialog>
    </div>
  );
}
