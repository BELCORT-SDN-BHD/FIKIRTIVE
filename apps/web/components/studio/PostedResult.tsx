"use client";
import { useState } from "react";
import { recordGenerationOutcome } from "@/lib/actions";

export function PostedResult({ generationId, recorded = false }: { generationId: string; recorded?: boolean }) {
  // `recorded` (server-known) seeds the "logged" state so an already-answered result
  // doesn't re-prompt — and re-append a conflicting outcome — on reload or revisit.
  const [done, setDone] = useState(recorded);
  const [result, setResult] = useState("");
  const [err, setErr] = useState<string | null>(null);

  // The action returns { error } on a rejected write rather than throwing — so we
  // only confirm "logged" when it actually succeeded, else keep the buttons for retry.
  async function submit(posted: boolean) {
    setErr(null);
    const r = await recordGenerationOutcome(generationId, posted, result);
    if (r && "error" in r) setErr(r.error);
    else setDone(true);
  }

  if (done) {
    return (
      <p style={{ font: "var(--text-small)", color: "var(--fg-3)", margin: "6px 0 0" }}>
        Thanks — logged.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, margin: "8px 0 0" }}>
      <input
        value={result}
        maxLength={280}
        onChange={(e) => setResult(e.target.value)}
        placeholder="Did it sell? e.g. 'more orders than usual'"
        style={{
          font: "var(--text-small)",
          color: "var(--fg-1)",
          background: "var(--surface-2)",
          border: "1px solid var(--border-1)",
          borderRadius: 6,
          padding: "5px 8px",
          width: "100%",
          boxSizing: "border-box",
          outline: "none",
        }}
      />
      <div style={{ display: "flex", gap: 6 }}>
        <button
          type="button"
          className="al-btn al-btn-sm al-btn-glass"
          onClick={() => submit(true)}
        >
          I posted this
        </button>
        <button
          type="button"
          className="al-btn al-btn-sm al-btn-ghost"
          onClick={() => submit(false)}
        >
          Didn&apos;t post
        </button>
      </div>
      {err && (
        <p style={{ font: "var(--text-small)", color: "var(--danger, #c0392b)", margin: 0 }}>
          {err} — try again.
        </p>
      )}
    </div>
  );
}
