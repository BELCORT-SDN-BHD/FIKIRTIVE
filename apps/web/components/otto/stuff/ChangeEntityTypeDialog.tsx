"use client";
/**
 * Change type — the missing correction (beta bug 4).
 *
 * A Library element's kind was frozen at creation. The beta recording caught what that costs: a
 * bottle saved as a person is described to the engine as a person in every generation that mentions
 * it, and the merchant's only exit was deleting the element — and its reference photos with it.
 *
 * The kind is not cosmetic, so this control does not pretend it is. Two things are said out loud
 * before saving: past work is not redone, and switching TO Cast brings the reference-photo rule with
 * it (a character with no reference photo is refused before a generation spends anything).
 */
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { EntityTypeDTO } from "@/lib/types";

/** Merchant-facing name for each kind. "Cast" matches the Library filter pill and the tile tag —
 *  the merchant never sees the enum, so the two places that name a kind must agree. */
const TYPE_LABELS: { value: EntityTypeDTO; label: string; hint: string }[] = [
  { value: "CHARACTER", label: "Cast", hint: "A person" },
  { value: "PRODUCT", label: "Product", hint: "Something you sell" },
  { value: "LOCATION", label: "Location", hint: "A place" },
  { value: "BRANDMARK", label: "Brand mark", hint: "A logo or mark" },
];

export function ChangeEntityTypeDialog({
  open,
  onOpenChange,
  itemLabel,
  currentType,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemLabel: string;
  currentType: EntityTypeDTO;
  /** Resolves to an error message to show inline, or null on success. The in-flight guard lives in
   *  the action, so its refusal has to reach this dialog rather than disappearing. */
  onSubmit: (type: EntityTypeDTO) => Promise<string | null>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5">
        <ChangeEntityTypeForm
          key={open ? `${itemLabel}:${currentType}` : "closed"}
          itemLabel={itemLabel}
          currentType={currentType}
          onOpenChange={onOpenChange}
          onSubmit={onSubmit}
        />
      </DialogContent>
    </Dialog>
  );
}

function ChangeEntityTypeForm({
  itemLabel,
  currentType,
  onOpenChange,
  onSubmit,
}: {
  itemLabel: string;
  currentType: EntityTypeDTO;
  onOpenChange: (open: boolean) => void;
  onSubmit: (type: EntityTypeDTO) => Promise<string | null>;
}) {
  const [value, setValue] = React.useState<EntityTypeDTO>(currentType);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const changed = value !== currentType;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!changed || pending) return;
    setPending(true);
    setError(null);
    try {
      const failure = await onSubmit(value);
      if (failure) {
        setError(failure);
        return;
      }
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <DialogHeader className="pr-8">
        <DialogTitle>Change type</DialogTitle>
        <DialogDescription>
          What kind of thing is “{itemLabel}”? Otto describes it to the engine this way every time
          you mention it.
        </DialogDescription>
      </DialogHeader>

      <label className="flex flex-col gap-2">
        <span className="text-sm font-medium text-foreground">Type</span>
        <Select value={value} onValueChange={(next) => { setValue(next as EntityTypeDTO); setError(null); }}>
          <SelectTrigger className="w-full" aria-label="Type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TYPE_LABELS.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label} — {t.hint}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      {value === "CHARACTER" && currentType !== "CHARACTER" && (
        <p className="m-0 text-[0.8125rem] text-muted-foreground">
          Cast needs a reference photo — a character without one is refused before a generation
          starts, so add a photo to this item if it has none.
        </p>
      )}

      <p className="m-0 text-[0.8125rem] text-muted-foreground">
        Anything you already made keeps the wording it was made with. This changes the next
        generation.
      </p>

      {error && (
        <div role="alert" className="rounded-[14px] bg-error-soft px-3 py-2 text-[0.8125rem] text-[var(--error-soft-foreground)]">
          {error}
        </div>
      )}

      <DialogFooter>
        <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={!changed || pending}>
          {pending ? "Saving..." : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
}
