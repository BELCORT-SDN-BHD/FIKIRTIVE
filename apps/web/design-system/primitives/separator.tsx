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
      // Base UI's Separator always emits `role="separator"`, which a screen reader
      // announces as a structural boundary. A hairline drawn purely to separate two
      // cards carries no meaning, so it is marked presentational by default — the
      // promise this component's own docstring makes. A caller that really means a
      // semantic boundary passes `role="separator"` back in; `elementProps` wins over
      // Base UI's own default, and over this one.
      role="none"
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
