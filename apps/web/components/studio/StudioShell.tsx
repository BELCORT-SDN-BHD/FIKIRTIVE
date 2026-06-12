"use client";
/**
 * Redesign shell (Artlio Studio design) — the LTX-shaped surface frame.
 * Reuses the Vapor design system (.sidenav/.navitem/.topbar/.al-*). Nav is local
 * view-state; ?view= seeds the initial surface (deep-linkable). On <lg the sidenav
 * collapses into a topbar-triggered drawer so the app stays navigable on phones.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ProjectDTO } from "@/lib/types";
import { createProject } from "@/lib/actions";
import {
  Wordmark, IcFolder, IcSparkle, IcStoryboard, IcFilm, IcAt, IcAssets, IcPlans, IcUser,
  IcExport, Button, PopMenu, Dialog, Input,
} from "@/components/ds";

export type StudioView =
  | "genspace" | "canvas" | "storyboard" | "editor" | "elements" | "assets" | "plans" | "account";

const PRIMARY: { view: StudioView; label: string; Icon: typeof IcSparkle }[] = [
  { view: "genspace", label: "Gen space", Icon: IcSparkle },
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
  confirmLeave,
  project,
  projects,
  user,
  children,
}: {
  view: StudioView;
  onNavigate: (v: StudioView) => void;
  confirmLeave?: () => boolean;
  project?: ProjectDTO;
  projects?: ProjectDTO[];
  user?: { initials: string; label: string };
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [projectMenu, setProjectMenu] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [mobileNav, setMobileNav] = useState(false);

  // only the editor view has unsaved state worth guarding
  const guard = () => view !== "editor" || !confirmLeave || confirmLeave();

  function go(v: StudioView) {
    if (!guard()) return;
    onNavigate(v);
    setMobileNav(false);
  }

  const projectItems = [
    ...(projects ?? []).map((p) => ({ value: p.id, label: p.name })),
    { value: "__new__", label: "+ New project", desc: "Start a fresh project" },
  ];
  function switchProject(id: string) {
    if (id === "__new__") { if (guard()) setNaming(true); return; }
    if (!guard()) return;
    router.push(`/studio?p=${id}&view=${view}`); // preserve the active surface
    setMobileNav(false);
  }
  function submitNew() {
    const t = name.trim();
    if (!t) return;
    setCreating(true); setCreateErr(null);
    (async () => {
      try {
        const res = await createProject(t);
        setNaming(false); setName(""); router.push(`/studio?p=${res.id}`);
      } catch {
        setCreateErr("Could not create the project — please try again.");
      } finally {
        setCreating(false);
      }
    })();
  }

  // rendered in both the desktop sidenav and the mobile drawer; only the visible
  // one's project menu is live, so the two PopMenus don't fight over outside-click
  const navInner = (drawer: boolean) => (
    <>
      <div className="sidenav-brand"><Wordmark /></div>

      <span style={{ position: "relative", display: "block" }}>
        <button className="sidenav-project" aria-haspopup="listbox" aria-expanded={projectMenu}
          onClick={() => setProjectMenu(!projectMenu)}>
          <IcFolder size={15} style={{ color: "var(--fg-3)", flexShrink: 0 }} />
          <span className="sidenav-project-name">{project?.name ?? "Untitled Project"}</span>
        </button>
        <PopMenu open={drawer ? projectMenu : projectMenu && !mobileNav} onClose={() => setProjectMenu(false)} side="down" heading="Projects"
          items={projectItems} value={project?.id} onSelect={switchProject} width={240} />
      </span>

      <div className="nav-group">
        {PRIMARY.map(({ view: v, label, Icon }) => (
          <button key={v} className={`navitem${view === v ? " active" : ""}`} title={label}
            aria-current={view === v ? "page" : undefined} onClick={() => go(v)}>
            <Icon size={17} />
            <span className="lbl">{label}</span>
          </button>
        ))}
      </div>
      <div className="nav-grouplabel"><span className="mono-label">Workspace</span></div>
      <div className="nav-group">
        {WORKSPACE.map(({ view: v, label, Icon }) => (
          <button key={v} className={`navitem${view === v ? " active" : ""}`} title={label}
            aria-current={view === v ? "page" : undefined} onClick={() => go(v)}>
            <Icon size={17} />
            <span className="lbl">{label}</span>
          </button>
        ))}
      </div>

      <div className="sidenav-foot">
        <div className="user-row">
          <span className="al-avatar al-avatar-sm" title={user?.label ?? "You"}><span>{user?.initials ?? "Y"}</span></span>
          <span className="user-name">{user?.label ?? "You"}</span>
        </div>
      </div>
    </>
  );

  return (
    <div className="app">
      <nav className="sidenav max-lg:hidden" aria-label="Main">{navInner(false)}</nav>

      {/* mobile drawer — the sidenav is hidden <lg, so the topbar menu opens it here */}
      {mobileNav && (
        <div className="lg:hidden" style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex" }}>
          <div onClick={() => setMobileNav(false)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.55)" }} />
          <nav className="sidenav" aria-label="Main" style={{ position: "relative", zIndex: 1 }}>{navInner(true)}</nav>
        </div>
      )}

      <div className="main">
        <header className="topbar">
          <button className="al-iconbtn al-iconbtn-ghost al-iconbtn-md lg:hidden" aria-label="Open menu" onClick={() => setMobileNav(true)}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M2.5 5h13M2.5 9h13M2.5 13h13" /></svg>
          </button>
          <span className="topbar-title">{TITLES[view]}</span>
          <span className="topbar-spacer" />
          {view !== "editor" && (
            <Button variant="glass" size="sm" icon={<IcExport size={15} />} onClick={() => go("editor")}>Open editor</Button>
          )}
          <span className="al-avatar al-avatar-sm al-avatar-ring" title={user?.label ?? "You"}><span>{user?.initials ?? "Y"}</span></span>
        </header>

        {children}
      </div>

      <Dialog open={naming} title="New project" onClose={() => { setNaming(false); setCreateErr(null); }}
        actions={[
          <Button key="c" variant="ghost" onClick={() => { setNaming(false); setCreateErr(null); }}>Cancel</Button>,
          <Button key="s" onClick={submitNew} disabled={creating}>{creating ? "Creating…" : "Create project"}</Button>,
        ]}>
        <Input label="Name" placeholder="Neon Alley spec spot" value={name} autoFocus
          onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submitNew(); }} disabled={creating} />
        {createErr && <p role="alert" style={{ font: "var(--text-caption)", color: "var(--danger)", margin: "8px 0 0" }}>{createErr}</p>}
      </Dialog>
    </div>
  );
}
