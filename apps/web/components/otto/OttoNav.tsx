"use client";
import React, { useState } from "react";
import { ArrowUpRight, MessageSquarePlus, MoreHorizontal, Pencil, Pin, Trash2 } from "lucide-react";
import type { OttoViewKey, ProjectMeta } from "./OttoApp";
import type { ChatThreadDTO } from "@/lib/types";
import type { HistoryThumb } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { useGlobalNavigationOpen, useOpenGlobalNavigation } from "@/components/global-navigation";
import { buildOttoNavEntries, type OttoNavEntry } from "./otto-nav-model";
import { getOttoNavCollapseAction, getOttoNavCollapseLabel } from "./otto-nav-collapse";

const MOBILE_BP = 680;

interface NavItem {
  key: OttoViewKey;
  label: string;
  icon: React.ReactNode;
}

function IconFolderHeart() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M11 20H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H20a2 2 0 0 1 2 2v2" />
      <path d="M21.29 13.7a2.43 2.43 0 0 0-2.65-.52c-.3.12-.57.3-.8.53l-.34.34-.35-.34a2.43 2.43 0 0 0-2.65-.53c-.3.12-.56.3-.79.53-.95.94-.95 2.48.01 3.42l3.78 3.77 3.79-3.77c.95-.95.95-2.48 0-3.43" />
    </svg>
  );
}
function IconBrain() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
      <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
      <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
      <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
      <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
      <path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
      <path d="M19.938 10.5a4 4 0 0 1 .585.396" />
      <path d="M6 18a4 4 0 0 1-1.967-.516" />
      <path d="M19.967 17.484A4 4 0 0 1 18 18" />
    </svg>
  );
}
function IconPlus() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14" /><path d="M12 5v14" />
    </svg>
  );
}
function IconCompass() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
    </svg>
  );
}
function IconCalendar() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}
function IconChart() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 3v18h18" />
      <path d="m7 14 4-4 3 3 5-6" />
    </svg>
  );
}
const TOOL_ITEMS: NavItem[] = [
  { key: "library", label: "Library", icon: <IconFolderHeart /> },
  { key: "memory", label: "Brand memory", icon: <IconBrain /> },
  { key: "templates", label: "Templates", icon: <IconTemplates /> },
  { key: "discover", label: "Discover", icon: <IconCompass /> },
  { key: "schedule", label: "Schedule", icon: <IconCalendar /> },
  { key: "analytics", label: "Analytics", icon: <IconChart /> },
  { key: "connections", label: "Connections", icon: <IconLink /> },
  // "Account" was removed here (#513 A组返工 item 2) — it duplicated the global
  // identity menu's Profile destination. Its remaining settings (spend cap,
  // notifications, schedule defaults, danger zone) still live in OttoAccount;
  // the entry point is now "Preferences" under the global nav's Workspace
  // settings group (#513 A组返工·三轮 item 1), not here.
];

const PROJECT_LIMIT = 6;
const THREAD_LIMIT = 2;

