import BroadcastDetailPage from "@/components/crm/broadcasts/broadcast-detail-page";
import {
  getBroadcastComposerOptions,
  getBroadcastRun,
  getBroadcastRunLivePreflight,
  getMemberDirectory,
} from "@/lib/customer-broadcast-gateway";
import { getCustomerBroadcastReport } from "@/lib/customer-broadcast-report-ui-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Broadcast · Fikirtive" };

export default async function CrmBroadcastDetailRoute({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ segment?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const [run, preflight, directory, options, report] = await Promise.all([
    getBroadcastRun({ broadcastRunId: id }),
    getBroadcastRunLivePreflight({ broadcastRunId: id }),
    getMemberDirectory(),
    getBroadcastComposerOptions(),
    getCustomerBroadcastReport({ broadcastRunId: id }),
  ]);
  return (
    <BroadcastDetailPage
      broadcastRunId={id}
      initialRun={run}
      initialPreflight={preflight}
      initialDirectory={directory}
      initialOptions={options}
      initialReportAvailable={report.ok}
      preselectedSegmentId={query.segment ?? null}
    />
  );
}
