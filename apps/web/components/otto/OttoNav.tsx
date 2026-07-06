"use client";
import React, { useEffect, useRef, useState } from "react";
import { Check, MessageSquarePlus, MoreHorizontal, Pencil, Pin, Trash2, X } from "lucide-react";
import { creditsLabel } from "@/lib/credit-format";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { OttoViewKey, ProjectMeta } from "./OttoApp";
import type { ChatThreadDTO } from "@/lib/types";
import type { HistoryThumb } from "@/lib/data";
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
function IconCircleUser() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="10" r="3" />
      <path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662" />
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
/** OTTO — the coral cloud mark (coral is OTTO's colour only). */
function OttoCloud({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={Math.round((size * 24) / 26)} viewBox="0 0 120 110" aria-hidden style={{ flexShrink: 0 }}>
      <g fill="var(--brand)">
        <ellipse cx="60" cy="64" rx="43" ry="22" />
        <circle cx="37" cy="52" r="18" />
        <circle cx="61" cy="40" r="24" />
        <circle cx="85" cy="53" r="17" />
      </g>
      <rect x="51" y="48" width="7" height="13" rx="3.5" fill="#2B1308" />
      <rect x="66" y="48" width="7" height="13" rx="3.5" fill="#2B1308" />
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
  { key: "account", label: "Account", icon: <IconCircleUser /> },
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
  /** All projects (campaigns) for the sidebar. */
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
  /** Rename a project (campaign). */
  onRenameProject: (projectId: string, name: string) => void;
  /** Pin/unpin a project (campaign). */
  onSetProjectPinned: (projectId: string, pinned: boolean) => void;
  /** Permanently delete a project (campaign). */
  onDeleteProject: (projectId: string) => void;
  onNewCampaign: (name: string) => Promise<boolean>;
  onCampaignNamingChange?: (active: boolean) => void;
  newCampaignPending?: boolean;
  onRenameThread: (id: string, title: string) => void;
  onSetThreadPinned: (id: string, pinned: boolean) => void;
  onDeleteThread: (id: string) => void;
  /** Spendable balance in DISPLAYED credits (the product shows credits, never dollars). */
  balanceCredits: number;
  userName: string;
  userEmail: string;
  /** Deprecated display-only prop. Media now lives under Workspace/Library to keep this rail focused on campaigns. */
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
  onNewCampaign,
  onCampaignNamingChange,
  newCampaignPending = false,
  onRenameThread,
  onSetThreadPinned,
  onDeleteThread,
  balanceCredits,
  userName,
  userEmail,
  drawerOpen = false,
  onDrawerClose,
  collapsed = false,
  onToggleCollapse,
}: OttoNavProps) {
  const initial = userName.slice(0, 1).toUpperCase();
  const balanceLabel = creditsLabel(balanceCredits);
  const toolsActive = TOOL_ITEMS.some((item) => item.key === view);

  // Keep history scannable: current campaign open, older campaigns compact until expanded.
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());
  const [toolsOpen, setToolsOpen] = useState(toolsActive);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [campaignDraftOpen, setCampaignDraftOpen] = useState(false);
  const [campaignDraftName, setCampaignDraftName] = useState("");
  const campaignDraftInputRef = useRef<HTMLInputElement | null>(null);
  const campaignDraftSubmittingRef = useRef(false);
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
  const showHistory = hasHistoryContent || campaignDraftOpen;
  const hasSidebar = hasHistoryContent || TOOL_ITEMS.length > 0;

  function dotFor(status: ChatThreadDTO["status"]) {
    return status === "working" ? "#f59e0b" : status === "failed" ? "#dc2626" : status === "done" ? "#16a34a" : null;
  }

  function handleNavAction(fn: () => void) {
    setOpenMenu(null);
    if (campaignDraftOpen) cancelCampaignDraft();
    fn();
    onDrawerClose?.();
  }

  function openCampaignDraft() {
    setOpenMenu(null);
    setCampaignDraftOpen(true);
    setCampaignDraftName("");
    onCampaignNamingChange?.(true);
  }

  function cancelCampaignDraft() {
    if (newCampaignPending) return;
    setCampaignDraftOpen(false);
    setCampaignDraftName("");
    onCampaignNamingChange?.(false);
  }

  async function submitCampaignDraft() {
    if (campaignDraftSubmittingRef.current || newCampaignPending) return false;
    const clean = campaignDraftName.trim();
    if (!clean) {
      campaignDraftInputRef.current?.focus();
      return false;
    }
    campaignDraftSubmittingRef.current = true;
    try {
      const ok = await onNewCampaign(clean);
      if (ok) {
        setCampaignDraftOpen(false);
        setCampaignDraftName("");
        onCampaignNamingChange?.(false);
        onDrawerClose?.();
      }
      return ok;
    } finally {
      campaignDraftSubmittingRef.current = false;
    }
  }

  useEffect(() => {
    if (!campaignDraftOpen || newCampaignPending) return;
    campaignDraftInputRef.current?.focus();
    campaignDraftInputRef.current?.select();
  }, [campaignDraftOpen, newCampaignPending]);

  function promptRenameProject(projectId: string, currentName: string) {
    const next = window.prompt("Rename campaign", currentName);
    if (next && next.trim()) onRenameProject(projectId, next.trim());
  }

  function promptRenameThread(threadId: string, currentTitle: string) {
    const next = window.prompt("Rename conversation", currentTitle);
    if (next && next.trim()) onRenameThread(threadId, next.trim());
  }

  function handleCollapseAction() {
    if (getOttoNavCollapseAction(drawerOpen) === "close-drawer") {
      onDrawerClose?.();
      return;
    }
    onToggleCollapse?.();
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
        <button
          onClick={() => handleNavAction(() => {
            if (isActiveProject) onSelectThread(thread.id);
            else onSwitchProject(project.id, thread.id);
          })}
          onDoubleClick={() => promptRenameThread(thread.id, thread.title)}
          title={thread.title}
          className={`flex items-center gap-2 flex-1 min-w-0 border-0 rounded-[10px] cursor-pointer text-left transition-colors duration-150 ${nested ? "text-[0.75rem] py-[5px] pr-[54px]" : "text-[0.8125rem] py-[7px] pr-[54px]"} ${isActive ? "bg-secondary text-foreground font-semibold" : "bg-transparent text-muted-foreground font-normal"}`}
          style={{ paddingLeft: nested ? 28 : 12 }}
        >
          {pinned && (<Pin size={11} className="shrink-0" fill="currentColor" aria-hidden />)}
          {dotColor && (<span className="inline-block shrink-0 w-[7px] h-[7px] rounded-full" style={{ background: dotColor }} />)}
          <span className="truncate min-w-0">{thread.title}</span>
        </button>
        <div className={`otto-row-actions absolute right-1 flex items-center gap-0.5 ${pinned ? "otto-row-actions--pinned" : ""}`}>
          <button
            type="button"
            className="otto-icon-control"
            aria-label={pinned ? `Unpin ${thread.title}` : `Pin ${thread.title}`}
            title={pinned ? "Unpin conversation" : "Pin conversation"}
            onClick={(e) => { e.stopPropagation(); onSetThreadPinned(thread.id, !pinned); }}
          >
            <Pin size={13} fill={pinned ? "currentColor" : "none"} aria-hidden />
          </button>
          <button
            type="button"
            className="otto-icon-control otto-icon-control--danger"
            aria-label={`Delete ${thread.title}`}
            title="Delete conversation"
            onClick={(e) => { e.stopPropagation(); onDeleteThread(thread.id); }}
          >
            <Trash2 size={13} aria-hidden />
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{`
        @media (max-width: ${MOBILE_BP}px) {
          .otto-nav {
            position: fixed !important;
            top: 0;
            left: 0;
            bottom: 0;
            z-index: 200;
            transform: translateX(-100%);
            visibility: hidden;
            pointer-events: none;
            transition: transform 0.22s ease;
            box-shadow: var(--shadow-xl, 0 8px 32px rgba(0,0,0,.18));
            width: 280px !important;
          }
          .otto-nav.otto-nav--open {
            transform: translateX(0);
            visibility: visible;
            pointer-events: auto;
          }
          .otto-nav-backdrop {
            display: block !important;
          }
        }
        @media (min-width: ${MOBILE_BP + 1}px) {
          .otto-nav-backdrop { display: none !important; }
        }
      `}</style>
      {/* Backdrop — only rendered/visible on mobile when drawer is open */}
      <div
        className="otto-nav-backdrop"
        onClick={onDrawerClose}
        style={{
          display: "none",
          position: "fixed",
          inset: 0,
          zIndex: 199,
          background: "rgba(0,0,0,.35)",
          opacity: drawerOpen ? 1 : 0,
          pointerEvents: drawerOpen ? "auto" : "none",
          transition: "opacity 0.22s ease",
        }}
        aria-hidden
      />
    {/* line-height: normal on the rail — matches the design system (its .rail/.it set no
        line-height, so single-line nav text renders at the browser default ~1.2, not 1.5). */}
    <nav
      className={`otto-nav gb flex flex-col overflow-hidden bg-card leading-[normal]${drawerOpen ? " otto-nav--open" : ""}`}
      style={{
        width: collapsed ? 0 : 240,
        flexShrink: 0,
        borderRight: collapsed ? "none" : "1px solid var(--border)",
        padding: collapsed ? 0 : "16px 0",
        transition: "width 220ms cubic-bezier(0.22,1,0.36,1)",
      }}
    >
      {/* Logo + collapse toggle */}
      <div className="flex items-center gap-2 pr-3 pb-4 pl-4 border-b border-border">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <OttoCloud size={26} />
          <span className="text-[1.0625rem] font-bold text-foreground">
            fikirtive
          </span>
        </div>
        <button
          type="button"
          onClick={handleCollapseAction}
          title={collapseLabel}
          aria-label={collapseLabel}
          className="otto-nav-collapse flex shrink-0 items-center justify-center w-7 h-7 rounded-[10px] border-0 bg-transparent text-muted-foreground/70 cursor-pointer"
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
            <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /><path d="m14 9-3 3 3 3" />
          </svg>
        </button>
      </div>

      {/* Primary creation action. It first names the campaign, then creates the project. */}
      <div className="pt-4 px-3 pb-3">
        <button
          onClick={openCampaignDraft}
          disabled={newCampaignPending}
          aria-busy={newCampaignPending}
          className={`flex items-center justify-center gap-[7px] w-full h-[38px] border-0 bg-primary text-primary-foreground text-[0.875rem] font-semibold px-3 rounded-[12px] cursor-pointer transition shadow-[0_4px_12px_rgba(236,88,40,0.18)] disabled:pointer-events-none disabled:opacity-60${newCampaignPending ? " cursor-wait" : ""}`}
        >
          <IconPlus />
          New
        </button>
      </div>

      {/* Projects (campaigns) + History */}
      {hasSidebar && (
        <div className="flex-1 overflow-auto pt-4 px-3 pb-2">
          {showHistory && (
          <>
          <div className="flex items-center justify-between mb-2 pl-1">
            <span className="text-[0.65625rem] text-muted-foreground/70 font-semibold uppercase tracking-[0.07em]">
              History
            </span>
          </div>
          {campaignDraftOpen && (
            <div className="otto-campaign-draft-row mb-2">
              <input
                ref={campaignDraftInputRef}
                value={campaignDraftName}
                onChange={(e) => setCampaignDraftName(e.target.value)}
                onBlur={() => {
                  if (!campaignDraftName.trim()) cancelCampaignDraft();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void submitCampaignDraft();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    cancelCampaignDraft();
                  }
                }}
                disabled={newCampaignPending}
                aria-label="Campaign name"
                placeholder="Campaign name"
                maxLength={80}
              />
              <button
                type="button"
                className="otto-campaign-draft-control"
                aria-label="Create campaign"
                title="Create campaign"
                disabled={newCampaignPending || !campaignDraftName.trim()}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void submitCampaignDraft()}
              >
                <Check size={14} aria-hidden />
              </button>
              <button
                type="button"
                className="otto-campaign-draft-control"
                aria-label="Cancel campaign naming"
                title="Cancel"
                disabled={newCampaignPending}
                onMouseDown={(e) => e.preventDefault()}
                onClick={cancelCampaignDraft}
              >
                <X size={14} aria-hidden />
              </button>
            </div>
          )}
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
                  {/* project (campaign) row — chevron toggles conversations; right controls match Codex density. */}
                  <div className="otto-recent-row relative flex items-center" data-menu-open={projectMenuOpen ? "true" : "false"}>
                    {canExpand ? (
                      <button
                        type="button"
                        aria-label={isCollapsed ? "Expand campaign" : "Collapse campaign"}
                        aria-expanded={!isCollapsed}
                        onClick={(e) => { e.stopPropagation(); toggleProjectCollapse(p.id); }}
                        className="flex items-center justify-center w-[18px] h-[26px] border-0 bg-transparent text-muted-foreground/70 p-0 shrink-0 cursor-pointer"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="transition-transform duration-150" style={{ transform: isCollapsed ? "rotate(-90deg)" : "none" }}><path d="m6 9 6 6 6-6" /></svg>
                      </button>
                    ) : (
                      <span className="w-[18px] h-[26px] shrink-0" aria-hidden />
                    )}
                    <button
                      onClick={() => handleNavAction(() => openProjectEntry(entry))}
                      onDoubleClick={() => promptRenameProject(p.id, p.name)}
                      title={p.name}
                      className={`flex items-center gap-2 flex-1 min-w-0 border-0 text-[0.875rem] font-semibold text-foreground py-1.5 pr-[62px] pl-2 rounded-[10px] cursor-pointer text-left transition-colors duration-150 ${isActiveProject ? "bg-secondary" : "bg-transparent"}`}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden className="shrink-0"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
                      {projectPinned && <Pin size={12} className="shrink-0" fill="currentColor" aria-hidden />}
                      <span className="truncate min-w-0 flex-1">{p.name}</span>
                    </button>
                    <div className={`otto-row-actions absolute right-1 flex items-center gap-0.5 ${(projectPinned || projectMenuOpen) ? "otto-row-actions--pinned" : ""}`}>
                      <button
                        type="button"
                        className="otto-icon-control"
                        aria-label={`New conversation in ${p.name}`}
                        title="New conversation"
                        onClick={(e) => { e.stopPropagation(); handleNavAction(() => onNewChat(p.id)); }}
                      >
                        <MessageSquarePlus size={14} aria-hidden />
                      </button>
                      <button
                        type="button"
                        className="otto-icon-control"
                        aria-label={`${p.name} controls`}
                        aria-haspopup="menu"
                        aria-expanded={projectMenuOpen}
                        title="Campaign controls"
                        onClick={(e) => { e.stopPropagation(); setOpenMenu(projectMenuOpen ? null : projectMenuKey); }}
                      >
                        <MoreHorizontal size={15} aria-hidden />
                      </button>
                    </div>
                    {projectMenuOpen && (
                      <div className="otto-row-menu" role="menu" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => { setOpenMenu(null); onSetProjectPinned(p.id, !projectPinned); }}
                        >
                          <Pin size={14} fill={projectPinned ? "currentColor" : "none"} aria-hidden />
                          {projectPinned ? "Unpin project" : "Pin project"}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => { setOpenMenu(null); promptRenameProject(p.id, p.name); }}
                        >
                          <Pencil size={14} aria-hidden />
                          Rename project
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="otto-row-menu-danger"
                          onClick={() => { setOpenMenu(null); onDeleteProject(p.id); }}
                        >
                          <Trash2 size={14} aria-hidden />
                          Delete project
                        </button>
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
            .otto-campaign-draft-row {
              display: flex;
              align-items: center;
              min-height: 32px;
              gap: 3px;
              padding-left: 18px;
            }
            .otto-campaign-draft-row input {
              width: 100%;
              height: 32px;
              border: 1px solid var(--border);
              border-radius: 10px;
              background: var(--card);
              color: var(--foreground);
              font-size: 13px;
              font-weight: 600;
              line-height: 1;
              outline: none;
              padding: 0 10px;
              box-shadow: 0 0 0 3px transparent;
            }
            .otto-campaign-draft-row input:focus {
              border-color: rgba(236,88,40,0.48);
              box-shadow: 0 0 0 3px rgba(236,88,40,0.12);
            }
            .otto-campaign-draft-row input::placeholder {
              color: var(--muted-foreground);
              font-weight: 500;
            }
            .otto-campaign-draft-control {
              display: inline-flex;
              align-items: center;
              justify-content: center;
              width: 28px;
              height: 28px;
              border: 0;
              border-radius: 9px;
              background: transparent;
              color: var(--muted-foreground);
              cursor: pointer;
              flex-shrink: 0;
            }
            .otto-campaign-draft-control:hover:not(:disabled) {
              background: var(--secondary);
              color: var(--foreground);
            }
            .otto-campaign-draft-control:disabled {
              cursor: default;
              opacity: 0.42;
            }
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
            .otto-icon-control {
              display: inline-flex;
              align-items: center;
              justify-content: center;
              width: 22px;
              height: 22px;
              border: 0;
              border-radius: 8px;
              background: transparent;
              color: var(--muted-foreground);
              cursor: pointer;
              padding: 0;
            }
            .otto-icon-control:hover {
              background: var(--surface-hover, rgba(0,0,0,0.07));
              color: var(--foreground);
            }
            .otto-icon-control--danger:hover {
              color: #b42318;
              background: rgba(180,35,24,0.08);
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
            <button
              type="button"
              onClick={() => setToolsOpen((v) => !v)}
              aria-expanded={showTools}
              className={`flex items-center gap-[9px] w-full border-0 text-[0.8125rem] px-[9px] py-[7px] rounded-[9px] cursor-pointer text-left transition-colors duration-150 ${toolsActive ? "bg-secondary text-foreground font-semibold" : "bg-transparent text-muted-foreground font-normal"}`}
            >
              <IconLibrary />
              <span className="flex-1">Workspace</span>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="transition-transform duration-150" style={{ transform: showTools ? "none" : "rotate(-90deg)" }}><path d="m6 9 6 6 6-6" /></svg>
            </button>
            {showTools && (
              <div className="flex flex-col gap-[1px] pt-1">
                {TOOL_ITEMS.map((item) => {
                  const active = view === item.key;
                  return (
                    <button
                      key={item.key}
                      onClick={() => handleNavAction(() => onViewChange(item.key))}
                      className={`flex items-center gap-[9px] w-full border-0 text-[0.75rem] pl-8 pr-[9px] py-[6px] rounded-[9px] cursor-pointer text-left transition-colors duration-150 ${active ? "bg-secondary text-foreground font-semibold" : "bg-transparent text-muted-foreground font-normal"}`}
                    >
                      {item.icon}
                      {item.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ flex: hasSidebar ? 0 : 1 }} />

      {/* Balance — compact credit line (Grok-style: subtle, not a big card) */}
      <div
        title="Your balance"
        className="flex items-center gap-2 px-4 py-2 text-[0.75rem] text-muted-foreground border-t border-border"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="2" aria-hidden>
          <circle cx="12" cy="12" r="9" /><path d="M12 7v10M9 9.5h4a1.5 1.5 0 0 1 0 3h-2a1.5 1.5 0 0 0 0 3h4" />
        </svg>
        <span className="font-semibold text-foreground truncate">
          {balanceLabel}
        </span>
      </div>

      {/* User */}
      <div className="flex items-center gap-3 px-4 py-3">
        <Avatar className="size-8">
          <AvatarFallback className="bg-accent text-accent-foreground text-[0.65625rem] font-semibold">{initial}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="text-[0.8125rem] font-medium text-foreground truncate">
            {userName}
          </div>
          <div className="text-[0.75rem] text-muted-foreground/70 truncate">
            {userEmail}
          </div>
        </div>
      </div>
    </nav>
    </>
  );
}

export default OttoNav;
