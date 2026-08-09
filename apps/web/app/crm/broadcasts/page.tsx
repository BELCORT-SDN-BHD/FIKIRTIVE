import BroadcastListPage from "@/components/crm/broadcasts/broadcast-list-page";
import { getMemberDirectory, listBroadcastRuns, listChannelScopes } from "@/lib/customer-broadcast-gateway";
import { getCustomerBroadcastReport } from "@/lib/customer-broadcast-report-ui-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Broadcasts · Fikirtive" };

export default async function CrmBroadcastsRoute() {
  // #727 — the banner and the "New broadcast" entry both depend on whether a messaging channel
  // exists, so the page reads it instead of assuming it.
  const [runs, directory, channelScopes] = await Promise.all([
    listBroadcastRuns({}),
    getMemberDirectory(),
    listChannelScopes(),
  ]);
  const reportRunIds = runs.ok
    ? (
        await Promise.all(
          runs.resource.map(async (run) => ({
            id: run.id,
            report: await getCustomerBroadcastReport({ broadcastRunId: run.id }),
          })),
        )
      ).filter(({ report }) => report.ok).map(({ id }) => id)
    : [];
  return (
    <BroadcastListPage
      initialRuns={runs}
      initialDirectory={directory}
      initialReportRunIds={reportRunIds}
      initialChannelScopes={channelScopes}
    />
  );
}
