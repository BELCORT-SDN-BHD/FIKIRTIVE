import BroadcastDetailPage from "@/components/crm/broadcasts/broadcast-detail-page";
import {
  getBroadcastComposerOptions,
  getBroadcastRun,
  getBroadcastRunLivePreflight,
  getMemberDirectory,
} from "@/lib/customer-broadcast-gateway";

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
  const [run, preflight, directory, options] = await Promise.all([
    getBroadcastRun({ broadcastRunId: id }),
    getBroadcastRunLivePreflight({ broadcastRunId: id }),
    getMemberDirectory(),
    getBroadcastComposerOptions(),
  ]);
  return (
    <BroadcastDetailPage
      broadcastRunId={id}
      initialRun={run}
      initialPreflight={preflight}
      initialDirectory={directory}
      initialOptions={options}
      preselectedSegmentId={query.segment ?? null}
    />
  );
}
