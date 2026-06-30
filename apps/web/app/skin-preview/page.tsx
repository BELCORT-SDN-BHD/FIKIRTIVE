import { notFound } from "next/navigation";
import { OttoApp, type OttoViewKey } from "@/components/otto/OttoApp";
import type { MemoryRow } from "@/lib/memory-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Skin preview (dev)" };

/**
 * DEV-ONLY visual harness for the Grok-bright re-skin.
 * Renders the REAL OttoApp shell with mock data so it can be screenshotted
 * without auth (/otto is auth-walled). 404s in production. THROWAWAY — delete
 * once the re-skin ships.
 *   ?skin=fk         show the old look (default is gb)
 *   ?nav=collapsed   start with the sidebar collapsed
 *   ?chat=collapsed  start with the OTTO pane collapsed
 */
export default async function SkinPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ skin?: string; nav?: string; chat?: string; view?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const sp = await searchParams;
  const skin = sp?.skin === "fk" ? undefined : ("gb" as const);

  // One memory row flips isFirstRun=false so the real front door shows (not onboarding).
  const memory: MemoryRow[] = [
    {
      id: "m1",
      category: "voice",
      content: "Cozy, warm, a little playful.",
      source: "otto",
      pinned: true,
      updatedAt: new Date(0),
    },
  ];

  const iso = new Date(0).toISOString();
  return (
    <OttoApp
      projectId="p1"
      projects={[
        { id: "p1", name: "Autumn menu launch" },
        { id: "p2", name: "Sci-fi teaser" },
      ]}
      activeProjectId="p1"
      sidebarThreads={[
        { id: "t1", projectId: "p1", title: "Croissant hero shots", updatedAt: iso, messages: [], status: "done" },
        { id: "t2", projectId: "p1", title: "Latte art video", updatedAt: iso, messages: [], status: "working" },
        { id: "t3", projectId: "p2", title: "Teaser concepts", updatedAt: iso, messages: [], status: null },
      ]}
      entities={[]}
      threads={[]}
      balanceUsd={84}
      balanceCredits={840}
      userName="rosa"
      userEmail="rosa@bloomcoffee.co"
      memory={memory}
      ads={[]}
      adJobs={[]}
      account={null}
      history={Array.from({ length: 6 }, (_, i) => ({
        id: `h${i}`,
        src: `https://picsum.photos/seed/hist${i}/120/120`,
        kind: "image" as const,
      }))}
      ottoStreamEnabled={false}
      initialView={(sp?.view as OttoViewKey | undefined) ?? "otto"}
      skin={skin}
      initialNavCollapsed={sp?.nav === "collapsed"}
      initialChatCollapsed={sp?.chat === "collapsed"}
    />
  );
}
