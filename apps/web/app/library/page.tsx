import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth-guard";
import { getGenerationHistory } from "@/lib/library-actions";
import { getMyAdJobs, type AdJobItem } from "@/lib/data";
import { R22LibraryView } from "@/components/library/R22LibraryView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Library · Fikirtive" };

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LibraryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> } = { searchParams: Promise.resolve({}) }) {
  const params = await searchParams;
  const fixture = process.env.NODE_ENV !== "production" && first(params.fixture) === "r22";
  if (fixture) {
    // 样张的那批素材住在 `components/library/library-fixture.ts`(工作台自己播种),这一页
    // 不再自己捏一份 12 张的假历史 —— 两处各写一份正是上一版最容易漂移的地方。
    const requestedState = first(params.state);
    const state = requestedState === "loading" || requestedState === "error" || requestedState === "permission" || requestedState === "unknown" ? requestedState : "ready";
    return <R22LibraryView initialItems={[]} readError={state === "error" ? "fixture read failed" : undefined} state={state} fixture fixtureEmpty={requestedState === "empty"} />;
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
