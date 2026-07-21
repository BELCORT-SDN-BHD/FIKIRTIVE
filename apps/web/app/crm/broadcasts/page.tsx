import BroadcastListPage from "@/components/crm/broadcasts/broadcast-list-page";
import { getMemberDirectory, listBroadcastRuns } from "@/lib/customer-broadcast-gateway";

export const dynamic = "force-dynamic";
export const metadata = { title: "Broadcasts · Fikirtive" };

export default async function CrmBroadcastsRoute() {
  const [runs, directory] = await Promise.all([listBroadcastRuns({}), getMemberDirectory()]);
  return <BroadcastListPage initialRuns={runs} initialDirectory={directory} />;
}
