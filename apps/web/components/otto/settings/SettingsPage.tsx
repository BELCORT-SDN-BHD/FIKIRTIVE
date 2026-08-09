"use client";
import { useEffect, useRef, useState } from "react";
import type { SettingsSection, SettingsField } from "./types";
import { Switch } from "./Switch";

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

  async function commit(value: number) {
    if (clearStatusTimer.current) clearTimeout(clearStatusTimer.current);
    setStatus("saving");
    setErrorMsg(null);
    try {
      const result = await field.onSave(value);
      if (result && typeof result === "object" && "error" in result) {
        setStatus("error");
        setErrorMsg(typeof result.error === "string" ? result.error : null);
        return;
      }
      setSavedValue(value);
      setDraft(String(value));
      setEditing(value !== 0);
      setConfirmRemove(false);
      setStatus("saved");
      clearStatusTimer.current = setTimeout(() => setStatus(null), 2000);
    } catch {
      setStatus("error");
    }
  }

  // Saved state IS "no cap" — echo "No cap set", never a bare 0 input.
  if (!editing && savedValue === 0) {
    return (
      <span className="cv-set-num">
        <strong>No cap set</strong>
        <button
          type="button"
          className="cv-set-btn"
          onClick={() => { setDraft(""); setEditing(true); setStatus(null); }}
        >
          Set a cap
        </button>
      </span>
    );
  }

  // "Remove cap" is its own action with its own confirmation — never a silent side
  // effect of typing 0 and blurring.
  if (confirmRemove) {
    return (
      <span className="cv-set-num cv-set-num-confirm">
        <span className="text-error">Remove the spend cap? There will be no budget target set.</span>
        <button type="button" className="cv-set-btn danger" disabled={status === "saving"} onClick={() => void commit(0)}>
          {status === "saving" ? "Removing…" : "Remove cap"}
        </button>
        <button type="button" className="cv-set-btn" disabled={status === "saving"} onClick={() => setConfirmRemove(false)}>
          Cancel
        </button>
      </span>
    );
  }

  const parsed = parseWholeCredits(draft);
  const isValid = parsed !== null;
  const dirty = draft.trim() !== String(savedValue);
  const removesCap = isValid && parsed === 0;

  return (
    <span className="cv-set-num">
      <input
        className="cv-set-input cv-set-input-num"
        type="number"
        min={0}
        step={1}
        value={draft}
        aria-label={field.label}
        onChange={(event) => setDraft(event.target.value)}
      />
      {field.unit ? <em>{field.unit}</em> : null}
      <button
        type="button"
        className="cv-set-btn"
        disabled={!dirty || !isValid || status === "saving"}
        onClick={() => {
          if (removesCap) { setConfirmRemove(true); return; }
          void commit(parsed as number);
        }}
      >
        {status === "saving" ? "Saving…" : removesCap ? "Remove cap" : "Save"}
      </button>
      {dirty && !isValid ? (
        <span className="text-error">Whole numbers only, 0 or more.</span>
      ) : status === "saved" ? (
        <span role="status" aria-live="polite" className="text-success">Saved</span>
      ) : status === "error" ? (
        <span role="status" aria-live="polite" className="text-error">{errorMsg ?? "Could not save"}</span>
      ) : null}
    </span>
  );
}

function FieldRow({ f }: { f: SettingsField }) {
  if (f.kind === "custom") return <div className="cv-set-row">{f.render()}</div>;
  return (
    <div className="cv-set-row">
      <div className="cv-set-lbl"><span>{f.label}</span>{"hint" in f && f.hint ? <span className="cv-set-hint">{f.hint}</span> : null}</div>
      {f.kind === "text" && <input className="cv-set-input" aria-label={f.label} defaultValue={f.value} readOnly={f.readOnly} />}
      {f.kind === "toggle" && <Switch checked={f.value} onChange={f.onToggle} disabled={f.disabled} aria-label={f.label} />}
      {f.kind === "number" && <NumberField field={f} />}
      {f.kind === "action" && <button className={f.tone === "danger" ? "cv-set-btn danger" : "cv-set-btn"} onClick={f.onClick}>{f.button}</button>}
    </div>
  );
}

export function SettingsPage({ sections }: { sections: SettingsSection[] }) {
  const [active, setActive] = useState(sections[0]?.id);
  return (
    <div className="cv-settings">
      <nav className="cv-settings-nav">
        <h1>Settings</h1>
        {sections.map((s) => (
          <a key={s.id} href={`#sec-${s.id}`} className={s.id === active ? "on" + (s.danger ? " danger" : "") : (s.danger ? "danger" : "")}
            onClick={() => setActive(s.id)}>{s.title}</a>
        ))}
      </nav>
      <div className="cv-settings-body">
        {sections.map((s) => (
          <section key={s.id} id={`sec-${s.id}`} className="cv-set-sec">
            <h2>{s.title}</h2>{s.subtitle ? <p className="cv-set-sub">{s.subtitle}</p> : null}
            <div className={s.danger ? "cv-set-card danger" : "cv-set-card"}>{s.fields.map((f) => <FieldRow key={f.id} f={f} />)}</div>
          </section>
        ))}
      </div>
    </div>
  );
}
