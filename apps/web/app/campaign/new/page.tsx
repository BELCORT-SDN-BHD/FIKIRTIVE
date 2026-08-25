import CampaignWorkbenchPage from "@/components/campaign/campaign-workbench-page";
import { listCampaigns } from "@/lib/campaign-view-data";

export const dynamic = "force-dynamic";
export const metadata = { title: "Plan a campaign · Fikirtive" };

export default async function NewCampaignPage() { return <CampaignWorkbenchPage initialState={await listCampaigns()} />; }
