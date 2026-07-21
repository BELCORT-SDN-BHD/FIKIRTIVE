import BroadcastComposerPage from "@/components/crm/broadcasts/broadcast-composer-page";
import { getBroadcastComposerOptions, getMemberDirectory } from "@/lib/customer-broadcast-gateway";

export const dynamic = "force-dynamic";
export const metadata = { title: "New broadcast · Fikirtive" };

export default async function CrmBroadcastNewRoute() {
  const [options, directory] = await Promise.all([getBroadcastComposerOptions(), getMemberDirectory()]);
  return <BroadcastComposerPage initialOptions={options} initialDirectory={directory} />;
}
