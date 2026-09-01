import * as React from "react"
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/** FIKIRTIVE badge: fully-round pill, sentence case, quiet by default. Colour = state or Otto ownership. */
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors duration-[var(--dur-1)] ease-[var(--ease-standard)] [&_svg]:pointer-events-none [&_svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-transparent bg-secondary text-secondary-foreground",
        otto: "border-transparent bg-brand-strong text-brand-foreground",
        "otto-soft": "border-transparent bg-brand-soft text-brand-soft-foreground",
        outline: "border-border text-foreground",
        success: "border-transparent bg-success-soft text-success-soft-foreground",
        warning: "border-transparent bg-warning-soft text-warning-soft-foreground",
        info: "border-transparent bg-info-soft text-info-soft-foreground",
        destructive: "border-transparent bg-error-soft text-error-soft-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

function Badge({
  className,
  variant,
  asChild = false,
  render,
  children,
  ...props
}: useRender.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
        ...(asChild ? {} : { children }),
      },
      props
    ),
    render: asChild && React.isValidElement(children) ? children : render,
    state: { slot: "badge", variant },
  })
}

export { Badge, badgeVariants }