function IconLibrary() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}
function IconTemplates() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M9 21V9" />
    </svg>
  );
}
function IconLink() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}
export interface OttoNavProps {
  view: OttoViewKey;
  onViewChange: (v: OttoViewKey) => void;
  /** All projects for the sidebar. */
  projects: ProjectMeta[];
  /** The open project. */
  activeProjectId: string;
  /** Conversation metas across ALL projects — nested under their project. */
  sidebarThreads: ChatThreadDTO[];
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  /** Switch to another project (optionally opening a thread). */
  onSwitchProject: (projectId: string, threadId?: string) => void;
  /** Open a project's new-turn front door without exposing a separate "chat" nav action. */
  onNewChat: (projectId: string) => void;
  /** Open the rename flow for a project. */
  onRenameProject: (projectId: string) => void;
  /** Pin/unpin a project. */
  onSetProjectPinned: (projectId: string, pinned: boolean) => void;
  /** Permanently delete a project. */
  onDeleteProject: (projectId: string) => void;
  /** Create a new project with the default name and open it immediately. No naming
   *  step — the project is auto-titled from its first conversation (see actions.ts
   *  autoTitleProjectIfDefault). */
  onNewProject: () => Promise<boolean>;
  newProjectPending?: boolean;
  onRenameThread: (id: string) => void;
  onSetThreadPinned: (id: string, pinned: boolean) => void;
  onDeleteThread: (id: string) => void;
  /** Deprecated display-only prop. Media now lives under Workspace/Library to keep this rail focused on projects. */
  history?: HistoryThumb[];
  /** Mobile: whether the drawer is open (controlled by OttoApp). */
  drawerOpen?: boolean;
  /** Mobile: called when the drawer should close (backdrop tap or nav action). */
  onDrawerClose?: () => void;
  /** Desktop: collapse the sidebar to give the canvas more room. */
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function OttoNav({
  view,
  onViewChange,
  projects,
  activeProjectId,
  sidebarThreads,
  activeThreadId,
  onSelectThread,
  onSwitchProject,
  onNewChat,
  onRenameProject,
  onSetProjectPinned,
  onDeleteProject,
  onNewProject,
  newProjectPending = false,
  onRenameThread,
  onSetThreadPinned,
  onDeleteThread,
  drawerOpen = false,
  onDrawerClose,
  collapsed = false,
  onToggleCollapse,
}: OttoNavProps) {
  // Null / false outside the merchant shell (e.g. /skin-preview) — no global drawer there.
  const openGlobalNavigation = useOpenGlobalNavigation();
  const globalNavigationOpen = useGlobalNavigationOpen();

  // #513 A组返工 item 1 — the rail is a slide-over at every width now (never a
  // second persistent column beside the global nav); open = either trigger.
  //
  // …except while the global drawer is up (#747 r2). This rail is z-200 over that
  // drawer's z-40 and starts at the same left edge, so the two can never share the
  // screen. It STEPS ASIDE rather than being collapsed: `collapsed` is the merchant's
  // own preference for this workspace, and borrowing the screen for a moment must not
  // rewrite it — close the drawer and the rail comes back exactly as it was left.
  const isOpen = (drawerOpen || !collapsed) && !globalNavigationOpen;
  const toolsActive = TOOL_ITEMS.some((item) => item.key === view);

  // Keep history scannable: current project open, older projects compact until expanded.
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());
  const [toolsOpen, setToolsOpen] = useState(toolsActive);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const showTools = toolsActive || toolsOpen;
  const collapseLabel = getOttoNavCollapseLabel(drawerOpen);

  const isProjectCollapsed = (id: string) => {
    if (collapsedProjects.has(id)) return true;
    if (id === activeProjectId) return false;
    return !expandedProjects.has(id);
  };

