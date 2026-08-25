import CampaignListPage from "@/components/campaign/campaign-list-page";
import { listCampaigns } from "@/lib/campaign-view-data";

export const dynamic = "force-dynamic";
export const metadata = { title: "Campaigns · Fikirtive" };

function first(value: string | string[] | undefined): string | undefined { return Array.isArray(value) ? value[0] : value; }

export default async function CampaignPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const fixture = process.env.NODE_ENV !== "production" && first(params.fixture) === "r22";
  if (fixture) {
    const requestedState = first(params.state);
    const fixtureState = requestedState === "loading" || requestedState === "error" || requestedState === "permission" || requestedState === "empty" || requestedState === "mixed" || requestedState === "unknown" ? requestedState : "ready";
    const requestedOutcome = first(params.outcome);
    const fixtureCreateOutcome = requestedOutcome === "error" || requestedOutcome === "permission" || requestedOutcome === "unknown" ? requestedOutcome : "success";
    return <CampaignListPage initialState={{ ok: true, campaigns: [], nextCampaignId: "fixture", nextCampaignProof: "fixture" }} fixture fixtureState={fixtureState} fixtureCreateOutcome={fixtureCreateOutcome} />;
  }
  return <CampaignListPage initialState={await listCampaigns()} />;
}
