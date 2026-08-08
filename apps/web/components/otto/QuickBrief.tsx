"use client";
/**
 * QuickBrief — structured intake form that composes the PROJECT brief string and
 * saves it via setCoworkBrief (Project.coworkBrief — per-project, see CONTEXT.md
 * "Project Brief"). Surfaces in OttoFrontDoor so this project's brief is set
 * before Otto starts planning. Brand-constant facts live in Brand memory; this
 * form captures project-specific inputs only. No money/credit operations.
 *
 * #791-1: Otto now actually reads this brief every turn (buildOttoContext →
 * ctx.projectBrief), and opening the form shows the brief already stored so a
 * save can't quietly replace direction the merchant (or Otto) wrote earlier.
 */
import { useState } from "react";
import { getCoworkBrief, setCoworkBrief } from "@/lib/cowork-actions";

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

/** What the form knows about the brief already stored for this project.
 *  "loading" is a real state — a blank form is NOT proof there is nothing to lose. */
type CurrentBrief =
  | { state: "loading" }
  | { state: "known"; brief: string }
  | { state: "unreadable"; message: string };

export function QuickBrief({ projectId, onSaved }: QuickBriefProps) {
  const [open, setOpen] = useState(false);
  const [offer, setOffer] = useState("");
  const [audience, setAudience] = useState("");
  const [platform, setPlatform] = useState("");
  const [budget, setBudget] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<CurrentBrief>({ state: "loading" });

  /** #791-1: saving REPLACES Project.coworkBrief outright, so the merchant has to see
   *  what is there before they type over it. Read on every open — Otto's updateBrief can
   *  have rewritten it since the last time this form was open. */
  function toggleOpen() {
    setOpen((wasOpen) => {
      if (!wasOpen) {
        setCurrent({ state: "loading" });
        void getCoworkBrief(projectId).then((res) => {
          setCurrent(
            "error" in res ? { state: "unreadable", message: res.error } : { state: "known", brief: res.brief },
          );
        });
      }
      return !wasOpen;
    });
  }

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
    setCurrent({ state: "known", brief });
    onSaved?.(brief);
    // Collapse after a brief confirmation pause
    setTimeout(() => { setOpen(false); setSaved(false); }, 1200);
  }

  return (
    /* leading-[1.5] — design-baseline body line-height (Analytics standard) */
    <div className="gb leading-[1.5] w-full">
      <button
        type="button"
        onClick={toggleOpen}
        className="flex items-center justify-center gap-2 text-[0.65625rem] font-semibold text-muted-foreground/70 uppercase tracking-[0.07em] bg-transparent border-0 cursor-pointer p-0 w-full"
        aria-expanded={open}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
        Project brief
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
          className="mt-4 p-4 bg-card border border-border rounded-[14px] flex flex-col gap-3"
          style={{ borderWidth: "1.5px" }}
        >
          <p className="m-0 text-[0.75rem] text-muted-foreground/70">
            Use this for the offer, audience, channel, and budget in this project. Shop-wide identity and catalog facts live in Brand memory.
          </p>
          {/* The brief already stored for this project. Saving replaces it, so it is shown
              before the fields, never after — and a failed read says so instead of reading
              like an empty brief. */}
          {current.state === "loading" ? (
            <p className="m-0 text-[0.75rem] text-muted-foreground/70">Checking this project&apos;s brief…</p>
          ) : current.state === "unreadable" ? (
            <p role="alert" className="m-0 text-[0.75rem] text-[var(--error-soft-foreground)]">
              {current.message}
            </p>
          ) : current.brief ? (
            <div className="rounded-[10px] bg-muted/45 p-3">
              <p className="m-0 mb-1 text-[0.6875rem] font-semibold uppercase tracking-[0.07em] text-muted-foreground/70">
                Brief saved now
              </p>
              <p className="m-0 text-[0.75rem] leading-[1.5] text-foreground">{current.brief}</p>
              <p className="m-0 mt-2 text-[0.6875rem] text-muted-foreground/70">
                Saving below will replace this text.
              </p>
            </div>
          ) : (
            <p className="m-0 text-[0.75rem] text-muted-foreground/70">No brief yet for this project.</p>
          )}
          <div>
            <label className="block text-[0.75rem] font-semibold text-muted-foreground/70 mb-1" htmlFor="qb-offer">Offer for this project</label>
            <input
              id="qb-offer"
              type="text"
              value={offer}
              onChange={(e) => setOffer(e.target.value.slice(0, MAX_FIELD))}
              placeholder="e.g. the summer mug collection"
              className="w-full py-2 px-3 text-[0.875rem] text-foreground bg-card border border-border rounded-[14px] outline-none box-border"
              disabled={saving}
            />
          </div>
          <div>
            <label className="block text-[0.75rem] font-semibold text-muted-foreground/70 mb-1" htmlFor="qb-audience">Audience for this project</label>
            <input
              id="qb-audience"
              type="text"
              value={audience}
              onChange={(e) => setAudience(e.target.value.slice(0, MAX_FIELD))}
              placeholder="e.g. first-time home buyers"
              className="w-full py-2 px-3 text-[0.875rem] text-foreground bg-card border border-border rounded-[14px] outline-none box-border"
              disabled={saving}
            />
          </div>
          <div>
            <label className="block text-[0.75rem] font-semibold text-muted-foreground/70 mb-1" htmlFor="qb-platform">Where this project will run</label>
            <input
              id="qb-platform"
              type="text"
              value={platform}
              onChange={(e) => setPlatform(e.target.value.slice(0, MAX_FIELD))}
              placeholder="e.g. Instagram, TikTok, LinkedIn"
              className="w-full py-2 px-3 text-[0.875rem] text-foreground bg-card border border-border rounded-[14px] outline-none box-border"
              disabled={saving}
            />
          </div>
          <div>
            <label className="block text-[0.75rem] font-semibold text-muted-foreground/70 mb-1" htmlFor="qb-budget">Budget for this project <span className="font-normal normal-case">(optional)</span></label>
            <input
              id="qb-budget"
              type="text"
              value={budget}
              onChange={(e) => setBudget(e.target.value.slice(0, MAX_FIELD))}
              placeholder="e.g. low-cost DIY, or $500/month"
              className="w-full py-2 px-3 text-[0.875rem] text-foreground bg-card border border-border rounded-[14px] outline-none box-border"
              disabled={saving}
            />
          </div>
          {error && (
            <p role="alert" className="text-[0.75rem] text-[var(--error-soft-foreground)] m-0">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={saving}
              className="py-2 px-4 text-[0.875rem] text-muted-foreground bg-transparent border border-border rounded-[14px] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !composeBrief({ offer, audience, platform, budget })}
              className="py-2 px-4 text-[0.875rem] font-semibold text-primary-foreground rounded-[14px] border-0 transition-colors duration-150"
              style={{
                background: saved ? "var(--success, #22c55e)" : "var(--primary)",
                cursor: saving || !composeBrief({ offer, audience, platform, budget }) ? "not-allowed" : "pointer",
                opacity: saving ? 0.7 : 1,
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
