import { redirect } from "next/navigation";
import { R22NotificationsView, type R22NotificationState } from "@/components/notifications/R22NotificationsView";
import { R22_NOTIFICATION_FIXTURE_ITEMS } from "@/components/notifications/r22-notification-fixture";
import { requireOwner } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Notifications · Fikirtive" };

function first(value: string | string[] | undefined): string | undefined { return Array.isArray(value) ? value[0] : value; }

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const fixture = process.env.NODE_ENV !== "production" && first(params.fixture) === "r22";
  if (fixture) {
    const requested = first(params.state);
    const state: R22NotificationState = requested === "loading" || requested === "error" || requested === "permission" || requested === "unavailable" || requested === "unknown" ? requested : "ready";
    return <R22NotificationsView initialItems={state === "ready" && requested !== "empty" ? R22_NOTIFICATION_FIXTURE_ITEMS : []} state={state} fixture fixtureRestore={requested !== "empty"} initialSelectedId={first(params.notification)} />;
  }
  const owner = await requireOwner();
  if ("error" in owner) redirect("/login");
  return <R22NotificationsView state="unavailable" />;
}
