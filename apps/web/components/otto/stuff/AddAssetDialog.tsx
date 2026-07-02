"use client";
import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { REFERENCE_FORMATS } from "@/lib/reference-formats";
import { createEntity } from "@/lib/actions";

type Mode = "upload" | "generate";

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
  const [mode] = useState<Mode>("upload");
  const [name, setName] = useState("");
  const [type, setType] = useState<string>(TYPE_OPTIONS[0]?.value ?? "");
  const [files, setFiles] = useState<FileList | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  function reset() {
    setName("");
    setType(TYPE_OPTIONS[0]?.value ?? "");
    setFiles(null);
    setError(null);
  }

  function close() {
    reset();
    onClose();
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
          <h2 className="m-0 text-[1.125rem] font-semibold text-foreground">Add to My Stuff</h2>
          <button
            type="button"
            aria-label="Close"
            className="text-muted-foreground hover:text-foreground"
            onClick={close}
          >
            ✕
          </button>
        </div>

        {/* Segmented Upload / Generate. Generate disabled until Task 7. */}
        <div className="mb-5 flex gap-1 rounded-[14px] bg-muted p-1">
          <button
            type="button"
            className={`flex-1 rounded-[10px] px-3 py-2 text-[0.875rem] font-semibold ${
              mode === "upload" ? "bg-card text-foreground shadow-xs" : "text-muted-foreground"
            }`}
          >
            Upload
          </button>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  disabled
                  aria-disabled="true"
                  className="flex-1 cursor-not-allowed rounded-[10px] px-3 py-2 text-[0.875rem] font-semibold text-muted-foreground/60"
                >
                  Generate reference
                </button>
              </TooltipTrigger>
              <TooltipContent>Coming in the next step</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

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
      </div>
    </div>
  );
}
