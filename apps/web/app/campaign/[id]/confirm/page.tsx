import CampaignConfirmPage from "@/components/campaign/campaign-confirm-page";
import { getCampaign } from "@/lib/campaign-view-data";
import { quoteCampaignGeneration } from "@/lib/campaign-generation-confirm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Confirm campaign generation · Fikirtive" };

export default async function CampaignConfirmRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Server-load the owner-scoped detail (plan + grouped projects) and the server-recomputed
  // quote in parallel. The price shown to the owner is computed here on the server, never on
  // the client (§7.2.1 anti-flip).
  const [detail, quote] = await Promise.all([getCampaign(id), quoteCampaignGeneration(id)]);
  return <CampaignConfirmPage campaignId={id} detail={detail} quote={quote} />;
}
