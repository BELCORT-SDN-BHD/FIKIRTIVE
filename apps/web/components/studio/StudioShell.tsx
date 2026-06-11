"use client";
/**
 * Redesign shell (Artlio Studio design) — the LTX-shaped 6-surface frame.
 * Reuses the existing Vapor design system (.sidenav/.navitem/.topbar/.al-*).
 * Mock-first: nav switches a local `view` state; routes/engine wire later.
 */
import { useState } from "react";
import {
  Wordmark, IcFolder, IcSparkle, IcCanvas, IcStoryboard, IcFilm, IcAt, IcAssets, IcPlans, IcUser,
  IcUndo, IcRedo, IcExport, IcUsers, Button,
} from "@/components/ds";

export type StudioView =
  | "genspace" | "canvas" | "storyboard" | "editor" | "elements" | "assets" | "plans" | "account";

const PRIMARY: { view: StudioView; label: string; Icon: typeof IcSparkle }[] = [
  { view: "genspace", label: "Gen space", Icon: IcSparkle },
  { view: "canvas", label: "Canvas", Icon: IcCanvas },
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
  children,
}: {
  view: StudioView;
  onNavigate: (v: StudioView) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="app">
      <nav className="sidenav max-lg:hidden" aria-label="Main">
        <div className="sidenav-brand">
          <Wordmark />
        </div>

        <button className="sidenav-project" aria-haspopup="listbox">
          <IcFolder size={15} style={{ color: "var(--fg-3)", flexShrink: 0 }} />
          <span className="sidenav-project-name">Untitled project</span>
        </button>

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
          <Button variant="glass" size="sm" icon={<IcExport size={15} />}>Export</Button>
          <span className="avatar-stack">
            <span className="al-avatar al-avatar-sm al-avatar-ring" title="Tessa Bright"><span>TB</span></span>
            <span className="al-avatar al-avatar-sm al-avatar-ring" title="Marcus Oda"><span>MO</span></span>
          </span>
          <Button variant="glass" size="sm" icon={<IcUsers size={15} />}>Collaborate</Button>
        </header>

        {children}
      </div>
    </div>
  );
}
