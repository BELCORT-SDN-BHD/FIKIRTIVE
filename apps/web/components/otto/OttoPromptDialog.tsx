"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { OttoAvatar, type OttoMood } from "./OttoAvatar";

export function OttoConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  impacts = [],
  confirmText,
  confirmPlaceholder,
  confirmLabel = "Confirm",
  confirmingLabel = "Working...",
  cancelLabel = "Cancel",
  tone = "default",
  mood = tone === "danger" ? "warning" : "helpful",
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  impacts?: string[];
  confirmText?: string;
  confirmPlaceholder?: string;
  confirmLabel?: string;
  confirmingLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  mood?: OttoMood;
  onConfirm: () => void | Promise<void>;
}) {
  const [typed, setTyped] = React.useState("");
  const [pending, setPending] = React.useState(false);

  const canConfirm = !confirmText || typed.trim() === confirmText;

  function changeOpen(next: boolean) {
    if (pending) return;
    if (!next) setTyped("");
    onOpenChange(next);
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canConfirm || pending) return;
    setPending(true);
    try {
      await onConfirm();
      setTyped("");
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="gap-5">
        <form onSubmit={submit} className="flex flex-col gap-5">
          <DialogHeader className="pr-8">
            <div className="mb-1 flex items-center gap-3">
              <span className="flex size-12 items-center justify-center rounded-[16px] bg-brand-soft">
                <OttoAvatar size={34} mood={mood} />
              </span>
              <DialogTitle>{title}</DialogTitle>
            </div>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          {impacts.length > 0 && (
            <div className="rounded-[16px] border border-border bg-secondary/70 p-3.5">
              <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                What happens
              </div>
              <ul className="space-y-1.5 text-sm text-foreground">
                {impacts.map((impact) => (
                  <li key={impact} className="flex gap-2">
                    <span className="mt-[0.42em] size-1.5 shrink-0 rounded-full bg-muted-foreground/55" />
                    <span>{impact}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {confirmText && (
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-foreground">
                Type <span className="font-semibold">{confirmText}</span> to continue
              </span>
              <Input
                autoFocus
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={confirmPlaceholder ?? confirmText}
                aria-label={`Type ${confirmText} to confirm`}
              />
            </label>
          )}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => changeOpen(false)} disabled={pending}>
              {cancelLabel}
            </Button>
            <Button type="submit" variant={tone === "danger" ? "destructive" : "default"} disabled={!canConfirm || pending}>
              {pending ? confirmingLabel : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function OttoRenameDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  initialValue,
  submitLabel = "Save",
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  label: string;
  initialValue: string;
  submitLabel?: string;
  onSubmit: (value: string) => void | Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5">
        <OttoRenameDialogForm
          key={open ? initialValue : "closed"}
          title={title}
          description={description}
          label={label}
          initialValue={initialValue}
          submitLabel={submitLabel}
          onOpenChange={onOpenChange}
          onSubmit={onSubmit}
        />
      </DialogContent>
    </Dialog>
  );
}

function OttoRenameDialogForm({
  title,
  description,
  label,
  initialValue,
  submitLabel,
  onOpenChange,
  onSubmit,
}: {
  title: string;
  description?: string;
  label: string;
  initialValue: string;
  submitLabel: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (value: string) => void | Promise<void>;
}) {
  const [value, setValue] = React.useState(initialValue);
  const [pending, setPending] = React.useState(false);

  const clean = value.trim();
  const canSubmit = clean.length > 0 && clean !== initialValue.trim();

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit || pending) return;
    setPending(true);
    try {
      await onSubmit(clean);
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <DialogHeader className="pr-8">
        <div className="mb-1 flex items-center gap-3">
          <span className="flex size-12 items-center justify-center rounded-[16px] bg-brand-soft">
            <OttoAvatar size={34} mood="helpful" />
          </span>
          <DialogTitle>{title}</DialogTitle>
        </div>
        {description ? <DialogDescription>{description}</DialogDescription> : null}
      </DialogHeader>

      <label className="flex flex-col gap-2">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <Input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label={label}
          maxLength={80}
        />
      </label>

      <DialogFooter>
        <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canSubmit || pending}>
          {pending ? "Saving..." : submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
