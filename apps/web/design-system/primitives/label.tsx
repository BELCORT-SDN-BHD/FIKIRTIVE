"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * FIKIRTIVE label. The native `<label>` keeps click-to-focus association and the
 * `peer-disabled` hook the field styles read.
 * Sentence case — capitalisation lives in the copy, never in `text-transform`.
 */
function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm font-medium leading-none select-none",
        "group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50",
        "peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }
