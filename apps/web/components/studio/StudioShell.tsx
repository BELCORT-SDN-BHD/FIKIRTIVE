"use client";
/**
 * Redesign shell (Artlio Studio design) — the LTX-shaped 6-surface frame.
 * Reuses the existing Vapor design system (.sidenav/.navitem/.topbar/.al-*).
 * Mock-first: nav switches a local `view` state; routes/engine wire later.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ProjectDTO } from "@/lib/types";
import { createProject } from "@/lib/actions";
import {
  Wordmark, IcFolder, IcSparkle, IcStoryboard, IcFilm, IcAt, IcAssets, IcPlans, IcUser,
  IcUndo, IcRedo, IcExport, IcUsers, Button, PopMenu, Dialog, Input,
} from "@/components/ds";

export type StudioView =
  | "genspace" | "canvas" | "storyboard" | "editor" | "elements" | "assets" | "plans" | "account";

const PRIMARY: { view: StudioView; label: string; Icon: typeof IcSparkle }[] = [
  { view: "genspace", label: "Gen space", Icon: IcSparkle },
  // Canvas (freeform board) is deferred — hidden from nav until it's built.
  { view: "storyboard", label: "Storyboard", Icon: IcStoryboard },
  { view: "editor", label: "Video editor", Icon: IcFilm },
  { view: "elements", label: "Elements", Icon: IcAt },
];
const WORKSPACE: { view: StudioView; label: string; Icon: typeof IcSparkle }[] = [
  { view: "assets", label: "Assets", Icon: IcAssets },
  { view: "plans", label: "Plans", Icon: IcPlans },
  { view: "account", label: "Account", Icon: IcUser },
];

const TITLES: Record<StudioView, string> = {
  genspace: "Gen space", canvas: "Canvas", storyboard: "Storyboard", editor: "Video editor",
  elements: "Elements", assets: "Assets", plans: "Plans", account: "Account",
};

export function StudioShell({
  view,
  onNavigate,
  project,
  projects,
  children,
}: {
  view: StudioView;
  onNavigate: (v: StudioView) => void;
  project?: ProjectDTO;
  projects?: ProjectDTO[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [projectMenu, setProjectMenu] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  const projectItems = [
    ...(projects ?? []).map((p) => ({ value: p.id, label: p.name })),
    { value: "__new__", label: "+ New project", desc: "Start a fresh project" },
  ];
  function switchProject(id: string) {
    if (id === "__new__") { setNaming(true); return; }
    router.push(`/studio?p=${id}`);
  }
  function submitNew() {
    const t = name.trim();
    if (!t) return;
    setCreating(true);
    (async () => {
      const res = await createProject(t);
      setCreating(false); setNaming(false); setName("");
      if ("id" in res) router.push(`/studio?p=${res.id}`);
    })();
  }

  return (
    <div className="app">
      <nav className="sidenav max-lg:hidden" aria-label="Main">
        <div className="sidenav-brand">
          <Wordmark />
        </div>

        <span style={{ position: "relative", display: "block" }}>
          <button className="sidenav-project" aria-haspopup="listbox" aria-expanded={projectMenu}
            onClick={() => setProjectMenu(!projectMenu)}>
            <IcFolder size={15} style={{ color: "var(--fg-3)", flexShrink: 0 }} />
            <span className="sidenav-project-name">{project?.name ?? "Untitled project"}</span>
          </button>
          <PopMenu open={projectMenu} onClose={() => setProjectMenu(false)} side="down" heading="Projects"
            items={projectItems} value={project?.id} onSelect={switchProject} width={240} />
        </span>

        <div className="nav-group">
          {PRIMARY.map(({ view: v, label, Icon }) => (
            <button key={v} className={`navitem${view === v ? " active" : ""}`} title={label}
              aria-current={view === v ? "page" : undefined} onClick={() => onNavigate(v)}>
              <Icon size={17} />
              <span className="lbl">{label}</span>
            </button>
          ))}
        </div>
        <div className="nav-grouplabel"><span className="mono-label">Workspace</span></div>
        <div className="nav-group">
          {WORKSPACE.map(({ view: v, label, Icon }) => (
            <button key={v} className={`navitem${view === v ? " active" : ""}`} title={label}
              aria-current={view === v ? "page" : undefined} onClick={() => onNavigate(v)}>
              <Icon size={17} />
              <span className="lbl">{label}</span>
            </button>
          ))}
        </div>

        <div className="sidenav-foot">
          <div className="credits-row">
            <span className="al-badge al-badge-mono">768 CR</span>
            <Button variant="glass" size="sm">Upgrade</Button>
          </div>
          <div className="user-row">
            <span className="al-avatar al-avatar-sm" title="Tessa Bright"><span>TB</span></span>
            <span className="user-name">Tessa Bright</span>
          </div>
        </div>
      </nav>

      <div className="main">
        <header className="topbar">
          <span className="topbar-title">{TITLES[view]}</span>
          <span className="topbar-spacer" />
          <span className="al-tooltip-wrap">
            <button className="al-iconbtn al-iconbtn-ghost al-iconbtn-md" aria-label="Undo"><IcUndo size={17} /></button>
            <span className="al-tooltip" role="tooltip">Undo<span className="al-tooltip-shortcut">⌘Z</span></span>
          </span>
          <span className="al-tooltip-wrap">
            <button className="al-iconbtn al-iconbtn-ghost al-iconbtn-md" aria-label="Redo"><IcRedo size={17} /></button>
            <span className="al-tooltip" role="tooltip">Redo<span className="al-tooltip-shortcut">⇧⌘Z</span></span>
          </span>
          {view !== "editor" && (
            <Button variant="glass" size="sm" icon={<IcExport size={15} />} onClick={() => onNavigate("editor")}>Export</Button>
          )}
          <span className="avatar-stack">
            <span className="al-avatar al-avatar-sm al-avatar-ring" title="Tessa Bright"><span>TB</span></span>
            <span className="al-avatar al-avatar-sm al-avatar-ring" title="Marcus Oda"><span>MO</span></span>
          </span>
          <Button variant="glass" size="sm" icon={<IcUsers size={15} />}>Collaborate</Button>
        </header>

        {children}
      </div>

      <Dialog open={naming} title="New project" onClose={() => setNaming(false)}
        actions={[
          <Button key="c" variant="ghost" onClick={() => setNaming(false)}>Cancel</Button>,
          <Button key="s" onClick={submitNew} disabled={creating}>{creating ? "Creating…" : "Create project"}</Button>,
        ]}>
        <Input label="Name" placeholder="Neon Alley spec spot" value={name} autoFocus
          onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submitNew(); }} disabled={creating} />
      </Dialog>
    </div>
  );
}
