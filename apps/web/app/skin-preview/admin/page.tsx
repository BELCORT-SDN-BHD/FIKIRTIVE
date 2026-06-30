import { notFound } from "next/navigation";
import { CostAdmin, type DayRow, type JobRow } from "@/components/admin/CostAdmin";
export const dynamic = "force-dynamic";
export const metadata = { title: "Admin skin preview (dev)" };

/** DEV-ONLY harness for the admin dark→light (.gb) re-skin. Renders the real
 * admin shell + nav + a real prop-driven admin component (CostAdmin) with mock
 * data — the live /admin is founder-auth-walled. 404s in prod. */
const NAV = ["Settings", "Prompt & knowledge", "Knowledge", "Model & provider", "Cost & usage", "Credits", "Content review", "Otto conversations", "Team & access", "Tenants", "System & queue"];

const DAYS: DayRow[] = [
  { day: "2026-06-30", usd: 142.18, jobs: 318 },
  { day: "2026-06-29", usd: 98.44, jobs: 221 },
  { day: "2026-06-28", usd: 211.07, jobs: 489 },
  { day: "2026-06-27", usd: 64.9, jobs: 142 },
];
const JOBS: JobRow[] = [
  { id: "gj_8c21", source: "gen", label: "video", model: "seedance-1.0-pro", count: 1, status: "SUCCEEDED", spentUsd: 0.62, finishedAt: "2026-06-30T14:22:00.000Z" },
  { id: "gj_8c19", source: "gen", label: "image", model: "seedream-3.0", count: 4, status: "SUCCEEDED", spentUsd: 0.18, finishedAt: "2026-06-30T14:08:00.000Z" },
  { id: "rg_77a2", source: "refgen", label: "ref:remix", model: "seedream-3.0", count: 2, status: "FAILED", spentUsd: 0.0, finishedAt: "2026-06-30T13:51:00.000Z" },
  { id: "gj_8b04", source: "gen", label: "video", model: "seedance-1.0-pro", count: 1, status: "RUNNING", spentUsd: 0.0, finishedAt: "2026-06-30T13:40:00.000Z" },
];

export default function AdminSkinPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className="admin-shell gb">
      <nav className="admin-nav">
        {NAV.map((n, i) => (
          <a key={n} href="#" className="admin-nav-link" aria-current={i === 4 ? "page" : undefined} style={i === 4 ? { background: "var(--accent)", color: "var(--foreground)" } : undefined}>{n}</a>
        ))}
      </nav>
      <main className="admin-content">
        <CostAdmin days={DAYS} jobs={JOBS} totalUsd={516.59} jobCount={1170} sinceDays={30} />
      </main>
    </div>
  );
}
