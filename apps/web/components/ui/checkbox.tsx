"use client"

import * as React from "react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"
import { CheckIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * FIKIRTIVE checkbox. Same 1.5px border and coral focus ring as `<Input>` so a form
 * reads as one control family, and the checked state is INK (coral stays agent-only).
 */
function Checkbox({ className, unstyled = false, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root> & { unstyled?: boolean }) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={unstyled ? className : cn(
        "peer size-[18px] shrink-0 rounded-[6px] border-[1.5px] border-input bg-card shadow-xs outline-none transition-[color,background-color,border-color,box-shadow] duration-150",
        "data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
        "data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/30",
        "disabled:cursor-not-allowed disabled:opacity-40",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current"
      >
        <CheckIcon className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
