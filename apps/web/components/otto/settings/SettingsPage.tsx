"use client";
import { useEffect, useRef, useState } from "react";
import type { SettingsSection, SettingsField } from "./types";
import { Switch } from "./Switch";

type NumberFieldData = Extract<SettingsField, { kind: "number" }>;

function NumberField({ field }: { field: NumberFieldData }) {
  const [status, setStatus] = useState<"saving" | "saved" | "error" | null>(null);
  const clearStatusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (clearStatusTimer.current) clearTimeout(clearStatusTimer.current);
  }, []);

  async function save(value: number) {
    if (clearStatusTimer.current) clearTimeout(clearStatusTimer.current);
    setStatus("saving");
    try {
      const result = await field.onSave(value);
      if (result && typeof result === "object" && "error" in result) {
        setStatus("error");
        return;
      }
      setStatus("saved");
      clearStatusTimer.current = setTimeout(() => setStatus(null), 2000);
    } catch {
      setStatus("error");
    }
  }

  return (
    <span className="cv-set-num">
      <input
        className="cv-set-input cv-set-input-num"
        type="number"
        defaultValue={field.value}
        onBlur={(event) => void save(Number(event.target.value))}
      />
      {field.unit ? <em>{field.unit}</em> : null}
      {status ? (
        <span
          role="status"
          aria-live="polite"
          className={status === "saved" ? "text-success" : status === "error" ? "text-error" : "text-muted-foreground"}
        >
          {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : "Could not save"}
        </span>
      ) : null}
    </span>
  );
}

function FieldRow({ f }: { f: SettingsField }) {
  if (f.kind === "custom") return <div className="cv-set-row">{f.render()}</div>;
  return (
    <div className="cv-set-row">
      <div className="cv-set-lbl"><span>{f.label}</span>{"hint" in f && f.hint ? <span className="cv-set-hint">{f.hint}</span> : null}</div>
      {f.kind === "text" && <input className="cv-set-input" defaultValue={f.value} readOnly={f.readOnly} />}
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
