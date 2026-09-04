/**
 * CanvasNodeMoreMenu — the fifth and last control on a picked card's action bar.
 *
 * The approved canvas pattern (`design-system/patterns/canvas/CanvasReference.tsx`) puts exactly
 * five things on a picked artifact: Edit with Otto, Create variations, Animate, Download, and a
 * `⋯` dropdown. Everything the board can do that the pattern does not give its own icon lives in
 * that dropdown rather than as a sixth, seventh and eighth button — that row of eight mixed icon
 * and text buttons was the trunk's own accretion, not a design.
 *
 * The pattern's dropdown carries Share selected output / Duplicate / Remove from canvas. Two of
 * those three have no production contract and so are not rendered (Founder 2026-09-03 rule ①):
 *   · Share — the only share link in the repo is `sharePostPreview`, which mints a token bound to
 *     a ScheduledPost (`lib/schedule-actions.ts`). A canvas card is a Generation and has no post,
 *     and Schedule itself is behind the #850 beta gate. There is nothing to call.
 *   · Duplicate — no action copies a canvas node; the nearest thing costs money (Create variations,
 *     which is its own icon above) and is not the same promise.
 */
import type { ReactNode } from "react";
import { MoreHorizontalIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function CanvasNodeMoreMenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="icon-xs"
          className="nodrag nopan"
          aria-label={label}
          title={label}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontalIcon aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" onClick={(e) => e.stopPropagation()}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default CanvasNodeMoreMenu;
