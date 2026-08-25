import { readR22WorkspaceDirectory, scopedR22FixtureKey } from "@/components/r22/r22-workspace-fixture";

export type R22NotificationItem = {
  id: string;
  title: string;
  detail: string;
  time: string;
  href: string;
  read: boolean;
  kind: "approval" | "generation" | "publishing";
};

export const R22_NOTIFICATION_FIXTURE_KEY = "fikirtive.r22.notifications.v1";
export const R22_NOTIFICATION_FIXTURE_EVENT = "fikirtive:r22-notifications";

export const R22_NOTIFICATION_FIXTURE_ITEMS: R22NotificationItem[] = [
  { id: "fixture-approval", title: "5 posts need approval", detail: "Raya launch is waiting for your decision.", time: "8 min", href: "/approvals?fixture=r22", read: false, kind: "approval" },
  { id: "fixture-generation", title: "Canvas export is ready", detail: "Four Raya concepts finished generating.", time: "1 hr", href: "/create/canvas?project=fixture-raya&fixture=r22", read: false, kind: "generation" },
  { id: "fixture-publish", title: "Weekend market post published", detail: "Instagram accepted the scheduled post.", time: "Yesterday", href: "/schedule?fixture=r22", read: true, kind: "publishing" },
];

export function readR22NotificationFixture(): R22NotificationItem[] {
  if (typeof window === "undefined") return R22_NOTIFICATION_FIXTURE_ITEMS;
  try {
    const raw = window.sessionStorage.getItem(scopedR22FixtureKey(R22_NOTIFICATION_FIXTURE_KEY));
    return raw ? JSON.parse(raw) as R22NotificationItem[] : readR22WorkspaceDirectory().activeId === "batik-house" ? R22_NOTIFICATION_FIXTURE_ITEMS : [];
  } catch {
    return readR22WorkspaceDirectory().activeId === "batik-house" ? R22_NOTIFICATION_FIXTURE_ITEMS : [];
  }
}

export function writeR22NotificationFixture(items: R22NotificationItem[]) {
  try {
    window.sessionStorage.setItem(scopedR22FixtureKey(R22_NOTIFICATION_FIXTURE_KEY), JSON.stringify(items));
    window.dispatchEvent(new CustomEvent(R22_NOTIFICATION_FIXTURE_EVENT, { detail: items }));
  } catch {
    // A blocked storage API must not break the visual fixture.
  }
}
