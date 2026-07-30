"use client";
import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { REFERENCE_FORMATS, type ReferenceFormat } from "@/lib/reference-formats";
import { createEntity } from "@/lib/actions";
import { startRefGen } from "@/lib/refgen-actions";
import { notifyBalanceRefresh } from "@/lib/balance-refresh";
import { displayCredits, pricedRefgenCredits } from "@fikirtive/core/spend";
import { creditsLabel } from "@/lib/credit-format";

type Mode = "upload" | "generate";

// One-line skeleton hint shown under each format card.
const FORMAT_HINT: Record<ReferenceFormat["key"], string> = {
  avatar: "Head-and-shoulders studio portrait",
  "product-shot": "Clean studio product photo",
  location: "Empty wide establishing shot",
  brandmark: "Flat mark on plain white",
};

// Friendly label → EntityType, sourced from REFERENCE_FORMATS so the two
// stay in lockstep (same labels the reference-gen UI shows).
const TYPE_OPTIONS = REFERENCE_FORMATS.map((f) => ({ label: f.label, value: f.entityType }));

/**
 * Add-asset modal. Only the Upload half is wired in this task; the Generate
 * segment is rendered disabled (Task 7 replaces it).
 */
export function AddAssetDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<Mode>("upload");
  const [name, setName] = useState("");
  const [type, setType] = useState<string>(TYPE_OPTIONS[0]?.value ?? "");
  const [files, setFiles] = useState<FileList | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Generate half.
  const [fmtKey, setFmtKey] = useState<ReferenceFormat["key"] | null>(null);
  const [subject, setSubject] = useState("");
  const [notes, setNotes] = useState("");
  const [done, setDone] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const fmt = REFERENCE_FORMATS.find((f) => f.key === fmtKey) ?? null;
  const refgenCostLabel = creditsLabel(displayCredits(pricedRefgenCredits({ model: "seedream", count: 1 })));

  if (!open) return null;

  function reset() {
    setName("");
    setType(TYPE_OPTIONS[0]?.value ?? "");
    setFiles(null);
    setSaving(false);
    setError(null);
    setMode("upload");
    setFmtKey(null);
    setSubject("");
    setNotes("");
    setDone(false);
    setConfirming(false);
  }

  function close() {
    reset();
    onClose();
  }

  async function generate() {
    if (!fmt) return;
    const subj = subject.trim();
    if (!subj) {
      setError("Please describe the subject.");
      return;
    }
    setSaving(true);
    setConfirming(false);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("name", subj.slice(0, 60));
      fd.set("type", fmt.entityType);
      const created = await createEntity(fd); // no files — entity shell
      if (!created || "error" in created) {
        setError((created && "error" in created && created.error) || "Couldn't create the reference. Please try again.");
        setSaving(false);
        return;
      }
      const res = await startRefGen({
        entityId: created.id,
        prompt: fmt.buildPrompt({ subject: subj, notes }),
        count: 1,
        model: "seedream",
        mode: "BASE",
      });
      if ("error" in res) {
        setError(res.error);
        setSaving(false);
        return;
      }
      // A reference generation reserves credits the moment startRefGen accepts — tell the
      // global nav so its credits figure moves with the money (#550). This dialog is the
      // last client-triggered spend path that had no balance-refresh signal at all.
      notifyBalanceRefresh();
      setDone(true);
      setSaving(false);
      onDone();
    } catch {
      setError("Couldn't generate this. Please try again.");
      setSaving(false);
    }
  }

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("name", trimmed);
      fd.set("type", type);
      // acceptRefFiles(formData) reads getAll("files") — use that exact field name.
      if (files) {
        for (const f of Array.from(files)) fd.append("files", f);
      }
      const res = await createEntity(fd);
      if (res && "error" in res && typeof res.error === "string") {
        setError(res.error);
        setSaving(false);
        return;
      }
      reset();
      onDone();
      onClose();
    } catch {
      setError("Couldn't add this. Please try again.");
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Add asset"
      onClick={close}
    >
      <div
        className="w-full max-w-[480px] rounded-[16px] border border-border bg-card p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="m-0 text-[1.125rem] font-semibold text-foreground">Add to Library</h2>
          <button
            type="button"
            aria-label="Close"
            className="text-muted-foreground hover:text-foreground"
            onClick={close}
          >
            ✕
          </button>
        </div>

        {/* Segmented Upload / Generate. */}
        <div className="mb-5 flex gap-1 rounded-[14px] bg-muted p-1">
          <button
            type="button"
            onClick={() => { setMode("upload"); setError(null); setConfirming(false); }}
            className={`flex-1 rounded-[10px] px-3 py-2 text-[0.875rem] font-semibold ${
              mode === "upload" ? "bg-card text-foreground shadow-xs" : "text-muted-foreground"
            }`}
          >
            Upload
          </button>
          <button
            type="button"
            onClick={() => { setMode("generate"); setError(null); setConfirming(false); }}
            className={`flex-1 rounded-[10px] px-3 py-2 text-[0.875rem] font-semibold ${
              mode === "generate" ? "bg-card text-foreground shadow-xs" : "text-muted-foreground"
            }`}
          >
            Generate reference
          </button>
        </div>

        {mode === "upload" && (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[0.75rem] text-muted-foreground">Name *</span>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Rosa"
                autoFocus
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[0.75rem] text-muted-foreground">Type</span>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[0.75rem] text-muted-foreground">Images</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                onChange={(e) => setFiles(e.target.files)}
                className="text-[0.8125rem] text-muted-foreground file:mr-3 file:rounded-[10px] file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-[0.8125rem] file:font-medium file:text-foreground"
              />
            </label>

            {error && (
              <div role="alert" className="text-[0.8125rem] text-[var(--error-soft-foreground)]">
                {error}
              </div>
            )}

            <div className="mt-1 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={close} disabled={saving}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => void submit()} disabled={saving || !name.trim()}>
                {saving ? "Adding…" : "Add"}
              </Button>
            </div>
          </div>
        )}

        {mode === "generate" && (
          done ? (
            <div className="flex flex-col gap-4">
              <p className="text-[0.875rem] leading-[1.45] text-foreground">
                Generating — it will appear in Library shortly.
              </p>
              <div className="flex justify-end">
                <Button size="sm" onClick={close}>Done</Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {/* Format picker */}
              <div className="grid grid-cols-2 gap-2">
                {REFERENCE_FORMATS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => { setFmtKey(f.key); setConfirming(false); setError(null); }}
                    className={`rounded-[12px] border p-3 text-left transition ${
                      fmtKey === f.key ? "border-brand bg-brand/5" : "border-border hover:border-foreground/30"
                    }`}
                  >
                    <div className="text-[0.875rem] font-semibold text-foreground">{f.label}</div>
                    <div className="mt-0.5 text-[0.75rem] leading-[1.35] text-muted-foreground">{FORMAT_HINT[f.key]}</div>
                  </button>
                ))}
              </div>

              {fmt && (
                <>
                  <label className="flex flex-col gap-1">
                    <span className="text-[0.75rem] text-muted-foreground">{fmt.subjectLabel} *</span>
                    <Input
                      value={subject}
                      onChange={(e) => { setSubject(e.target.value); setConfirming(false); }}
                      placeholder={fmt.subjectPlaceholder}
                      autoFocus
                    />
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="text-[0.75rem] text-muted-foreground">Notes (optional)</span>
                    <Textarea
                      value={notes}
                      onChange={(e) => { setNotes(e.target.value); setConfirming(false); }}
                      rows={2}
                      placeholder="Anything to add — colors, mood, angle…"
                    />
                  </label>
                </>
              )}

              {error && (
                <div role="alert" className="text-[0.8125rem] text-[var(--error-soft-foreground)]">
                  {error}
                </div>
              )}

              <p className="text-[0.75rem] text-muted-foreground/70">
                Generates 1 reference image. Cost: {refgenCostLabel}.
              </p>

              {confirming && (
                <div className="rounded-[12px] border border-border bg-muted/40 p-3 text-[0.8125rem] text-muted-foreground">
                  Confirm reference generation for {refgenCostLabel}. No charge until you confirm.
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={close} disabled={saving}>
                  Cancel
                </Button>
                {confirming ? (
                  <Button size="sm" onClick={() => void generate()} disabled={saving || !fmt || !subject.trim()}>
                    {saving ? "Generating…" : `Confirm generate · ${refgenCostLabel}`}
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => setConfirming(true)} disabled={saving || !fmt || !subject.trim()}>
                    Review cost · {refgenCostLabel}
                  </Button>
                )}
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}
