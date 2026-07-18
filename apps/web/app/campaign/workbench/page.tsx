import CampaignWorkbenchPage from "@/components/campaign/campaign-workbench-page";
import { listCampaigns } from "@/lib/campaign-view-data";

export const dynamic = "force-dynamic";
export const metadata = { title: "Campaign workbench · Fikirtive" };

export default async function CampaignWorkbenchRoute() {
  return <CampaignWorkbenchPage initialState={await listCampaigns()} />;
}

