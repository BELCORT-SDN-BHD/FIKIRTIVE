"use client";

import Link from "next/link";
import type { ComponentType, ReactElement } from "react";
import { useLayoutEffect } from "react";
import {
  ImageIcon,
  MapPinIcon,
  PackageIcon,
  StampIcon,
  UsersRoundIcon,
} from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import {
  MENTION_ROW_LIMIT,
  mentionSourceLine,
  mentionThumbnailUrl,
  type MentionSuggestion,
} from "@/lib/mention-presentation";
import type { EntityTypeDTO } from "@/lib/types";

interface OttoMentionPopoverProps {
  children: ReactElement;
  highlightedIndex: number;
  listId: string;
  onDismiss: () => void;
  onHighlightChange: (index: number) => void;
  onSelect: (suggestion: MentionSuggestion) => void;
  /**
   * True while the composer has a live `@query` at the caret. Passing it is what lets the menu
   * stay open on zero results and show the honest "No references found" exit; a composer that
   * does not track its query keeps today's behaviour (menu opens only when there are rows).
   */
  queryActive?: boolean;
  suggestions: MentionSuggestion[];
}

const TYPE_ICONS: Record<EntityTypeDTO, ComponentType<{ className?: string }>> = {
  PRODUCT: PackageIcon,
  CHARACTER: UsersRoundIcon,
  LOCATION: MapPinIcon,
  BRANDMARK: StampIcon,
};

function ReferenceThumb({ suggestion }: { suggestion: MentionSuggestion }) {
  const url = mentionThumbnailUrl(suggestion);
  if (url) {
    return (
      <span className="relative size-9 shrink-0 overflow-hidden rounded-[var(--radius)] border border-border bg-muted">
        {/* Entity ref URLs are arbitrary storage origins — the Library thumbnails render the
            same way (components/otto/stuff/StuffLibrary.tsx). */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="" className="size-full object-cover" />
      </span>
    );
  }
  const Icon = suggestion.type ? TYPE_ICONS[suggestion.type] : null;
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius)] border border-border bg-muted text-sm font-semibold text-muted-foreground">
      {Icon ? <Icon className="size-4" /> : suggestion.name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

/**
 * The Otto `@` reference picker menu.
 *
 * Geometry, row anatomy, row cap and the empty-state exit follow the Founder-approved fixture at
 * `/product-patterns/reference-picker`
 * (`design-system/patterns/reference-picker/ReferencePickerReference.tsx`) and the frozen contract
 * `design-system/information-architecture/reference-picker-contract.md`.
 *
 * Not here yet, because production has no contract for them (FRONT-A10 later slices): the unified
 * reference search behind bare `@` (Recent + category entries), typed IDs beyond `Entity`, and the
 * `Upload media` exit — a menu-level upload has no handler to call, so it is not drawn.
 */
export function OttoMentionPopover({
  children,
  highlightedIndex,
  listId,
  onDismiss,
  onHighlightChange,
  onSelect,
  queryActive,
  suggestions,
}: OttoMentionPopoverProps) {
  // Contract §2 — the menu shows at most ~8 rows, then scrolls inside itself. Both composers cap
  // their own search at 6 today, so this bounds a future caller; it is the menu's geometry limit.
  const visible = suggestions.slice(0, MENTION_ROW_LIMIT);
  const open = queryActive ?? visible.length > 0;

  useLayoutEffect(() => {
    if (!open) return;
    document.getElementById(`${listId}-option-${highlightedIndex}`)?.scrollIntoView?.({
      behavior: "instant" as ScrollBehavior,
      block: "nearest",
    });
  }, [highlightedIndex, listId, open]);

  return (
    <Popover
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onDismiss();
      }}
    >
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent
        id={listId}
        role="listbox"
        aria-label="Entity suggestions"
        side="top"
        align="start"
        sideOffset={6}
        collisionPadding={12}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onFocusOutside={(event) => event.preventDefault()}
        motion="instant"
        className="w-(--anchor-width) overflow-hidden p-0"
      >
        {visible.length > 0 ? (
          <div className="max-h-[352px] overflow-y-auto p-1">
            {visible.map((suggestion, index) => {
              const Icon = suggestion.type ? TYPE_ICONS[suggestion.type] : null;
              const source = mentionSourceLine(suggestion);
              return (
                <Button
                  key={suggestion.id}
                  id={`${listId}-option-${index}`}
                  type="button"
                  variant="ghost"
                  size="sm"
                  motion="instant"
                  role="option"
                  aria-selected={index === highlightedIndex}
                  data-highlighted={index === highlightedIndex ? "" : undefined}
                  onPointerMove={() => onHighlightChange(index)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onSelect(suggestion);
                  }}
                  className="h-auto w-full justify-start gap-3 rounded-[var(--radius)] px-2.5 py-2 text-left font-normal [&_svg]:size-4"
                >
                  <ReferenceThumb suggestion={suggestion} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{suggestion.name}</span>
                    {source ? (
                      <span className="block truncate text-xs text-muted-foreground">{source}</span>
                    ) : null}
                  </span>
                  {Icon ? <Icon className="size-4 shrink-0 text-muted-foreground" /> : null}
                </Button>
              );
            })}
          </div>
        ) : (
          <div className="p-5 text-center">
            <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-muted">
              <ImageIcon className="size-4 text-muted-foreground" />
            </div>
            <p className="text-sm font-semibold">No references found</p>
            <p className="mt-1 text-xs text-muted-foreground">Try another name or browse Library.</p>
            <div className="mt-4 flex justify-center gap-2">
              <Link className={buttonVariants({ size: "sm" })} href="/library">
                Browse Library
              </Link>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
