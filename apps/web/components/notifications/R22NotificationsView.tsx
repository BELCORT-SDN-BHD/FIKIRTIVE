"use client";
/* eslint-disable react-hooks/set-state-in-effect -- Non-production R22 fixtures restore browser-scoped drafts after hydration. */
import { Button } from "@/components/ui/button";

import Link from "next/link";
import { ArrowLeft, Bell, CheckCheck, Circle, CircleAlert, LockKeyhole, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { readR22NotificationFixture, writeR22NotificationFixture, type R22NotificationItem } from "./r22-notification-fixture";
import "./r22-notifications.css";

export type { R22NotificationItem } from "./r22-notification-fixture";

export type R22NotificationState = "ready" | "loading" | "unavailable" | "error" | "permission" | "unknown";

export function R22NotificationsView({ initialItems = [], state = "unavailable", fixture = false, fixtureRestore = false, initialSelectedId }: { initialItems?: R22NotificationItem[]; state?: R22NotificationState; fixture?: boolean; fixtureRestore?: boolean; initialSelectedId?: string }) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  const [busy, setBusy] = useState(false);
  const [restored, setRestored] = useState(!fixture);
  const visible = useMemo(() => filter === "all" ? items : items.filter((item) => !item.read), [filter, items]);
  const unread = items.filter((item) => !item.read).length;
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const settingsHref = fixture ? "/settings?section=notifications&fixture=r22" : "/settings?section=notifications";

  useEffect(() => {
    if (!fixture || !fixtureRestore) return;
    setItems(readR22NotificationFixture());
    setRestored(true);
  }, [fixture, fixtureRestore]);

  useEffect(() => {
    if (!fixture || !fixtureRestore || !restored) return;
    writeR22NotificationFixture(items);
  }, [fixture, fixtureRestore, restored, items]);

  function openDetail(item: R22NotificationItem) {
    setItems((current) => current.map((row) => row.id === item.id ? { ...row, read: true } : row));
    setSelectedId(item.id);
    if (fixture) router.replace(`/notifications?fixture=r22&notification=${encodeURIComponent(item.id)}`, { scroll: false });
  }

  function closeDetail() {
    setSelectedId(null);
    if (fixture) router.replace("/notifications?fixture=r22", { scroll: false });
  }

  function markAllRead() {
    if (!fixture || busy || unread === 0) return;
    setBusy(true);
    window.setTimeout(() => {
      setItems((current) => current.map((item) => ({ ...item, read: true })));
      setBusy(false);
    }, 200);
  }

  function dismissSelected() {
    if (!fixture || !selected || busy) return;
    setBusy(true);
    window.setTimeout(() => {
      setItems((current) => current.filter((item) => item.id !== selected.id));
      setBusy(false);
      closeDetail();
    }, 200);
  }

  if (state !== "ready") {
    const permission = state === "permission";
    /*
      站岗句清除(Founder 2026-08-26 裁决):这三句 —— "Nothing is guessed while this loads."
      / "Nothing is guessed in its place." / "Fikirtive will not invent events, and will not
      tell you everything is read." —— 都不回答商家的问题,只是对着空气保证自己没做坏事,
      整句删。loading 与 error 删完只剩标题(error 底下就是那颗 Retry),不再挂空段落。
    */
    const body = permission ? "Ask an admin in this workspace to give you access to notifications."
      : state === "unknown" ? "The read may still finish."
      : state === "unavailable" ? "Notifications are not switched on yet, so nothing will reach you here."
      : "";
    return <main className="r22-notifications" data-r22-notifications data-state={state}>
      <header><div><p>Workspace</p><h1>Notifications</h1><span>Review activity without losing the history behind it.</span></div></header>
      <section className="r22-notifications-state" role={state === "error" ? "alert" : undefined}>
        {permission ? <LockKeyhole aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}
        <h2>{permission ? "Notifications are not available to this member" : state === "loading" ? "Loading notifications…" : state === "error" ? "Notifications could not be loaded" : state === "unknown" ? "We could not tell whether your notifications loaded" : "Notification delivery is not connected yet"}</h2>
        {body ? <p>{body}</p> : null}
        {state === "error" || state === "unknown" ? <Link href={fixture ? "/notifications?fixture=r22" : "/notifications"}>Retry</Link> : null}
        <Link href={settingsHref}>Notification settings</Link>
      </section>
    </main>;
  }

  return <main className="r22-notifications" data-r22-notifications data-state="ready" data-fixture={fixture || undefined}>
    <header><div><p>Workspace</p><h1>Notifications</h1><span>Review activity without losing the history behind it.</span></div>{!selected ? <Button unstyled type="button" disabled={!fixture || unread === 0 || busy} onClick={markAllRead}><CheckCheck aria-hidden="true" />{busy ? "Marking…" : "Mark all as read"}</Button> : null}</header>
    {selected ? <article className="r22-notifications-detail"><Button unstyled type="button" onClick={closeDetail}><ArrowLeft aria-hidden="true" />Back to notifications</Button><span className={`r22-notifications-kind is-${selected.kind}`}><Bell aria-hidden="true" /></span><small>{selected.time}</small><h2>{selected.title}</h2><p>{selected.detail}</p><div><Link href={selected.href}>Open activity</Link><Button unstyled type="button" disabled={busy} onClick={dismissSelected}><Trash2 aria-hidden="true" />{busy ? "Dismissing…" : "Dismiss"}</Button></div></article> : <>
    <div className="r22-notifications-toolbar" role="group" aria-label="Filter notifications">
      <Button unstyled type="button" className={filter === "all" ? "is-active" : ""} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All</Button>
      <Button unstyled type="button" className={filter === "unread" ? "is-active" : ""} aria-pressed={filter === "unread"} onClick={() => setFilter("unread")}>Unread <span>{unread}</span></Button>
      <Link href={settingsHref}>Preferences</Link>
    </div>
    {visible.length ? <ol className="r22-notifications-list">{visible.map((item) => <li key={item.id} className={item.read ? "is-read" : ""}>
      <Button unstyled type="button" onClick={() => openDetail(item)}>
        <span className={`r22-notifications-kind is-${item.kind}`}><Bell aria-hidden="true" /></span>
        <span><b>{item.title}</b><small>{item.detail}</small></span>
        <time>{item.time}</time>
        {!item.read ? <Circle className="r22-notifications-unread" aria-label="Unread" fill="currentColor" /> : null}
      </Button>
    </li>)}</ol> : <section className="r22-notifications-state"><Bell aria-hidden="true" /><h2>{filter === "unread" ? "No unread notifications" : "No notification history"}</h2><p>{filter === "unread" ? "Read history is still available under All." : "When a real workspace event arrives, it will appear here."}</p></section>}
    </>}
  </main>;
}

export default R22NotificationsView;
