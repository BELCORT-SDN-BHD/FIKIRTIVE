import SegmentsPage from "@/components/crm/segments-page";
import { listSegments } from "@/lib/segment-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Customer segments · Fikirtive" };

export default async function CustomerSegmentsPage() {
  return <SegmentsPage initialState={await listSegments()} />;
}
