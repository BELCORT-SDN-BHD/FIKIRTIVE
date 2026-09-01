import * as React from "react"
import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * FIKIRTIVE button.
 *  - `default` = INK (the confident primary CTA)
 *  - `otto`      = CORAL + brand ink (OTTO / agent-initiated moments, AA small-text contrast)
 *  - `otto-soft` = coral-tint fill for explicit Otto presence
 * 10px radius, ink focus ring, and crisp press feedback.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold tracking-[-0.01em] transition-[color,background-color,box-shadow,filter,transform] duration-[var(--dur-1)] ease-[var(--ease-standard)] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:size-[1.1em] [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
        otto: "bg-brand text-brand-ink shadow-[var(--shadow-brand)] hover:brightness-[1.05]",
        "otto-soft": "bg-brand-soft text-brand-soft-foreground hover:bg-brand-soft/75",
        secondary: "border border-border bg-card text-foreground shadow-xs hover:bg-secondary",
        outline: "border border-border bg-transparent hover:bg-accent hover:text-accent-foreground",
        ghost: "bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground aria-selected:bg-accent aria-selected:text-accent-foreground",
        destructive: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        "destructive-secondary": "border border-border bg-card text-destructive shadow-xs hover:bg-error-soft hover:text-error-soft-foreground",
        link: "text-foreground underline-offset-4 hover:underline",
      },
      size: {
        "icon-xs": "size-8 rounded-[8px] p-0",
        "icon-sm": "size-9 rounded-[10px] p-0",
        xs: "h-8 rounded-[8px] px-3 text-xs",
        sm: "h-9 rounded-[10px] px-3.5 text-[13px]",
        default: "h-11 px-5",
        lg: "h-12 px-6 text-base",
        pill: "h-11 rounded-full px-6",
        icon: "size-11",
      },
      motion: {
        default: "",
        instant: "transition-none",
      },
    },
    defaultVariants: { variant: "default", size: "default", motion: "default" },
  }
)

function Button({
  className,
  variant,
  size,
  motion,
  asChild = false,
  render,
  nativeButton,
  children,
  ...props
}: ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const childRender = asChild && React.isValidElement(children) ? children : render

  return (
    <ButtonPrimitive
      data-slot="button"
      data-variant={variant ?? "default"}
      data-size={size ?? "default"}
      data-motion={motion ?? "default"}
      data-press-feedback={motion === "instant" ? undefined : "true"}
      className={cn(buttonVariants({ variant, size, motion, className }))}
      render={childRender}
      nativeButton={asChild ? false : nativeButton}
      {...props}
    >
      {asChild ? undefined : children}
    </ButtonPrimitive>
  )
}

export { Button, buttonVariants }
