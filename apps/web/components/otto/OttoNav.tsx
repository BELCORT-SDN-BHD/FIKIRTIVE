"use client";
import React from "react";
import { creditsLabel } from "@/lib/credit-format";
import type { OttoViewKey } from "./OttoApp";
import type { ChatThreadDTO } from "@/lib/types";

const MOBILE_BP = 680;

interface NavItem {
  key: OttoViewKey;
  label: string;
  icon: React.ReactNode;
}

function IconMessageCircle() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
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
      <g fill="var(--accent)">
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

// Simplified nav (founder, 2026-06-29): 6 destinations. Library/Templates/Discover/
// Connections are no longer surfaced here (their views still exist, just unlinked);
// Schedule + Analytics are new stub views (the hi-fi screens land in a later phase).
const NAV_ITEMS: NavItem[] = [
  { key: "otto", label: "Canvas", icon: <IconLibrary /> },
  { key: "stuff", label: "My Stuff", icon: <IconFolderHeart /> },
  { key: "memory", label: "Brand memory", icon: <IconBrain /> },
  { key: "schedule", label: "Schedule", icon: <IconCalendar /> },
  { key: "analytics", label: "Analytics", icon: <IconChart /> },
  { key: "account", label: "Account", icon: <IconCircleUser /> },
];

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
function IconX() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 6 6 18" /><path d="m6 6 12 12" />
    </svg>
  );
}

export interface OttoNavProps {
  view: OttoViewKey;
  onViewChange: (v: OttoViewKey) => void;
  threads: ChatThreadDTO[];
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  onNewCampaign: () => void;
  onDeleteThread: (id: string) => void;
  /** Spendable balance in DISPLAYED credits (the product shows credits, never dollars). */
  balanceCredits: number;
  userName: string;
  userEmail: string;
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
  threads,
  activeThreadId,
  onSelectThread,
  onNewCampaign,
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

  function handleNavAction(fn: () => void) {
    fn();
    onDrawerClose?.();
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
            transition: transform 0.22s ease;
            box-shadow: var(--shadow-xl, 0 8px 32px rgba(0,0,0,.18));
            width: 280px !important;
          }
          .otto-nav.otto-nav--open {
            transform: translateX(0);
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
    <nav
      className={`otto-nav${drawerOpen ? " otto-nav--open" : ""}`}
      style={{
        width: collapsed ? 0 : 240,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        borderRight: collapsed ? "none" : "1px solid var(--border-subtle)",
        background: "var(--surface-card)",
        overflow: "hidden",
        padding: collapsed ? 0 : "var(--space-4) 0",
        transition: "width var(--dur-base) var(--ease-out)",
      }}
    >
      {/* Logo + collapse toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", padding: "0 var(--space-3) var(--space-4) var(--space-4)", borderBottom: "1px solid var(--border-subtle)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flex: 1, minWidth: 0 }}>
          <OttoCloud size={26} />
          <span style={{ fontSize: "var(--text-lg)", fontWeight: "var(--weight-bold)", letterSpacing: "var(--tracking-snug)", color: "var(--text-strong)" }}>
            fikirtive
          </span>
        </div>
        <button
          type="button"
          onClick={onToggleCollapse}
          title="Collapse sidebar"
          aria-label="Collapse sidebar"
          className="otto-nav-collapse"
          style={{ flexShrink: 0, width: 28, height: 28, borderRadius: "var(--radius-sm)", border: "none", background: "transparent", color: "var(--text-faint)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
            <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /><path d="m14 9-3 3 3 3" />
          </svg>
        </button>
      </div>

      {/* New campaign button */}
      <div style={{ padding: "var(--space-4) var(--space-3) var(--space-3)" }}>
        <button
          onClick={() => handleNavAction(onNewCampaign)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
            width: "100%",
            border: "none",
            background: "var(--brand)",
            color: "#fff",
            fontFamily: "var(--font-sans)",
            fontSize: "var(--text-sm)",
            fontWeight: "var(--weight-semibold)",
            padding: "10px var(--space-3)",
            borderRadius: "var(--radius-md)",
            cursor: "pointer",
            boxShadow: "var(--shadow-brand-sm)",
            transition: "var(--transition-control)",
          }}
        >
          <IconPlus />
          New campaign
        </button>
      </div>

