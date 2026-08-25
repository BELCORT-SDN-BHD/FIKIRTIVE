import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * FIKIRTIVE input: 1.5px border that turns coral on focus, with a coral focus
 * ring. 44px tall, 14px radius, 16px text (no iOS zoom).
 */
function Input({ className, type, unstyled = false, ...props }: React.ComponentProps<"input"> & { unstyled?: boolean }) {
  return (
    <input
      type={type}
      data-slot="input"
      className={unstyled ? className : cn(
        "flex h-11 w-full min-w-0 rounded-lg border-[1.5px] border-input bg-card px-3.5 py-2 text-base text-foreground shadow-xs transition-[color,border-color,box-shadow] duration-150 outline-none",
        "placeholder:text-muted-foreground",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30",
        "disabled:cursor-not-allowed disabled:opacity-40",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/30",
        className
      )}
      {...props}
    />
  )
}

export { Input }
