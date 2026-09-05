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
import { Check, ChevronDown, NotebookPen } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { getCoworkBrief, setCoworkBrief } from "@/lib/cowork-actions";
import { PRODUCT_VOCABULARY } from "@/lib/product-vocabulary";
import { cn } from "@/lib/utils";

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
    <div className="gb w-full leading-[1.5]">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={toggleOpen}
        className="w-full justify-start px-2 text-muted-foreground"
        aria-expanded={open}
      >
        <NotebookPen data-icon="inline-start" aria-hidden="true" />
        {`${PRODUCT_VOCABULARY.canvas} brief`}
        <ChevronDown
          data-icon="inline-end"
          aria-hidden="true"
          className={cn("ml-auto transition-transform duration-[var(--dur-2)]", open && "rotate-180")}
        />
      </Button>

      {open && (
        <Card size="sm" className="mt-3 shadow-none">
          <CardHeader>
            <CardTitle>{`${PRODUCT_VOCABULARY.canvas} direction`}</CardTitle>
            <CardDescription>
              Add the offer, audience, channel, and budget for this {PRODUCT_VOCABULARY.canvas}. Shop-wide facts stay in
              Brand memory.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSave} className="flex flex-col gap-4">
              {/* The brief already stored for this project. Saving replaces it, so it is shown
                  before the fields, never after — and a failed read says so instead of reading
                  like an empty brief. */}
              {current.state === "loading" ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Spinner aria-label={`Checking ${PRODUCT_VOCABULARY.canvas} brief`} />
                  Checking this {PRODUCT_VOCABULARY.canvas}&apos;s brief…
                </div>
              ) : current.state === "unreadable" ? (
                <Alert role="alert" variant="destructive">
                  <AlertDescription>{current.message}</AlertDescription>
                </Alert>
              ) : current.brief ? (
                <Alert>
                  <AlertDescription>
                    <span className="font-medium text-foreground">Current brief</span>
                    <span className="mt-1 block">{current.brief}</span>
                    <span className="mt-1 block text-xs">Saving below will replace this text.</span>
                  </AlertDescription>
                </Alert>
              ) : (
                <p className="text-xs text-muted-foreground">{`No brief yet for this ${PRODUCT_VOCABULARY.canvas}.`}</p>
              )}

              <FieldGroup className="gap-4">
                <Field className="gap-1.5">
                  <FieldLabel htmlFor="qb-offer">{`Offer for this ${PRODUCT_VOCABULARY.canvas}`}</FieldLabel>
                  <Input
                    id="qb-offer"
                    type="text"
                    value={offer}
                    onChange={(e) => setOffer(e.target.value.slice(0, MAX_FIELD))}
                    placeholder="e.g. the summer mug collection"
                    disabled={saving}
                  />
                </Field>
                <Field className="gap-1.5">
                  <FieldLabel htmlFor="qb-audience">{`Audience for this ${PRODUCT_VOCABULARY.canvas}`}</FieldLabel>
                  <Input
                    id="qb-audience"
                    type="text"
                    value={audience}
                    onChange={(e) => setAudience(e.target.value.slice(0, MAX_FIELD))}
                    placeholder="e.g. first-time home buyers"
                    disabled={saving}
                  />
                </Field>
                <Field className="gap-1.5">
                  <FieldLabel htmlFor="qb-platform">{`Where this ${PRODUCT_VOCABULARY.canvas} will run`}</FieldLabel>
                  <Input
                    id="qb-platform"
                    type="text"
                    value={platform}
                    onChange={(e) => setPlatform(e.target.value.slice(0, MAX_FIELD))}
                    placeholder="e.g. Instagram, TikTok, LinkedIn"
                    disabled={saving}
                  />
                </Field>
                <Field className="gap-1.5">
                  <FieldLabel htmlFor="qb-budget">{`Budget for this ${PRODUCT_VOCABULARY.canvas}`}</FieldLabel>
                  <Input
                    id="qb-budget"
                    type="text"
                    value={budget}
                    onChange={(e) => setBudget(e.target.value.slice(0, MAX_FIELD))}
                    placeholder="e.g. low-cost DIY, or $500/month"
                    disabled={saving}
                  />
                  <FieldDescription>Optional</FieldDescription>
                </Field>
              </FieldGroup>

              {error && (
                <Alert role="alert" variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={saving}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={saving || !composeBrief({ offer, audience, platform, budget })}
                >
                  {saved ? (
                    <Check data-icon="inline-start" aria-hidden="true" />
                  ) : saving ? (
                    <Spinner data-icon="inline-start" aria-label={`Saving ${PRODUCT_VOCABULARY.canvas} brief`} />
                  ) : null}
                  {saved ? "Saved" : saving ? "Saving…" : "Save brief"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default QuickBrief;
