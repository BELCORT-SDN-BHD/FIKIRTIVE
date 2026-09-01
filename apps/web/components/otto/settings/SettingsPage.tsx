"use client";
import { Fragment, useEffect, useRef, useState } from "react";
import type { SettingsSection, SettingsField } from "./types";
import { Switch } from "./Switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldTitle,
} from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";

type NumberFieldData = Extract<SettingsField, { kind: "number" }>;

/** Parse a draft number-field string into either a valid non-negative whole number, or
 *  null. Empty, negative, and non-integer input are ALL invalid — none of them silently
 *  coerce to 0 or anything else; the caller must simply refuse to save. Exported for unit
 *  testing without needing a DOM (decision ①, issue #513 §C1 — the P1 fix: clearing the
 *  spend cap must never quietly grant an unlimited cap). */
export function parseWholeCredits(draft: string): number | null {
  const trimmed = draft.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && Number.isInteger(n) && n >= 0 ? n : null;
}

/** A saved-then-editable whole-number field with an explicit Save action (decision ①):
 *  - Empty / negative / non-integer input is NEVER saved (Save stays disabled).
 *  - 0 always means "no cap" and always renders as "No cap set", never a bare 0 —
 *    and setting it requires its own two-step confirmation ("Remove cap" → "Confirm"),
 *    never a side-effect of clearing the box.
 *  - A save always echoes back the server-confirmed final value once it resolves. */
