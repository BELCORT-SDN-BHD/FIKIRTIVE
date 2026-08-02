"use client";
/**
 * QuickBrief — structured intake form that composes the PROJECT brief string and
 * saves it via setCoworkBrief (Project.coworkBrief — per-project, see CONTEXT.md
 * "Project Brief"). Surfaces in OttoFrontDoor so this project's brief is set
 * before Otto starts planning. Brand-constant facts live in Brand memory; this
 * form captures only the goal and deliverable for the current Project. No money/credit operations.
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
function composeBrief(fields: { goal: string; deliverable: string; audience: string; platform: string }): string {
  const parts: string[] = [];
  if (fields.goal.trim()) parts.push(`Goal: ${fields.goal.trim()}`);
  if (fields.deliverable.trim()) parts.push(`Deliverable: ${fields.deliverable.trim()}`);
  if (fields.audience.trim()) parts.push(`Audience: ${fields.audience.trim()}`);
  if (fields.platform.trim()) parts.push(`Channel: ${fields.platform.trim()}`);
  return parts.join(". ");
}

export function QuickBrief({ projectId, onSaved }: QuickBriefProps) {
  const [open, setOpen] = useState(false);
  const [goal, setGoal] = useState("");
  const [deliverable, setDeliverable] = useState("");
  const [audience, setAudience] = useState("");
  const [platform, setPlatform] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const brief = composeBrief({ goal, deliverable, audience, platform });
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

  return (
    /* leading-[1.5] — design-baseline body line-height (Analytics standard) */
    <div className="gb leading-[1.5] w-full">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
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
            Use this for the goal and deliverables in this Project. Shop-wide identity and catalog facts live in Brand memory.
          </p>
          <div>
            <label className="block text-[0.75rem] font-semibold text-muted-foreground/70 mb-1" htmlFor="qb-goal">Project goal</label>
            <input
              id="qb-goal"
              type="text"
              value={goal}
              onChange={(e) => setGoal(e.target.value.slice(0, MAX_FIELD))}
              placeholder="e.g. launch the summer collection"
              className="w-full py-2 px-3 text-[0.875rem] text-foreground bg-card border border-border rounded-[14px] outline-none box-border"
              disabled={saving}
            />
          </div>
          <div>
            <label className="block text-[0.75rem] font-semibold text-muted-foreground/70 mb-1" htmlFor="qb-deliverable">What are you making?</label>
            <input
              id="qb-deliverable"
              type="text"
              value={deliverable}
              onChange={(e) => setDeliverable(e.target.value.slice(0, MAX_FIELD))}
              placeholder="e.g. three 15-second vertical videos"
              className="w-full py-2 px-3 text-[0.875rem] text-foreground bg-card border border-border rounded-[14px] outline-none box-border"
              disabled={saving}
            />
          </div>
          <div>
            <label className="block text-[0.75rem] font-semibold text-muted-foreground/70 mb-1" htmlFor="qb-audience">Who it&apos;s for (audience)</label>
            <input
              id="qb-audience"
              type="text"
              value={audience}
              onChange={(e) => setAudience(e.target.value.slice(0, MAX_FIELD))}
              placeholder="e.g. design-minded home cooks, 25–40"
              className="w-full py-2 px-3 text-[0.875rem] text-foreground bg-card border border-border rounded-[14px] outline-none box-border"
              disabled={saving}
            />
          </div>
          <div>
            <label className="block text-[0.75rem] font-semibold text-muted-foreground/70 mb-1" htmlFor="qb-platform">Where will it run?</label>
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
              disabled={saving || !composeBrief({ goal, deliverable, audience, platform })}
              className="py-2 px-4 text-[0.875rem] font-semibold text-primary-foreground rounded-[14px] border-0 transition-colors duration-150"
              style={{
                background: saved ? "var(--success, #22c55e)" : "var(--primary)",
                cursor: saving || !composeBrief({ goal, deliverable, audience, platform }) ? "not-allowed" : "pointer",
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
