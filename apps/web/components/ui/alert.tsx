import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * FIKIRTIVE alert — the standing notice inside a page (the product ships ~40
 * `role="alert"` surfaces, each with its own hand-rolled box). Tones reuse the
 * soft token pairs `<Badge>` already speaks, so a red notice and a red badge on the
 * same screen are the same red. Colour = state; coral is never a state.
 *
 * `role` is deliberately NOT hard-coded: a live result (save failed, credits short)
 * wants `role="alert"`; a standing explanation wants no role at all, or `role="status"`.
 */
const alertVariants = cva(
  "relative grid w-full items-start gap-y-0.5 rounded-[var(--radius-card)] border px-4 py-3 text-sm grid-cols-[0_1fr] has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current",
  {
    variants: {
      variant: {
        default: "border-border bg-card text-card-foreground",
        destructive: "border-transparent bg-error-soft text-error-soft-foreground",
        success: "border-transparent bg-success-soft text-success-soft-foreground",
        warning: "border-transparent bg-warning-soft text-warning-soft-foreground",
        info: "border-transparent bg-info-soft text-info-soft-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return <div data-slot="alert" className={cn(alertVariants({ variant }), className)} {...props} />
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn("col-start-2 min-h-4 font-semibold tracking-[-0.01em]", className)}
      {...props}
    />
  )
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn("col-start-2 grid justify-items-start gap-1 text-sm leading-[1.5] [&_p]:leading-relaxed", className)}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, alertVariants }
