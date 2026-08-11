import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * FIKIRTIVE skeleton — the "still loading" placeholder, one recipe instead of the
 * hand-rolled shimmer divs scattered across the canvas and the lists. `bg-accent`
 * is the quiet ground tint, so a skeleton never reads as content.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-accent", className)}
      {...props}
    />
  )
}

export { Skeleton }
