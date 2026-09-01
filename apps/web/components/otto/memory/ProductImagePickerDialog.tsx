"use client";

import React, { useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import type { BrandRecordRow } from "@/lib/brand-record-actions";
import type { StuffItem } from "@/lib/stuff-items";
import { StuffLibrary } from "../stuff/StuffLibrary";

export function ProductImagePickerDialog({ product, items, onClose, onSetImage }: {
  product: BrandRecordRow | null;
  items: StuffItem[];
  onClose: () => void;
  onSetImage: (product: BrandRecordRow, assetId: string) => Promise<string | null>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);

  async function chooseImage(assetId: string) {
    if (!product || submittingRef.current) return;

    submittingRef.current = true;
    setPending(true);
    setError(null);

    let saved = false;
    try {
      const failure = await onSetImage(product, assetId);
      if (failure) {
        setError(failure);
        return;
      }
      saved = true;
    } catch {
      setError("The product image couldn't be updated. Check your connection and try again.");
    } finally {
      submittingRef.current = false;
      setPending(false);
    }

    if (saved) onClose();
  }

  return (
    <Dialog
      open={product !== null}
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent
        closeDisabled={pending}
        className="max-h-[80vh] max-w-[min(720px,calc(100vw-2rem))] overflow-auto"
      >
        <DialogHeader className="pr-8">
          <DialogTitle>Choose an image from Library</DialogTitle>
          <DialogDescription>
            Pick one of your own images to show on this product. The Library image stays available if you replace it later.
          </DialogDescription>
        </DialogHeader>
        {pending && (
          <Alert role="status">
            <Spinner aria-hidden />
            <AlertTitle>Updating product image</AlertTitle>
            <AlertDescription>Keep this window open while the change is saved.</AlertDescription>
          </Alert>
        )}
        {error && (
          <Alert variant="destructive" role="alert">
            <AlertTitle>Product image wasn&apos;t updated</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {product && (
          <StuffLibrary
            items={items}
            mode="picker"
            pickPending={pending}
            onPick={(assetId) => void chooseImage(assetId)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
