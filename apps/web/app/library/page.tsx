import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth-guard";
import { getGenerationHistory, type LibraryItem } from "@/lib/library-actions";
import { getMyAdJobs, type AdJobItem } from "@/lib/data";
import { R22LibraryView } from "@/components/library/R22LibraryView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Library · Fikirtive" };

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const FIXTURE_ITEMS: LibraryItem[] = Array.from({ length: 12 }, (_, index) => ({
  id: `fixture-library-${index + 1}`,
  projectId: "fixture-raya",
  assetId: `fixture-asset-${index + 1}`,
  url: `/fixtures/r22-canvas/art-${index % 4 + 1}.jpg`,
  kind: "image",
  prompt: index < 4 ? `Raya promo image ${index + 1}` : index < 10 ? `Candle care image ${index - 3}` : `Weekend market image ${index - 9}`,
  favorite: false,
  createdAt: new Date(Date.UTC(2026, 7, 24, 10 - index)).toISOString(),
}));

export default async function LibraryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> } = { searchParams: Promise.resolve({}) }) {
  const params = await searchParams;
  const fixture = process.env.NODE_ENV !== "production" && first(params.fixture) === "r22";
  if (fixture) {
    const requestedState = first(params.state);
    const state = requestedState === "loading" || requestedState === "error" || requestedState === "permission" || requestedState === "unknown" ? requestedState : "ready";
    return <R22LibraryView initialItems={state === "ready" && requestedState !== "empty" ? FIXTURE_ITEMS : []} readError={state === "error" ? "fixture read failed" : undefined} state={state} fixture fixtureRestore={requestedState !== "empty"} />;
  }

  const owner = await requireOwner();
  if ("error" in owner) redirect("/login");
  const [result, jobs] = await Promise.all([
    getGenerationHistory({ take: 80 }),
    getMyAdJobs(owner.ownerId).catch(() => null as AdJobItem[] | null),
  ]);
  if ("error" in result) return <R22LibraryView initialItems={[]} readError={result.error} state="error" />;
  return <R22LibraryView initialItems={result.items} initialCursor={result.nextCursor} initialHasMore={result.hasMore} attentionJobs={jobs} />;
}
