import CampaignCalendarPage from "@/components/campaign/campaign-calendar-page";
import { listCampaigns } from "@/lib/campaign-view-data";

export const dynamic = "force-dynamic";
export const metadata = { title: "Campaign calendar · Fikirtive" };

export default async function CampaignCalendarRoute() {
  return <CampaignCalendarPage initialState={await listCampaigns()} />;
}

