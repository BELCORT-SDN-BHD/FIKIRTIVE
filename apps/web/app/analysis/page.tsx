import { HomeAnalysisEntry } from "@/components/home/HomeAnalysisEntry";
import { parseHomeAnalysisContext } from "@/lib/home-analysis-context";

export const dynamic = "force-dynamic";
export const metadata = { title: "Home analysis · Fikirtive" };

export default async function HomeAnalysisPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <HomeAnalysisEntry context={parseHomeAnalysisContext(await searchParams)} />;
}
