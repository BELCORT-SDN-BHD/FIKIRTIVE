"use client"

import { Separator as SeparatorPrimitive } from "@base-ui/react/separator"

import { cn } from "@/lib/utils"

/**
 * FIKIRTIVE separator — the hairline that already runs through every card and list,
 * currently hand-rolled as `border-t` / `borderTop` in ~90 places. Decorative by
 * default: a divider that carries no meaning must not be announced by a screen reader.
 */
function Separator({
  className,
  orientation = "horizontal",
  ...props
}: SeparatorPrimitive.Props) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border",
        "data-horizontal:h-px data-horizontal:w-full",
        "data-vertical:h-full data-vertical:w-px",
        className
      )}
      {...props}
    />
  )
}

export { Separator }
