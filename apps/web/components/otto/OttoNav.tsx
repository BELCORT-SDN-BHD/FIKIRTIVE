"use client";
import React from "react";
import type { OttoViewKey } from "./OttoApp";
import type { ChatThreadDTO } from "@/lib/types";

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

const NAV_ITEMS: NavItem[] = [
  { key: "otto", label: "Otto", icon: <IconMessageCircle /> },
  { key: "stuff", label: "My stuff", icon: <IconFolderHeart /> },
  { key: "memory", label: "Brand memory", icon: <IconBrain /> },
  { key: "account", label: "Account", icon: <IconCircleUser /> },
];

export interface OttoNavProps {
  view: OttoViewKey;
  onViewChange: (v: OttoViewKey) => void;
  threads: ChatThreadDTO[];
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  onNewCampaign: () => void;
  balanceUsd: number;
  userName: string;
  userEmail: string;
}

export function OttoNav({
  view,
  onViewChange,
  threads,
  activeThreadId,
  onSelectThread,
  onNewCampaign,
  balanceUsd,
  userName,
  userEmail,
}: OttoNavProps) {
  const initial = userName.slice(0, 1).toUpperCase();
  const balanceLabel = "$" + balanceUsd.toFixed(2);

  return (
    <nav
      style={{
        width: 240,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        borderRight: "1px solid var(--border-subtle)",
        background: "var(--surface-card)",
        overflow: "hidden",
        padding: "var(--space-4) 0",
      }}
    >
      {/* Logo */}
      <div style={{ padding: "0 var(--space-4) var(--space-4)", borderBottom: "1px solid var(--border-subtle)" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/logo-wordmark.svg"
          alt="Fikirtive"
          height={28}
          style={{ display: "block" }}
        />
      </div>

      {/* New campaign button */}
      <div style={{ padding: "var(--space-4) var(--space-3) var(--space-3)" }}>
        <button
          onClick={onNewCampaign}
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
              onClick={() => onViewChange(item.key)}
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
              return (
                <button
                  key={t.id}
                  onClick={() => {
                    onSelectThread(t.id);
                    onViewChange("otto");
                  }}
                  title={t.title}
                  style={{
                    display: "block",
                    width: "100%",
                    border: "none",
                    background: isActive ? "var(--brand-tint)" : "transparent",
                    color: isActive ? "var(--brand-press)" : "var(--text-muted)",
                    fontFamily: "var(--font-sans)",
                    fontSize: "var(--text-xs)",
                    fontWeight: isActive ? "var(--weight-semibold)" : "var(--weight-regular)",
                    padding: "7px var(--space-3)",
                    borderRadius: "var(--radius-sm)",
                    cursor: "pointer",
                    textAlign: "left",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    transition: "background var(--dur-fast) var(--ease-out)",
                  }}
                >
                  {t.title}
                </button>
              );
            })}
          </div>
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
  );
}

export default OttoNav;
