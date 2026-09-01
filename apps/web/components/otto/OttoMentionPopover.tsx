"use client";

import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";

interface MentionSuggestion {
  id: string;
  name: string;
}

interface OttoMentionPopoverProps {
  children: ReactElement;
  highlightedIndex: number;
  listId: string;
  onDismiss: () => void;
  onHighlightChange: (index: number) => void;
  onSelect: (suggestion: MentionSuggestion) => void;
  suggestions: MentionSuggestion[];
}

export function OttoMentionPopover({
  children,
  highlightedIndex,
  listId,
  onDismiss,
  onHighlightChange,
  onSelect,
  suggestions,
}: OttoMentionPopoverProps) {
  return (
    <Popover
      open={suggestions.length > 0}
      onOpenChange={(open) => {
        if (!open) onDismiss();
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
        className="w-64 p-1"
      >
        {suggestions.map((suggestion, index) => (
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
            className="w-full justify-start px-2.5 font-normal"
          >
            @{suggestion.name}
          </Button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
