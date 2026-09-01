"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

type TooltipButtonProps = Omit<
  React.ComponentProps<typeof Button>,
  "aria-label"
> & {
  label: string
  tooltip?: React.ReactNode
  side?: React.ComponentProps<typeof TooltipContent>["side"]
}

/** Icon-first action with one accessible name and one consistent help surface. */
function TooltipButton({
  label,
  tooltip = label,
  side = "top",
  ...props
}: TooltipButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button aria-label={label} {...props} />
      </TooltipTrigger>
      <TooltipContent side={side}>{tooltip}</TooltipContent>
    </Tooltip>
  )
}

export { TooltipButton }
