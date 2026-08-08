import CampaignConfirmPage from "@/components/campaign/campaign-confirm-page";
import { getCampaign } from "@/lib/campaign-view-data";
import { quoteCampaignGeneration } from "@/lib/campaign-generation-confirm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Confirm campaign generation · Fikirtive" };

export default async function CampaignConfirmRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Server-load the owner-scoped detail (plan + grouped projects) first, then the
  // server-recomputed quote FOR THE PROJECT THE PAGE WILL PRESELECT. The price shown to the
  // owner is computed here on the server, never on the client (§7.2.1 anti-flip).
  //
  // #708:报价必须知道目的项目 ——「这个条目已经生成过了、不会再收费」是 owner+project
  // 范围内的事实。不知道项目就只能按全价报,而那正是把商家挡在门外的那个数。所以这两次
  // 读改成先后而不是并行,并且这里预选的项目与确认卡默认选中的项目是同一个。
  const detail = await getCampaign(id);
  const projectId = "ok" in detail ? detail.campaign.grouped.projects[0]?.id ?? null : null;
  const quote = await quoteCampaignGeneration(id, { projectId });
  return <CampaignConfirmPage campaignId={id} detail={detail} quote={quote} />;
}
