"use client";
/**
 * QuickBrief — structured intake form that composes a brief string and saves it
 * via setCoworkBrief. Surfaces in OttoFrontDoor so the brand context is set
 * before Otto starts planning. No money/credit operations.
 */
import { useState } from "react";
import { setCoworkBrief } from "@/lib/cowork-actions";

const MAX_FIELD = 200;

interface QuickBriefProps {
  projectId: string;
  /** Called after a successful save so the parent can update displayed state. */
  onSaved?: (brief: string) => void;
}

/** Compose a concise brief string from the structured fields. */
function composeBrief(fields: { offer: string; audience: string; platform: string; budget: string }): string {
  const parts: string[] = [];
  if (fields.offer.trim()) parts.push(`We offer: ${fields.offer.trim()}`);
  if (fields.audience.trim()) parts.push(`Audience: ${fields.audience.trim()}`);
  if (fields.platform.trim()) parts.push(`Posts on: ${fields.platform.trim()}`);
  if (fields.budget.trim()) parts.push(`Budget vibe: ${fields.budget.trim()}`);
  return parts.join(". ");
}

export function QuickBrief({ projectId, onSaved }: QuickBriefProps) {
  const [open, setOpen] = useState(false);
  const [offer, setOffer] = useState("");
  const [audience, setAudience] = useState("");
  const [platform, setPlatform] = useState("");
  const [budget, setBudget] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const brief = composeBrief({ offer, audience, platform, budget });
    if (!brief) return;
    setSaving(true);
    setError(null);
    const res = await setCoworkBrief({ projectId, brief });
    setSaving(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setSaved(true);
    onSaved?.(brief);
    // Collapse after a brief confirmation pause
    setTimeout(() => { setOpen(false); setSaved(false); }, 1200);
  }

  const fieldStyle: React.CSSProperties = {
    width: "100%",
    padding: "var(--space-2) var(--space-3)",
    fontFamily: "var(--font-sans)",
    fontSize: "var(--text-sm)",
    color: "var(--text-body)",
    background: "var(--surface-base, var(--bg-1))",
    border: "1px solid var(--border-default)",
    borderRadius: "var(--radius-md)",
    outline: "none",
    boxSizing: "border-box",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "var(--text-xs)",
    fontWeight: "var(--weight-semibold)",
    color: "var(--text-faint)",
    marginBottom: "var(--space-1)",
  };

  return (
    <div style={{ width: "100%" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          fontSize: "var(--text-xs)",
          fontWeight: "var(--weight-semibold)",
          color: "var(--text-faint)",
          textTransform: "uppercase",
          letterSpacing: "var(--tracking-caps)",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 0,
          width: "100%",
          justifyContent: "center",
        }}
        aria-expanded={open}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
        Set up brand brief
        <svg
          width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          aria-hidden
          style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <form
          onSubmit={handleSave}
          style={{
            marginTop: "var(--space-4)",
            padding: "var(--space-4)",
            background: "var(--surface-card)",
            border: "1.5px solid var(--border-subtle)",
            borderRadius: "var(--radius-lg)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-3)",
          }}
        >
          <div>
            <label style={labelStyle} htmlFor="qb-offer">What you sell / offer</label>
            <input
              id="qb-offer"
              type="text"
              value={offer}
              onChange={(e) => setOffer(e.target.value.slice(0, MAX_FIELD))}
              placeholder="e.g. handmade ceramic mugs"
              style={fieldStyle}
              disabled={saving}
            />
          </div>
          <div>
            <label style={labelStyle} htmlFor="qb-audience">Who it's for (audience)</label>
            <input
              id="qb-audience"
              type="text"
              value={audience}
              onChange={(e) => setAudience(e.target.value.slice(0, MAX_FIELD))}
              placeholder="e.g. design-minded home cooks, 25–40"
              style={fieldStyle}
              disabled={saving}
            />
          </div>
          <div>
            <label style={labelStyle} htmlFor="qb-platform">Where you'll post (platform)</label>
            <input
              id="qb-platform"
              type="text"
              value={platform}
              onChange={(e) => setPlatform(e.target.value.slice(0, MAX_FIELD))}
              placeholder="e.g. Instagram, TikTok, LinkedIn"
              style={fieldStyle}
              disabled={saving}
            />
          </div>
          <div>
            <label style={labelStyle} htmlFor="qb-budget">Budget vibe <span style={{ fontWeight: 400, textTransform: "none" }}>(optional)</span></label>
            <input
              id="qb-budget"
              type="text"
              value={budget}
              onChange={(e) => setBudget(e.target.value.slice(0, MAX_FIELD))}
              placeholder="e.g. low-cost DIY, or $500/month"
              style={fieldStyle}
              disabled={saving}
            />
          </div>

          {error && (
            <p role="alert" style={{ fontSize: "var(--text-xs)", color: "var(--error-700, var(--danger))", margin: 0 }}>
              {error}
            </p>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)" }}>
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={saving}
              style={{
                padding: "var(--space-2) var(--space-4)",
                fontSize: "var(--text-sm)",
                color: "var(--text-muted)",
                background: "none",
                border: "1px solid var(--border-default)",
                borderRadius: "var(--radius-md)",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !composeBrief({ offer, audience, platform, budget })}
              style={{
                padding: "var(--space-2) var(--space-4)",
                fontSize: "var(--text-sm)",
                fontWeight: "var(--weight-semibold)",
                color: "#fff",
                background: saved ? "var(--success, #22c55e)" : "var(--brand)",
                border: "none",
                borderRadius: "var(--radius-md)",
                cursor: saving || !composeBrief({ offer, audience, platform, budget }) ? "not-allowed" : "pointer",
                opacity: saving ? 0.7 : 1,
                transition: "background 0.2s",
              }}
            >
              {saved ? "Saved!" : saving ? "Saving…" : "Save brief"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default QuickBrief;
