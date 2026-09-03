"use client";

/**
 * CanvasLibraryPicker — the "Choose from Library" half of the approved pattern's **Add context**
 * menu (`design-system/patterns/canvas/CreationComposer.tsx`: Upload image / Choose from Library /
 * Add URL).
 *
 * NO NEW BUSINESS LAYER (Founder 2026-09-03: 只接现有能力). It reads the merchant's own generation
 * history through the same owner-gated server action the Library page uses
 * (`lib/library-actions.getGenerationHistory` — `requireOwner()` inside, no `ownerId` from the
 * client), and it turns a chosen row into a composer reference through the same one mapping the
 * board's "send to Otto" already uses (`canvasComposerReferenceForNode`). Attaching a reference
 * spends nothing: it is context the composer carries until the merchant sends their own message.
 *
 * Read-only and cheap on purpose: one page, newest first, no search box and no paging. The
 * merchant who wants to search their whole Library has the Library page for that; this is the
 * "the thing I made a minute ago" shortcut the pattern puts in the composer.
 */

import { useCallback, useEffect, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { getGenerationHistory, type LibraryItem } from "@/lib/library-actions";
import {
  canvasComposerReferenceForNode,
  type OttoComposerReference,
} from "@/lib/canvas-chat-reference";

/** One page is what a composer shortcut needs; the Library page owns search and paging. */
const PICKER_PAGE_SIZE = 24;

export function CanvasLibraryPicker({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (reference: Omit<OttoComposerReference, "requestId">) => void;
}) {
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setItems(null);
    const page = await getGenerationHistory({ take: PICKER_PAGE_SIZE });
    if ("error" in page) {
      setError(page.error);
      return;
    }
    setItems(page.items);
  }, []);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-[min(720px,calc(100vw-2rem))] overflow-auto">
        <DialogHeader className="pr-8">
          <DialogTitle>Choose from Library</DialogTitle>
          <DialogDescription>
            Pick something you have already made or uploaded. Otto uses it as a reference for your
            next message — attaching it costs nothing.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <Alert role="alert" variant="destructive">
            <AlertTitle>Library couldn&apos;t be loaded</AlertTitle>
            <AlertDescription>
              <span>{error}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        ) : items === null ? (
          <Alert role="status">
            <Spinner aria-hidden />
            <AlertTitle>Loading your Library</AlertTitle>
            <AlertDescription>This only reads what you have already made.</AlertDescription>
          </Alert>
        ) : items.length === 0 ? (
          <Alert role="status">
            <AlertTitle>Nothing in your Library yet</AlertTitle>
            <AlertDescription>
              Anything you make or upload lands here, and you can send it back to Otto from this
              menu.
            </AlertDescription>
          </Alert>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
            {items.map((item) => {
              const reference = canvasComposerReferenceForNode({
                type: item.kind,
                generationId: item.id,
                src: item.url,
              });
              if (!reference) return null;
              const name = item.prompt.trim();
              return (
                <li key={item.id}>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-auto w-full flex-col items-stretch gap-1 p-1 text-left"
                    title={name || undefined}
                    onClick={() => {
                      onPick(reference);
                      onOpenChange(false);
                    }}
                  >
                    <span className="block aspect-square overflow-hidden rounded-[var(--radius)] bg-muted">
                      {item.kind === "video" ? (
                        <video
                          src={item.url}
                          muted
                          playsInline
                          preload="metadata"
                          className="size-full object-cover"
                        />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.url} alt={name} className="size-full object-cover" />
                      )}
                    </span>
                    <span className="block truncate text-xs font-normal text-muted-foreground">
                      {name || (item.kind === "video" ? "Video" : "Image")}
                    </span>
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default CanvasLibraryPicker;
