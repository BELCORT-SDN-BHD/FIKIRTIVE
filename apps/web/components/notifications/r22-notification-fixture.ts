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

/**
 * 样例通知。
 *
 * beta V1 的导航只留创作那五扇门(Founder 裁决 2026-08-26),所以这三条**样例本身**也全部
 * 落在创作上:上一版那两条指向 Approvals 与 Schedule,那两扇门此刻不在侧栏里,商家点过去
 * 会掉进一处他刚刚才发现「不存在」的地方。样例不是装饰,它承诺的是「这个产品会跟你说这类
 * 事」——承诺一件此刻做不到的事,和屏幕上写一句假话是同一件事。
 *
 * `kind` 的 approval / publishing 两支留在类型里没动:门回来的时候样例跟着回来,那时不用
 * 再改一次类型与配色。
 */
export const R22_NOTIFICATION_FIXTURE_ITEMS: R22NotificationItem[] = [
  { id: "fixture-generation", title: "Canvas export is ready", detail: "Four Raya concepts finished generating.", time: "8 min", href: "/create/canvas?project=fixture-raya&fixture=r22", read: false, kind: "generation" },
  { id: "fixture-quick-create", title: "Quick create finished", detail: "Two new pictures are in your Library.", time: "1 hr", href: "/library?fixture=r22", read: false, kind: "generation" },
  { id: "fixture-edit", title: "Edited picture saved", detail: "Raya hero, teal batik — Warmer light is in your Library.", time: "Yesterday", href: "/library?fixture=r22", read: true, kind: "generation" },
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
