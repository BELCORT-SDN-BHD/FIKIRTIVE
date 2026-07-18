import CampaignDetailPage from "@/components/campaign/campaign-detail-page";
import { getCampaign } from "@/lib/campaign-view-data";

export const dynamic = "force-dynamic";
export const metadata = { title: "Campaign detail · Fikirtive" };

export default async function CampaignDetailRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CampaignDetailPage initialState={await getCampaign(id)} />;
}

