import { notFound } from "next/navigation";
import { CostAdmin, type DayRow, type JobRow } from "@/components/admin/CostAdmin";
import { SettingsAdmin } from "@/components/admin/SettingsAdmin";
export const dynamic = "force-dynamic";
export const metadata = { title: "Admin skin preview (dev)" };

/** DEV-ONLY harness for the admin dark→light (.gb) re-skin. Renders real
 * prop-driven admin components with mock data — the live /admin is
 * founder-auth-walled. 404s in prod. ?c=settings renders the ds-primitive
 * (al-* recipe) component to check Button/Badge under .gb. */
const NAV = ["Settings", "Prompt & knowledge", "Knowledge", "Model & provider", "Cost & usage", "Credits", "Content review", "Otto conversations", "Team & access", "Tenants", "System & queue"];

const DAYS: DayRow[] = [
  { day: "2026-06-30", usd: 142.18, jobs: 318 },
  { day: "2026-06-29", usd: 98.44, jobs: 221 },
  { day: "2026-06-28", usd: 211.07, jobs: 489 },
];
const JOBS: JobRow[] = [
  { id: "gj_8c21", source: "gen", label: "video", model: "Video", count: 1, status: "SUCCEEDED", spentUsd: 0.62, finishedAt: "2026-06-30T14:22:00.000Z" },
  { id: "rg_77a2", source: "refgen", label: "ref:remix", model: "Image", count: 2, status: "FAILED", spentUsd: 0.0, finishedAt: "2026-06-30T13:51:00.000Z" },
];

export default async function AdminSkinPreview({ searchParams }: { searchParams?: Promise<{ c?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const sp = await searchParams;
  const which = sp?.c ?? "cost";
  return (
    <div className="admin-shell gb">
      <nav className="admin-nav">
        {NAV.map((n, i) => (
          <a key={n} href="#" className="admin-nav-link" aria-current={i === 4 ? "page" : undefined} style={i === 4 ? { background: "var(--accent)", color: "var(--foreground)" } : undefined}>{n}</a>
        ))}
      </nav>
      <main className="admin-content">
        {which === "settings"
          ? <SettingsAdmin vision={{ enabled: true, maxImages: 4, maxBytes: 5242880 }} provider="mock" canModal={true} />
          : <CostAdmin days={DAYS} jobs={JOBS} totalUsd={516.59} jobCount={1170} sinceDays={30} />}
      </main>
    </div>
  );
}
