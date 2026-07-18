import CampaignTrendsPage from "@/components/campaign/campaign-trends-page";
import { listCampaigns } from "@/lib/campaign-view-data";
import { listTrendSnapshots } from "@/lib/trend-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Campaign trends · Fikirtive" };

export default async function CampaignTrendsRoute() {
  const [initialTrends, initialCampaigns] = await Promise.all([
    listTrendSnapshots(),
    listCampaigns(),
  ]);
  return <CampaignTrendsPage initialTrends={initialTrends} initialCampaigns={initialCampaigns} />;
}