  const toggleProjectCollapse = (id: string) => {
    const isCollapsed = isProjectCollapsed(id);
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (isCollapsed) next.add(id);
      else next.delete(id);
      return next;
    });
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (isCollapsed) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const navEntries = buildOttoNavEntries({
    projects,
    sidebarThreads,
    activeProjectId,
    activeThreadId,
    projectLimit: PROJECT_LIMIT,
    threadLimit: THREAD_LIMIT,
  });
  const hasHistoryContent = navEntries.length > 0;
  const hasSidebar = hasHistoryContent || TOOL_ITEMS.length > 0;

  function dotFor(status: ChatThreadDTO["status"]) {
    return status === "working" ? "#f59e0b" : status === "failed" ? "#dc2626" : status === "done" ? "#16a34a" : null;
  }

  function handleNavAction(fn: () => void) {
    setOpenMenu(null);
    fn();
    onDrawerClose?.();
  }

  async function handleNewProjectClick() {
    if (newProjectPending) return;
    setOpenMenu(null);
    const ok = await onNewProject();
    if (ok) onDrawerClose?.();
  }

  function handleCollapseAction() {
    if (getOttoNavCollapseAction(drawerOpen) === "close-drawer") {
      onDrawerClose?.();
      return;
    }
    onToggleCollapse?.();
  }

  /** Hand the screen over to the global drawer (#747). One menu at a time, never two
   *  stacked: `isOpen` above already withdraws this rail for as long as the drawer is up.
   *
   *  Only the mobile drawer flag is cleared here, and only because it is transient by
   *  nature (the phone top bar sets it per tap). `collapsed` is deliberately left alone:
   *  flipping it would be a lasting change to the merchant's own layout, and — the r2
   *  finding — OttoApp mounts its floating "Show sidebar" button the instant that flag
   *  goes true, landing a 34×34 z-50 control on top of the z-40 drawer we just opened.
   *  Trading one stacked hamburger for another is not a fix. */
  function handleOpenGlobalNavigation() {
    setOpenMenu(null);
    onDrawerClose?.();
    openGlobalNavigation?.();
  }

  function openProjectEntry(entry: Extract<OttoNavEntry, { kind: "project" }>) {
    onNewChat(entry.project.id);
  }

  function renderThreadRow(thread: ChatThreadDTO, project: ProjectMeta, nested: boolean) {
    const isActiveProject = project.id === activeProjectId;
    const isActive = isActiveProject && thread.id === activeThreadId && view === "otto";
    const dotColor = dotFor(thread.status);
    const pinned = Boolean(thread.pinnedAt);
    return (
      <div key={thread.id} className="otto-recent-row relative flex items-center mb-0.5">
        <Button
          variant="ghost"
          onClick={() => handleNavAction(() => {
            if (isActiveProject) onSelectThread(thread.id);
            else onSwitchProject(project.id, thread.id);
          })}
          onDoubleClick={() => onRenameThread(thread.id)}
          title={thread.title}
          className={`h-auto min-w-0 flex-1 justify-start gap-2 rounded-[10px] text-left ${nested ? "text-[0.75rem] py-[5px] pr-[54px]" : "text-[0.8125rem] py-[7px] pr-[54px]"} ${isActive ? "bg-secondary text-foreground font-semibold" : "bg-transparent text-muted-foreground font-normal"}`}
          style={{ paddingLeft: nested ? 28 : 12 }}
        >
          {pinned && (<Pin size={11} className="shrink-0" fill="currentColor" aria-hidden />)}
          {dotColor && (<span className="inline-block shrink-0 w-[7px] h-[7px] rounded-full" style={{ background: dotColor }} />)}
          <span className="truncate min-w-0">{thread.title}</span>
        </Button>
        <div className={`otto-row-actions absolute right-1 flex items-center gap-0.5 ${pinned ? "otto-row-actions--pinned" : ""}`}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-[22px] rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={pinned ? `Unpin ${thread.title}` : `Pin ${thread.title}`}
            title={pinned ? "Unpin conversation" : "Pin conversation"}
            onClick={(e) => { e.stopPropagation(); onSetThreadPinned(thread.id, !pinned); }}
          >
            <Pin size={13} fill={pinned ? "currentColor" : "none"} aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-[22px] rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            aria-label={`Delete ${thread.title}`}
            title="Delete conversation"
            onClick={(e) => { e.stopPropagation(); onDeleteThread(thread.id); }}
          >
            <Trash2 size={13} aria-hidden />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{`
        /* #513 A组返工 item 1 — this rail is a slide-over overlay at every width now,
           not just on mobile. It used to push a second permanent 240px column next
           to the global nav at every desktop tier (≥1280 → 240+240, 1024–1279 →
           64+240); as position:fixed it never reserves layout width, open or not. */
        .otto-nav {
          position: fixed;
          top: 0;
          left: 0;
          bottom: 0;
          z-index: 200;
          transform: translateX(-100%);
          visibility: hidden;
          pointer-events: none;
          transition: transform 0.22s ease;
          box-shadow: var(--shadow-xl, 0 8px 32px rgba(0,0,0,.18));
        }
        .otto-nav.otto-nav--open {
          transform: translateX(0);
          visibility: visible;
          pointer-events: auto;
        }
        @media (max-width: ${MOBILE_BP}px) {
          .otto-nav { width: 280px !important; }
          .otto-nav-backdrop { display: block !important; }
        }
      `}</style>
      {/* Backdrop — only rendered/visible on mobile when the rail is open (desktop
          closes it via the collapse button in the rail header instead). */}
      <div
        className="otto-nav-backdrop"
        onClick={handleCollapseAction}
        style={{
          display: "none",
          position: "fixed",
          inset: 0,
          zIndex: 199,
          background: "rgba(0,0,0,.35)",
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? "auto" : "none",
          transition: "opacity 0.22s ease",
        }}
        aria-hidden
      />
    {/* line-height: normal on the rail — matches the design system (its .rail/.it set no
        line-height, so single-line nav text renders at the browser default ~1.2, not 1.5). */}
    <nav
      className={`otto-nav gb flex flex-col overflow-hidden bg-card leading-[normal]${isOpen ? " otto-nav--open" : ""}`}
      style={{
        width: 240,
        borderRight: "1px solid var(--border)",
        padding: "16px 0",
      }}
    >
      {/* Collapse toggle — the FIKIRTIVE brand mark lives once, in the persistent
          global nav; this rail no longer repeats it (#513 三.1, "双壳合一"). */}
      <div className="flex items-center justify-end gap-2 pr-3 pb-4 pl-4 border-b border-border">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={handleCollapseAction}
          title={collapseLabel}
          aria-label={collapseLabel}
          className="size-7 shrink-0 rounded-[10px] text-muted-foreground/70 hover:bg-accent hover:text-foreground"
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
            <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /><path d="m14 9-3 3 3 3" />
          </svg>
        </Button>
      </div>

      {/* Primary creation action. Creates the project immediately and opens it —
          no naming step. It's auto-titled from its first conversation (#546: it builds
          a Project, so it says project — never "New campaign"). */}
      <div className="pt-4 px-3 pb-3">
        <Button
          onClick={handleNewProjectClick}
          disabled={newProjectPending}
          aria-busy={newProjectPending}
          className={`h-[38px] w-full gap-[7px] rounded-[12px] px-3 text-[0.875rem] shadow-[0_4px_12px_rgba(236,88,40,0.18)] disabled:opacity-60${newProjectPending ? " cursor-wait" : ""}`}
        >
          <IconPlus />
          New project
        </Button>
      </div>

      {/* Projects + History */}
      {hasSidebar && (
        <div className="flex-1 overflow-auto pt-4 px-3 pb-2">
          {hasHistoryContent && (
          <>
          <div className="flex items-center justify-between mb-2 pl-1">
            <span className="text-[0.65625rem] text-muted-foreground/70 font-semibold uppercase tracking-[0.07em]">
              History
            </span>
          </div>
          {navEntries.length > 0 && (
          <div className="flex flex-col gap-0.5">
            {navEntries.map((entry) => {
              if (entry.kind === "thread") {
                return renderThreadRow(entry.thread, entry.project, false);
              }
              const p = entry.project;
              const isActiveProject = p.id === activeProjectId;
              const isCollapsed = isProjectCollapsed(p.id);
              const canExpand = entry.threads.length > 0;
              const projectPinned = Boolean(p.pinnedAt);
              const projectMenuKey = `project:${p.id}`;
              const projectMenuOpen = openMenu === projectMenuKey;
              return (
                <div key={`project:${p.id}`} className="mb-1">
                  {/* project row — chevron toggles conversations; right controls match Codex density. */}
                  <div className="otto-recent-row relative flex items-center" data-menu-open={projectMenuOpen ? "true" : "false"}>
                    {canExpand ? (
                      <Button
                        type="button"
                        variant="ghost"
                        aria-label={isCollapsed ? "Expand project" : "Collapse project"}
                        aria-expanded={!isCollapsed}
                        onClick={(e) => { e.stopPropagation(); toggleProjectCollapse(p.id); }}
                        className="h-[26px] w-[18px] shrink-0 rounded-none p-0 text-muted-foreground/70 hover:bg-transparent hover:text-foreground"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="transition-transform duration-150" style={{ transform: isCollapsed ? "rotate(-90deg)" : "none" }}><path d="m6 9 6 6 6-6" /></svg>
                      </Button>
                    ) : (
                      <span className="w-[18px] h-[26px] shrink-0" aria-hidden />
                    )}
                    <Button
                      variant="ghost"
                      onClick={() => handleNavAction(() => openProjectEntry(entry))}
                      onDoubleClick={() => onRenameProject(p.id)}
                      title={p.name}
                      className={`h-auto min-w-0 flex-1 justify-start gap-2 rounded-[10px] py-1.5 pr-[62px] pl-2 text-left text-[0.875rem] font-semibold text-foreground ${isActiveProject ? "bg-secondary" : "bg-transparent"}`}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden className="shrink-0"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
                      {projectPinned && <Pin size={12} className="shrink-0" fill="currentColor" aria-hidden />}
                      <span className="truncate min-w-0 flex-1">{p.name}</span>
                    </Button>
                    <div className={`otto-row-actions absolute right-1 flex items-center gap-0.5 ${(projectPinned || projectMenuOpen) ? "otto-row-actions--pinned" : ""}`}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-[22px] rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
                        aria-label={`New conversation in ${p.name}`}
                        title="New conversation"
                        onClick={(e) => { e.stopPropagation(); handleNavAction(() => onNewChat(p.id)); }}
                      >
                        <MessageSquarePlus size={14} aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-[22px] rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
                        aria-label={`${p.name} controls`}
                        aria-haspopup="menu"
                        aria-expanded={projectMenuOpen}
                        title="Project controls"
                        onClick={(e) => { e.stopPropagation(); setOpenMenu(projectMenuOpen ? null : projectMenuKey); }}
                      >
                        <MoreHorizontal size={15} aria-hidden />
                      </Button>
                    </div>
                    {projectMenuOpen && (
                      <div className="otto-row-menu" role="menu" onClick={(e) => e.stopPropagation()}>
                        <Button
                          type="button"
                          variant="ghost"
                          role="menuitem"
                          className="justify-start font-normal"
                          onClick={() => { setOpenMenu(null); onSetProjectPinned(p.id, !projectPinned); }}
                        >
                          <Pin size={14} fill={projectPinned ? "currentColor" : "none"} aria-hidden />
                          {projectPinned ? "Unpin project" : "Pin project"}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          role="menuitem"
                          className="justify-start font-normal"
                          onClick={() => { setOpenMenu(null); onRenameProject(p.id); }}
                        >
                          <Pencil size={14} aria-hidden />
                          Rename project
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          role="menuitem"
                          className="otto-row-menu-danger justify-start font-normal"
                          onClick={() => { setOpenMenu(null); onDeleteProject(p.id); }}
                        >
                          <Trash2 size={14} aria-hidden />
                          Delete project
                        </Button>
                      </div>
                    )}
                  </div>
                  {/* conversations nested under the project (collapsible) */}
                  {canExpand && !isCollapsed && (
                    <div className="flex flex-col gap-px mt-px">
                      {entry.threads.map((t) => renderThreadRow(t, p, true))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          )}
          <style>{`
            .otto-row-actions {
              opacity: 0;
              pointer-events: none;
              transition: opacity 150ms ease;
            }
            .otto-recent-row:hover .otto-row-actions,
            .otto-recent-row:focus-within .otto-row-actions,
            .otto-recent-row[data-menu-open="true"] .otto-row-actions,
            .otto-row-actions--pinned {
              opacity: 1;
              pointer-events: auto;
            }
            .otto-row-menu {
              position: absolute;
              top: calc(100% + 4px);
              right: 4px;
              z-index: 60;
              min-width: 164px;
              padding: 6px;
              border: 1px solid var(--border);
              border-radius: 10px;
              background: var(--card);
              box-shadow: var(--shadow-lg, 0 12px 28px rgba(0,0,0,.12));
            }
            .otto-row-menu button {
              display: flex;
              align-items: center;
              gap: 8px;
              width: 100%;
              height: 32px;
              border: 0;
              border-radius: 8px;
              background: transparent;
              color: var(--foreground);
              font-size: 12px;
              line-height: 1;
              cursor: pointer;
              padding: 0 8px;
              text-align: left;
            }
            .otto-row-menu button:hover {
              background: var(--surface-hover, rgba(0,0,0,0.07));
            }
            .otto-row-menu .otto-row-menu-danger {
              color: #b42318;
            }
            .otto-row-menu .otto-row-menu-danger:hover {
              background: rgba(180,35,24,0.08);
            }
            @media (hover: none) {
              .otto-row-actions {
                opacity: 1;
                pointer-events: auto;
              }
            }
          `}</style>
          </>
          )}
          <div className={`${navEntries.length > 0 ? "mt-4 pt-3 border-t border-border" : "mt-0"} flex flex-col gap-[1px]`}>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setToolsOpen((v) => !v)}
              aria-expanded={showTools}
              className={`h-auto w-full justify-start gap-[9px] rounded-[9px] px-[9px] py-[7px] text-left text-[0.8125rem] ${toolsActive ? "bg-secondary text-foreground font-semibold" : "bg-transparent text-muted-foreground font-normal"}`}
            >
              <IconLibrary />
              <span className="flex-1">Workspace</span>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="transition-transform duration-150" style={{ transform: showTools ? "none" : "rotate(-90deg)" }}><path d="m6 9 6 6 6-6" /></svg>
            </Button>
            {showTools && (
              <div className="flex flex-col gap-[1px] pt-1">
                {TOOL_ITEMS.map((item) => {
                  const active = view === item.key;
                  return (
                    <Button
                      key={item.key}
                      type="button"
                      variant="ghost"
                      onClick={() => handleNavAction(() => onViewChange(item.key))}
                      className={`h-auto w-full justify-start gap-[9px] rounded-[9px] pl-8 pr-[9px] py-[6px] text-left text-[0.75rem] ${active ? "bg-secondary text-foreground font-semibold" : "bg-transparent text-muted-foreground font-normal"}`}
                    >
                      {item.icon}
                      {item.label}
                    </Button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ flex: hasSidebar ? 0 : 1 }} />

      {/* Go to — the ONE global-navigation entry point below 1024px (#747). Otto draws
          its own mobile top bar, so the shell withholds its floating hamburger here
          rather than parking it on top of Otto's; this row takes over that job from
          inside Otto's own menu. Hidden from 1024px up, where the global rail is
          permanently on screen and this would only repeat it. It opens the real global
          drawer instead of copying its links, so credits, Profile, and Sign out stay
          reachable and stay defined in exactly one place. */}
      {openGlobalNavigation && (
        <div className="mt-2 border-t border-border px-3 pt-3 lg:hidden">
          <Button
            type="button"
            variant="ghost"
            onClick={handleOpenGlobalNavigation}
            // #801 — this tooltip used to LIST the sections ("Campaign, CRM, billing, and
            // account"). A list here is a second copy of the navigation tree: it went stale the
            // moment a section was added, and it had already dropped one. The fix is not a
            // longer list, it is not having one — the drawer it opens shows the real tree.
            title="Open navigation"
            className="h-auto w-full justify-start gap-[9px] rounded-[9px] bg-transparent px-[9px] py-[7px] text-left text-[0.8125rem] font-normal text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
          >
            <ArrowUpRight size={18} className="shrink-0" aria-hidden />
            <span className="flex-1">Go to…</span>
          </Button>
        </div>
      )}

      {/* Credits balance and identity (avatar, name, email, sign out) now live once,
          in the persistent global nav — this rail no longer repeats either
          (#513 三.1, A组返工 item 3). */}
    </nav>
    </>
  );
}

export default OttoNav;