function NumberField({ field }: { field: NumberFieldData }) {
  const [status, setStatus] = useState<"saving" | "saved" | "error" | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [savedValue, setSavedValue] = useState(field.value);
  const [editing, setEditing] = useState(field.value !== 0);
  const [draft, setDraft] = useState(String(field.value));
  const [confirmRemove, setConfirmRemove] = useState(false);
  const clearStatusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const removingRef = useRef(false);
  const [lastPropValue, setLastPropValue] = useState(field.value);

  // Re-sync from the server-confirmed value the moment the prop actually changes (e.g.
  // the parent re-rendered with fresh settings after some other field's revalidatePath) —
  // never trust stale local draft state over what was actually persisted. Adjusted during
  // render (React's documented pattern for "reset state when a prop changes"), not inside
  // an effect, so this never causes an extra render-then-effect round trip.
  if (field.value !== lastPropValue) {
    setLastPropValue(field.value);
    setSavedValue(field.value);
    setDraft(String(field.value));
    setEditing(field.value !== 0);
    setConfirmRemove(false);
  }

  useEffect(() => () => {
    if (clearStatusTimer.current) clearTimeout(clearStatusTimer.current);
  }, []);

  async function commit(value: number): Promise<string | null> {
    if (savingRef.current) return null;
    savingRef.current = true;
    if (clearStatusTimer.current) clearTimeout(clearStatusTimer.current);
    setStatus("saving");
    setErrorMsg(null);
    try {
      const result = await field.onSave(value);
      if (result && typeof result === "object" && "error" in result) {
        setStatus("error");
        const message = typeof result.error === "string" ? result.error : "Could not save";
        setErrorMsg(message);
        return message;
      }
      setSavedValue(value);
      setDraft(String(value));
      setEditing(value !== 0);
      setStatus("saved");
      clearStatusTimer.current = setTimeout(() => setStatus(null), 2000);
      return null;
    } catch {
      setStatus("error");
      setErrorMsg("Could not save. Check your connection and try again.");
      return "Could not save. Check your connection and try again.";
    } finally {
      savingRef.current = false;
    }
  }

  async function removeCap() {
    if (removingRef.current) return;
    removingRef.current = true;
    try {
      const failure = await commit(0);
      if (!failure) setConfirmRemove(false);
    } finally {
      removingRef.current = false;
    }
  }

  // Saved state IS "no cap" — echo "No cap set", never a bare 0 input.
  if (!editing && savedValue === 0) {
    return (
      <Field orientation="responsive">
        <FieldContent>
          <FieldTitle>{field.label}</FieldTitle>
          {field.hint ? <FieldDescription>{field.hint}</FieldDescription> : null}
        </FieldContent>
        <div className="flex items-center gap-2">
          <Badge variant="outline">No cap set</Badge>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => { setDraft(""); setEditing(true); setStatus(null); }}
          >
            Set a cap
          </Button>
        </div>
      </Field>
    );
  }

  const parsed = parseWholeCredits(draft);
  const isValid = parsed !== null;
  const dirty = draft.trim() !== String(savedValue);
  const removesCap = isValid && parsed === 0;
  const invalid = dirty && !isValid;

  return (
    <>
      <Field orientation="responsive" data-invalid={invalid || undefined}>
      <FieldContent>
        <FieldTitle>{field.label}</FieldTitle>
        {field.hint ? <FieldDescription>{field.hint}</FieldDescription> : null}
      </FieldContent>
      <div className="flex w-full max-w-md flex-col gap-2">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Input
            className="w-28 font-mono tabular-nums"
            type="number"
            min={0}
            step={1}
            value={draft}
            aria-label={field.label}
            aria-invalid={invalid || undefined}
            onChange={(event) => {
              setDraft(event.target.value);
              if (status === "error") {
                setStatus(null);
                setErrorMsg(null);
              }
            }}
          />
          {field.unit ? <span className="text-sm text-muted-foreground">{field.unit}</span> : null}
          <Button
            type="button"
            size="sm"
            disabled={!dirty || !isValid || status === "saving"}
            variant={removesCap ? "destructive-secondary" : "default"}
            onClick={() => {
              if (removesCap) {
                setStatus(null);
                setErrorMsg(null);
                setConfirmRemove(true);
                return;
              }
              void commit(parsed as number);
            }}
          >
            {status === "saving" ? <Spinner data-icon="inline-start" /> : null}
            {status === "saving" ? "Saving…" : removesCap ? "Remove cap" : "Save"}
          </Button>
        </div>
        {invalid ? (
          <FieldError>Whole numbers only, 0 or more.</FieldError>
        ) : status === "saved" ? (
          <Badge role="status" aria-live="polite" variant="success">Saved</Badge>
        ) : status === "error" ? (
          <FieldError role="status" aria-live="polite">{errorMsg ?? "Could not save"}</FieldError>
        ) : null}
      </div>
      </Field>

      <AlertDialog
        open={confirmRemove}
        onOpenChange={(open) => {
          if (!open && status !== "saving") {
            setConfirmRemove(false);
            setStatus(null);
            setErrorMsg(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Otto&apos;s spend cap?</AlertDialogTitle>
            <AlertDialogDescription>
              Actions above {savedValue.toLocaleString()} credits are currently refused before charging.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Alert variant="warning">
            <AlertTitle>This removes a spending guard</AlertTitle>
            <AlertDescription>
              Otto will no longer refuse an action just because it costs more than this cap. Your credit balance and each action&apos;s price still apply.
            </AlertDescription>
          </Alert>
          {status === "error" ? (
            <Alert variant="destructive" density="compact" role="alert">
              <AlertTitle>Cap wasn&apos;t removed</AlertTitle>
              <AlertDescription>{errorMsg ?? "Could not save"}</AlertDescription>
            </Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={status === "saving"}>Keep cap</AlertDialogCancel>
            <Button type="button" variant="destructive-secondary" disabled={status === "saving"} onClick={() => void removeCap()}>
              {status === "saving" ? <Spinner data-icon="inline-start" /> : null}
              {status === "saving" ? "Removing…" : "Remove cap"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function FieldRow({ f }: { f: SettingsField }) {
  if (f.kind === "custom") return <Field orientation="responsive">{f.render()}</Field>;
  if (f.kind === "number") return <NumberField field={f} />;
  return (
    <Field orientation="responsive" data-disabled={(f.kind === "toggle" && f.disabled) || undefined}>
      <FieldContent>
        <FieldTitle>{f.label}</FieldTitle>
        {"hint" in f && f.hint ? <FieldDescription>{f.hint}</FieldDescription> : null}
      </FieldContent>
      {f.kind === "text" && <Input className="w-full md:max-w-xs" aria-label={f.label} defaultValue={f.value} readOnly={f.readOnly} />}
      {f.kind === "toggle" && <Switch checked={f.value} onChange={f.onToggle} disabled={f.disabled} aria-label={f.label} />}
      {f.kind === "action" && (
        <Button type="button" size="sm" variant={f.tone === "danger" ? "destructive" : "outline"} onClick={f.onClick}>
          {f.button}
        </Button>
      )}
    </Field>
  );
}

export function SettingsPage({ sections }: { sections: SettingsSection[] }) {
  const [active, setActive] = useState(sections[0]?.id);
  return (
    <div className="min-h-dvh w-full overflow-auto px-5 py-8 sm:px-8 sm:py-10">
      <div className="mx-auto grid w-full max-w-7xl gap-10 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside>
          <div className="flex flex-col gap-5 lg:sticky lg:top-8">
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
              <p className="text-sm text-muted-foreground">Workspace controls and defaults.</p>
            </div>
            <nav aria-label="Settings sections" className="flex gap-1 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
              {sections.map((section) => (
                <Button
                  key={section.id}
                  asChild
                  size="sm"
                  variant={section.id === active ? "secondary" : "ghost"}
                  className="shrink-0 justify-start lg:w-full"
                >
                  <a href={`#sec-${section.id}`} onClick={() => setActive(section.id)}>{section.title}</a>
                </Button>
              ))}
            </nav>
          </div>
        </aside>

        <div className="flex min-w-0 max-w-4xl flex-col gap-8">
          <header className="flex max-w-2xl flex-col gap-2">
            <Badge variant="outline">Workspace controls</Badge>
            <h2 className="text-3xl font-semibold tracking-tight">Preferences</h2>
            <p className="text-base text-muted-foreground">
              Decide how Otto acts, where content connects, and what requires your approval.
            </p>
          </header>

          {sections.map((section) => (
            <section key={section.id} id={`sec-${section.id}`} className="scroll-mt-8">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle><h3>{section.title}</h3></CardTitle>
                    {section.danger ? <Badge variant="destructive">Sensitive</Badge> : null}
                  </div>
                  {section.subtitle ? <CardDescription>{section.subtitle}</CardDescription> : null}
                </CardHeader>
                <CardContent>
                  <FieldGroup className="gap-0">
                    {section.fields.map((field, index) => (
                      <Fragment key={field.id}>
                        {index > 0 ? <Separator className="my-5" /> : null}
                        <FieldRow f={field} />
                      </Fragment>
                    ))}
                  </FieldGroup>
                </CardContent>
              </Card>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
