import BroadcastReportListPage from "@/components/crm/reports/broadcast-report-list-page";
import { listBroadcastRuns } from "@/lib/customer-broadcast-ui-actions";
import { getCustomerBroadcastReport } from "@/lib/customer-broadcast-report-ui-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Delivery reports · Fikirtive" };

export default async function CrmReportsRoute() {
  const runs = await listBroadcastRuns({});
  const items = runs.ok
    ? await Promise.all(
        runs.resource.map(async (run) => ({
          run,
          report: await getCustomerBroadcastReport({ broadcastRunId: run.id }),
        })),
      )
    : [];

  return <BroadcastReportListPage initialRuns={runs} initialItems={items} />;
}
