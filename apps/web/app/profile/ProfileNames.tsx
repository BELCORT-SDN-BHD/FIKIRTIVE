"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateDisplayName, updateWorkspaceName } from "@/lib/profile-actions";

type SaveResult = { ok: true; name: string } | { error: string };

/** Convenience cap only — mirrors the signup form's shop-name input. The server action holds
 *  the authoritative cap and echoes back what it actually stored, so this can never be the
 *  thing that decides what lands in the database. */
const MAX_NAME_LENGTH = 80;

/**
 * #542 — one editable name with an EXPLICIT Save button, the same shape #516 settled on for
 * the spend cap: nothing is written on blur or on keystroke, Save stays disabled until the
 * value actually changed and is non-empty, and the field always ends up showing the
 * server-confirmed value (the action returns the trimmed/capped string it really stored).
 *
 * The actions are imported here rather than passed down as props: identity is resolved
 * server-side from the session, so this component has no id to hand them and cannot be
 * pointed at anybody else's row.
 */
function NameField({
  label,
  hint,
  initialValue,
  placeholder,
  autoComplete,
  onSave,
}: {
  label: string;
  hint: string;
  initialValue: string;
  placeholder: string;
  autoComplete: string;
  onSave: (value: string) => Promise<SaveResult>;
}) {
  const [saved, setSaved] = useState(initialValue);
  const [draft, setDraft] = useState(initialValue);
  const [status, setStatus] = useState<"saving" | "saved" | "error" | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const trimmed = draft.trim();
  const dirty = trimmed !== saved.trim();
  const valid = trimmed.length > 0;
  const inputId = `profile-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!dirty || !valid || status === "saving") return;
    setStatus("saving");
    setErrorMsg(null);
    try {
      const result = await onSave(draft);
      if ("error" in result) {
        setStatus("error");
        setErrorMsg(result.error);
        return;
      }
      // Echo back exactly what was stored — the action trims and caps the value, so the
      // field must never keep showing something the database does not have.
      setSaved(result.name);
      setDraft(result.name);
      setStatus("saved");
    } catch {
      setStatus("error");
      setErrorMsg("Could not save. Try again.");
    }
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label htmlFor={inputId} className="text-muted-foreground" style={{ fontSize: 13 }}>
        {label}
      </label>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <Input
          id={inputId}
          value={draft}
          maxLength={MAX_NAME_LENGTH}
          placeholder={placeholder}
          autoComplete={autoComplete}
          aria-invalid={status === "error" ? true : undefined}
          onChange={(event) => {
            setDraft(event.target.value);
            setStatus(null);
            setErrorMsg(null);
          }}
        />
        <Button type="submit" variant="secondary" disabled={!dirty || !valid || status === "saving"}>
          {status === "saving" ? "Saving…" : "Save"}
        </Button>
      </div>
      {status === "error" ? (
        <span role="status" aria-live="polite" className="text-destructive" style={{ fontSize: 12.5 }}>
          {errorMsg ?? "Could not save. Try again."}
        </span>
      ) : status === "saved" ? (
        <span role="status" aria-live="polite" style={{ fontSize: 12.5, color: "#15803D" }}>
          Saved
        </span>
      ) : (
        <span className="text-muted-foreground" style={{ fontSize: 12.5 }}>
          {hint}
        </span>
      )}
    </form>
  );
}

export function ProfileNames({ displayName, workspaceName }: { displayName: string; workspaceName: string }) {
  return (
    <>
      <NameField
        label="Your name"
        hint="How Otto greets you."
        initialValue={displayName}
        placeholder="Your name"
        autoComplete="name"
        onSave={updateDisplayName}
      />
      {/* #680 — when the merchant has never been asked for a shop name (magic-link and invite
          sign-ins never ask), this field is EMPTY and the placeholder asks for it. It used to
          arrive pre-filled with their email address, which read as an answer they had given. */}
      <NameField
        label="Workspace"
        hint="Your shop name — shown across Fikirtive."
        initialValue={workspaceName}
        placeholder="Set your shop name"
        autoComplete="organization"
        onSave={updateWorkspaceName}
      />
    </>
  );
}
