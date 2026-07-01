import { notFound } from "next/navigation";
import { OttoTrace, OttoCanvasStatus, type TraceStep } from "@/components/otto/OttoTrace";

export const dynamic = "force-dynamic";
export const metadata = { title: "Trace preview (dev)" };

/**
 * DEV-ONLY ($0) visual harness for the live step-trace + canvas status pill.
 * Renders the REAL OttoTrace / OttoCanvasStatus components with mock steps so the
 * look can be screenshotted without running (and paying for) a live OTTO turn.
 * 404s in production. Throwaway — delete with the rest of skin-preview.
 */
export default function TracePreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();

  const steps: TraceStep[] = [
    { label: "Researching your brand", status: "done", detail: "cozy · warm" },
    { label: "Wrote 3 captions", status: "done", detail: "3 options" },
    { label: "Making image 1 of 3", status: "active" },
    { label: "Make image 2 of 3", status: "pending" },
    { label: "Make image 3 of 3", status: "pending" },
  ];

  return (
    <div className="fk gb-skin" style={{ display: "flex", minHeight: "100dvh", background: "var(--bg-page)" }}>
      {/* OTTO chat column */}
      <div style={{ width: 452, flex: "none", borderRight: "1px solid var(--border-subtle)", background: "var(--surface-card)", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "14px 18px", borderBottom: "1px solid var(--border-subtle)" }}>
          <svg width="22" height="20" viewBox="0 0 120 110" aria-hidden><g fill="var(--accent)"><ellipse cx="60" cy="64" rx="43" ry="22" /><circle cx="37" cy="52" r="18" /><circle cx="61" cy="40" r="24" /><circle cx="85" cy="53" r="17" /></g></svg>
          <span style={{ flex: 1, fontSize: "var(--text-sm)", fontWeight: "var(--weight-semibold)", color: "var(--text-strong)" }}>Autumn menu launch</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--text-xs)", fontWeight: "var(--weight-semibold)", color: "#9A3A1A", background: "var(--accent-soft)", padding: "4px 9px", borderRadius: 999 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)" }} /> working
          </span>
        </div>
        <div style={{ flex: 1, padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ alignSelf: "flex-end", background: "var(--brand)", color: "var(--text-on-brand)", borderRadius: "15px 15px 5px 15px", padding: "10px 13px", fontSize: "var(--text-sm)", maxWidth: 280 }}>
            Make 3 posts for our autumn menu launch — cozy vibe, ready for Instagram.
          </div>
          <div style={{ background: "var(--surface-sunken)", borderRadius: "5px 15px 15px 15px", padding: "10px 13px", fontSize: "var(--text-sm)", color: "var(--text-body)", maxWidth: 320 }}>
            On it. I&apos;ll match your cozy voice and make three, dropping them on the canvas as they finish.
          </div>
          <OttoTrace steps={steps} />
          <div style={{ display: "flex", alignItems: "center", gap: 7, fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-muted)", padding: "9px 11px", background: "var(--surface-sunken)", borderRadius: "var(--radius-sm)" }}>
            Estimate <b style={{ color: "var(--text-strong)", fontFamily: "var(--font-sans)" }}>≈ 18 credits</b> · billed only when each finishes
            <span style={{ marginLeft: "auto", color: "#9A3A1A", background: "var(--accent-soft)", padding: "2px 8px", borderRadius: 999, fontWeight: 600 }}>6 on hold</span>
          </div>
        </div>
      </div>

      {/* Canvas with the status pill */}
      <div style={{ flex: 1, position: "relative", backgroundColor: "var(--bg-page)", backgroundImage: "radial-gradient(circle, var(--border-default) 1.1px, transparent 1.1px)", backgroundSize: "22px 22px" }}>
        <OttoCanvasStatus label="making image 1 of 3…" />
      </div>
    </div>
  );
}
