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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldTitle } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
  const [pending, setPending] = React.useState(false);

  function handleOpenChange(next: boolean) {
    if (!next && pending) return;
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="gap-5 sm:max-w-[520px]"
        closeDisabled={pending}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <ChangeEntityTypeForm
          key={open ? `${itemLabel}:${currentType}` : "closed"}
          itemLabel={itemLabel}
          currentType={currentType}
          onOpenChange={onOpenChange}
          onSubmit={onSubmit}
          pending={pending}
          setPending={setPending}
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
  pending,
  setPending,
}: {
  itemLabel: string;
  currentType: EntityTypeDTO;
  onOpenChange: (open: boolean) => void;
  onSubmit: (type: EntityTypeDTO) => Promise<string | null>;
  pending: boolean;
  setPending: (pending: boolean) => void;
}) {
  const [value, setValue] = React.useState<EntityTypeDTO>(currentType);
  const [error, setError] = React.useState<string | null>(null);
  const submittingRef = React.useRef(false);

  const changed = value !== currentType;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!changed || submittingRef.current) return;
    submittingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const failure = await onSubmit(value);
      if (failure) {
        setError(failure);
        return;
      }
      onOpenChange(false);
    } catch {
      setError("The type couldn't be changed. Check your connection and try again.");
    } finally {
      submittingRef.current = false;
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

      <FieldGroup className="gap-4">
        <Field data-disabled={pending}>
          <FieldTitle id="entity-type-label">Type</FieldTitle>
          <ToggleGroup
            type="single"
            value={value}
            variant="outline"
            spacing={2}
            disabled={pending}
            aria-labelledby="entity-type-label"
            onValueChange={(next) => {
              if (!next) return;
              setValue(next as EntityTypeDTO);
              setError(null);
            }}
            className="grid w-full grid-cols-2"
          >
            {TYPE_LABELS.map((type) => (
              <ToggleGroupItem
                key={type.value}
                value={type.value}
                className="h-auto min-h-16 w-full flex-col items-start justify-start whitespace-normal px-3 py-2.5 text-left"
              >
                <span className="font-semibold">{type.label}</span>
                <span className="text-xs font-normal leading-snug text-muted-foreground">
                  {type.hint}
                </span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>

        {value === "CHARACTER" && currentType !== "CHARACTER" && (
          <Alert variant="warning" density="compact">
            <AlertTitle>Cast needs a reference photo</AlertTitle>
            <AlertDescription>
              A cast member without one is refused before generation starts. Add a photo to this
              item if it has none.
            </AlertDescription>
          </Alert>
        )}

        <Alert variant="info" density="compact">
          <AlertTitle>Applies to future generations</AlertTitle>
          <AlertDescription>
            Anything you already made keeps the wording it was made with.
          </AlertDescription>
        </Alert>

        {error && (
          <Alert role="alert" variant="destructive" density="compact">
            <AlertTitle>Type wasn&apos;t changed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!changed || pending}>
            {pending && <Spinner data-icon="inline-start" aria-label="Saving type" />}
            {pending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </FieldGroup>
    </form>
  );
}
