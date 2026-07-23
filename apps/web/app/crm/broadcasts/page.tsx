import BroadcastListPage from "@/components/crm/broadcasts/broadcast-list-page";
import { getMemberDirectory, listBroadcastRuns } from "@/lib/customer-broadcast-gateway";
import { getCustomerBroadcastReport } from "@/lib/customer-broadcast-report-ui-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Broadcasts · Fikirtive" };

export default async function CrmBroadcastsRoute() {
  const [runs, directory] = await Promise.all([listBroadcastRuns({}), getMemberDirectory()]);
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
    />
  );
}