      {/* Nav items */}
      <div style={{ padding: "0 var(--space-3)", display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
        {NAV_ITEMS.map((item) => {
          const active = view === item.key;
          return (
            <button
              key={item.key}
              onClick={() => handleNavAction(() => onViewChange(item.key))}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-3)",
                width: "100%",
                border: "none",
                background: active ? "var(--brand-tint)" : "transparent",
                color: active ? "var(--brand-press)" : "var(--text-muted)",
                fontFamily: "var(--font-sans)",
                fontSize: "var(--text-sm)",
                fontWeight: "var(--weight-semibold)",
                padding: "10px var(--space-3)",
                borderRadius: "var(--radius-md)",
                cursor: "pointer",
                textAlign: "left",
                transition: "background var(--dur-fast) var(--ease-out)",
              }}
            >
              {item.icon}
              {item.label}
            </button>
          );
        })}
      </div>

      {/* Recent conversations */}
      {threads.length > 0 && (
        <div style={{ flex: 1, overflow: "auto", padding: "var(--space-4) var(--space-3) var(--space-2)" }}>
          <div
            style={{
              fontSize: "var(--text-xs)",
              color: "var(--text-faint)",
              fontWeight: "var(--weight-semibold)",
              textTransform: "uppercase",
              letterSpacing: "var(--tracking-caps)",
              marginBottom: "var(--space-2)",
              paddingLeft: "var(--space-1)",
            }}
          >
            Recent
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            {threads.slice(0, 8).map((t) => {
              const isActive = t.id === activeThreadId && view === "otto";
              const dotColor =
                t.status === "working" ? "#f59e0b" :
                t.status === "failed"  ? "#dc2626" :
                t.status === "done"    ? "#16a34a" :
                null;
              const dotLabel =
                t.status === "working" ? "Processing" :
                t.status === "failed"  ? "Failed" :
                t.status === "done"    ? "Done" :
                null;
              return (
                <div
                  key={t.id}
                  className="otto-recent-row"
                  style={{ position: "relative", display: "flex", alignItems: "center" }}
                >
                  <button
                    onClick={() => handleNavAction(() => {
                      onSelectThread(t.id);
                      onViewChange("otto");
                    })}
                    title={t.title}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--space-2)",
                      flex: 1,
                      minWidth: 0,
                      border: "none",
                      background: isActive ? "var(--brand-tint)" : "transparent",
                      color: isActive ? "var(--brand-press)" : "var(--text-muted)",
                      fontFamily: "var(--font-sans)",
                      fontSize: "var(--text-xs)",
                      fontWeight: isActive ? "var(--weight-semibold)" : "var(--weight-regular)",
                      padding: "7px var(--space-3)",
                      paddingRight: "var(--space-6)",
                      borderRadius: "var(--radius-sm)",
                      cursor: "pointer",
                      textAlign: "left",
                      transition: "background var(--dur-fast) var(--ease-out)",
                    }}
                  >
                    {dotColor && (
                      <span
                        aria-label={dotLabel ?? undefined}
                        title={dotLabel ?? undefined}
                        style={{
                          display: "inline-block",
                          flexShrink: 0,
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: dotColor,
                        }}
                      />
                    )}
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                      {t.title}
                    </span>
                  </button>
                  <button
                    className="otto-recent-delete"
                    aria-label={`Delete ${t.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteThread(t.id);
                    }}
                    style={{
                      position: "absolute",
                      right: "var(--space-2)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 20,
                      height: 20,
                      border: "none",
                      background: "transparent",
                      color: "var(--text-faint)",
                      borderRadius: "var(--radius-sm)",
                      cursor: "pointer",
                      padding: 0,
                      opacity: 0,
                      transition: "opacity var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out)",
                    }}
                  >
                    <IconX />
                  </button>
                </div>
              );
            })}
          </div>
          <style>{`
            .otto-recent-row:hover .otto-recent-delete,
            .otto-recent-row:focus-within .otto-recent-delete {
              opacity: 1;
            }
            .otto-recent-delete:hover {
              background: var(--surface-hover, rgba(0,0,0,0.07)) !important;
              color: var(--text-default) !important;
            }
          `}</style>
        </div>
      )}

      <div style={{ flex: threads.length ? 0 : 1 }} />

      {/* Balance card */}
      <div
        style={{
          margin: "var(--space-3)",
          padding: "var(--space-3) var(--space-4)",
          borderRadius: "var(--radius-md)",
          background: "var(--surface-sunken)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-faint)", fontWeight: "var(--weight-semibold)", marginBottom: 2 }}>
          Your balance
        </div>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: "var(--weight-bold)",
            fontSize: "var(--text-xl)",
            color: "var(--text-strong)",
            letterSpacing: "var(--tracking-snug)",
          }}
        >
          {balanceLabel}
        </div>
      </div>

      {/* User */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)",
          padding: "var(--space-3) var(--space-4)",
          borderTop: "1px solid var(--border-subtle)",
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: "var(--radius-circle)",
            background: "var(--brand-soft)",
            color: "var(--on-brand-soft)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: "var(--weight-bold)",
            fontSize: "var(--text-sm)",
            flexShrink: 0,
          }}
        >
          {initial}
        </div>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: "var(--text-sm)",
              fontWeight: "var(--weight-semibold)",
              color: "var(--text-strong)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {userName}
          </div>
          <div
            style={{
              fontSize: "var(--text-xs)",
              color: "var(--text-faint)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {userEmail}
          </div>
        </div>
      </div>
    </nav>
    </>
  );
}

export default OttoNav;
