import BroadcastReportDetailPage from "@/components/crm/reports/broadcast-report-detail-page";
import { getBroadcastRun } from "@/lib/customer-broadcast-ui-actions";
import {
  getBroadcastDeliveryReceipt,
  getCustomerBroadcastReport,
} from "@/lib/customer-broadcast-report-ui-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Broadcast report · Fikirtive" };

export default async function CrmBroadcastReportRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [run, report] = await Promise.all([
    getBroadcastRun({ broadcastRunId: id }),
    getCustomerBroadcastReport({ broadcastRunId: id }),
  ]);
  const receipts = run.ok
    ? await Promise.all(
        run.resource.members.map(async (member) => ({
          audienceMemberId: member.id,
          result: await getBroadcastDeliveryReceipt({
            broadcastRunId: id,
            audienceMemberId: member.id,
          }),
        })),
      )
    : [];

  return (
    <BroadcastReportDetailPage
      broadcastRunId={id}
      initialState={{ run, report, receipts }}
    />
  );
}
