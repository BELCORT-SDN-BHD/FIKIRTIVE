import CampaignListPage from "@/components/campaign/campaign-list-page";
import { listCampaigns } from "@/lib/campaign-view-data";

export const dynamic = "force-dynamic";
export const metadata = { title: "Campaigns · Fikirtive" };

export default async function CampaignPage() {
  return <CampaignListPage initialState={await listCampaigns()} />;
}

